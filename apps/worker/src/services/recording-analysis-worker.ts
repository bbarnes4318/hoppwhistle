import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

import { logger } from '../lib/logger.js';

import { getRedisClient } from './redis.js';

const prisma = new PrismaClient();

type TranscriptionReadyEvent = {
  event: 'transcription.ready';
  tenantId: string;
  data: {
    callId: string; // MUST be RecordingAnalysis.id
    transcriptId?: string;
    stats?: any;
    fullText?: string;
    segments?: any[];
    language?: string;
    durationSec?: number;
    engine?: string;
  };
};

type Vertical = 'ACA' | 'FINAL_EXPENSE' | 'MEDICARE';

type ExtractedPayload = {
  values: Record<string, any>;
  confidence: Record<string, number>; // 0..1 per field
  overallConfidence: number; // 0..1
  billable?: 'Y' | 'N';
  nonbillable_reason?: string | null;
};

/** ------------------- DeepSeek call (strict JSON) ------------------- */
async function callDeepSeekStrictJson(prompt: string): Promise<any> {
  const endpoint = process.env.DEEPSEEK_ENDPOINT || 'https://api.deepseek.com/chat/completions';
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';

  if (!apiKey) throw new Error('DEEPSEEK_API_KEY is not set');

  const r = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content:
            'Return ONLY valid JSON. No markdown. No commentary. ' +
            'If unsure, return null values and lower confidence.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!r.ok) {
    const t = await r.text();
    throw new Error(`DeepSeek HTTP ${r.status}: ${t}`);
  }

  const j: any = await r.json();
  const content = j?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') throw new Error('DeepSeek empty content');

  const trimmed = content.trim();

  if (trimmed.startsWith('```')) {
    const cleaned = trimmed
      .replace(/^```json/i, '')
      .replace(/^```/i, '')
      .replace(/```$/, '')
      .trim();
    return JSON.parse(cleaned);
  }

  return JSON.parse(trimmed);
}

/** ------------------- Field schemas (dynamic) ------------------- */
const NUM = z.number().finite().nullable();
const STR = z.string().min(1).nullable();
const YESNO = z.enum(['Y', 'N']).nullable();

function schemaForField(field: string) {
  const f = field.toLowerCase();

  if (f.includes('applications')) return z.number().int().min(0).nullable();
  if (f.includes('enrollments')) return z.number().int().min(0).nullable();
  if (f === 'quotes') return z.number().int().min(0).nullable();
  if (f.includes('follow-ups') || f.includes('follow ups'))
    return z.number().int().min(0).nullable();

  if (f.includes('monthly premium')) return NUM;
  if (f.startsWith('carrier')) return STR;

  if (f === 'billable' || f.includes('billable')) return YESNO;
  if (f.startsWith('reason')) return z.string().nullable();
  if (f.includes('transcript')) return z.string().nullable();

  // default: allow null/primitive
  return z.any().nullable();
}

function buildDynamicSchema(selectedFields: string[]) {
  const valuesShape: Record<string, z.ZodTypeAny> = {};
  const confShape: Record<string, z.ZodTypeAny> = {};

  for (const key of selectedFields) {
    valuesShape[key] = schemaForField(key);
    confShape[key] = z.number().min(0).max(1).nullable().default(null);
  }

  return z.object({
    values: z.object(valuesShape),
    confidence: z.object(confShape),
    overallConfidence: z.number().min(0).max(1).default(0.5),
    billable: z.enum(['Y', 'N']).optional(),
    nonbillable_reason: z.string().nullable().optional(),
  });
}

/** ------------------- Vertical-specific prompt tuning ------------------- */
function buildPrompt(vertical: Vertical, selectedFields: string[], transcript: string) {
  const baseRules = [
    'Return ONLY JSON. No markdown. No extra text.',
    'Output format MUST be:',
    '{ "values": { ... }, "confidence": { ... }, "overallConfidence": 0.0-1.0, "billable":"Y|N", "nonbillable_reason": string|null }',
    '',
    'Rules:',
    '- values must include ONLY the selected field keys.',
    '- confidence must include the same keys with 0..1 (use 0.2 if guessing).',
    '- overallConfidence is 0..1.',
    '- Billable must be Y or N.',
    '- If Billable is N, nonbillable_reason must be a short string.',
    '- If a value is not present, use null (or 0 for counts).',
  ];

  const verticalGuidance =
    vertical === 'FINAL_EXPENSE'
      ? [
          'FINAL EXPENSE GUIDANCE:',
          '- Applications Submitted: count submitted applications.',
          '- Monthly Premium fields: numeric premium if explicitly stated, else null.',
          '- Carrier: carrier name if explicitly stated, else null.',
          '- Quotes: count distinct quotes presented.',
          '- Follow-Ups: count clear follow-up actions.',
          '- Billable should be Y only if there was a meaningful sales outcome (quote or app) AND caller intent was real.',
        ]
      : vertical === 'ACA'
        ? [
            'ACA GUIDANCE:',
            '- Enrollments: count completed enrollments (confirmed submitted).',
            '- Carrier: carrier name if enrollment occurred.',
            '- Billable: Y if enrollment completed OR strong qualified transfer intent; otherwise N.',
          ]
        : [
            'MEDICARE GUIDANCE:',
            '- Enrollments: count completed enrollments or completed plan switches.',
            '- Carrier: carrier name if known and stated.',
            '- Billable: Y if enrollment completed OR clearly qualified conversion intent; otherwise N.',
          ];

  return [
    ...baseRules,
    '',
    `VERTICAL: ${vertical}`,
    `SELECTED_FIELDS: ${selectedFields.join(' | ')}`,
    '',
    ...verticalGuidance,
    '',
    'Transcript:',
    transcript,
  ].join('\n');
}

/** ------------------- Billable hard-logic (deterministic) ------------------- */
function enforceBillableHardLogic(vertical: Vertical, values: Record<string, any>) {
  const getNum = (k: string) => {
    const v = values?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    return null;
  };
  const getStr = (k: string) => {
    const v = values?.[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    return null;
  };

  // Common signals
  const apps = getNum('Applications Submitted');
  const quotes = getNum('Quotes');
  const enroll = getNum('Enrollments');

  const premiumApp =
    getNum('Monthly Premium (if app submitted)') ?? getNum('Monthly Premium (If Quote Provided)');

  const carrierApp =
    getStr('Carrier (If app submitted)') ??
    getStr('Carrier (If Quote Provided)') ??
    getStr('Carrier (If enrollment)');

  let billable: 'Y' | 'N' = 'N';
  let reason: string | null = 'No qualifying outcome detected.';

  if (vertical === 'FINAL_EXPENSE') {
    const hasOutcome = (apps ?? 0) > 0 || (quotes ?? 0) > 0;
    if (hasOutcome) {
      billable = 'Y';
      reason = null;

      // tighten: if app submitted but no premium/carrier at all, still billable but confidence should be lower (handled by model)
      if ((apps ?? 0) > 0 && !premiumApp && !carrierApp) {
        // still allow, but reason null
      }
    }
  } else {
    const hasOutcome = (enroll ?? 0) > 0;
    if (hasOutcome) {
      billable = 'Y';
      reason = null;
    }
  }

  return { billable, nonbillable_reason: reason };
}

/** ------------------- Main worker ------------------- */
export async function startRecordingAnalysisWorker() {
  const redis = getRedisClient();

  try {
    await redis.xgroup('CREATE', 'events:stream', 'recording-analysis-group', '0', 'MKSTREAM');
    logger.info({ msg: 'Created recording-analysis-group consumer group' });
  } catch (err: any) {
    // Group already exists
    if (!err.message?.includes('BUSYGROUP')) {
      logger.warn({ msg: 'Failed to create consumer group', err });
    }
  }

  logger.info({ msg: 'Recording Analysis Worker started' });

  while (true) {
    const messages = await redis.xreadgroup(
      'GROUP',
      'recording-analysis-group',
      'recording-analysis-worker',
      'COUNT',
      '5',
      'BLOCK',
      '1000',
      'STREAMS',
      'events:stream',
      '>'
    );

    if (!messages?.length) continue;

    const [, streamMessages] = messages[0] as any;

    for (const [messageId, fields] of streamMessages) {
      let callId: string | null = null;

      try {
        const fieldMap: Record<string, string> = {};
        for (let i = 0; i < fields.length; i += 2) fieldMap[fields[i]] = fields[i + 1];

        const payload = JSON.parse(fieldMap.payload || '{}') as TranscriptionReadyEvent;

        if (payload.event !== 'transcription.ready') {
          await redis.xack('events:stream', 'recording-analysis-group', messageId);
          continue;
        }

        callId = payload.data?.callId || null;
        if (!callId) {
          await redis.xack('events:stream', 'recording-analysis-group', messageId);
          continue;
        }

        const row = await prisma.recordingAnalysis.findUnique({ where: { id: callId } });
        if (!row) {
          // Not a RecordingAnalysis job, skip (it's a regular call transcription)
          await redis.xack('events:stream', 'recording-analysis-group', messageId);
          continue;
        }

        // Idempotency: if already done/failed, ack + skip
        const s0 = String(row.status || '').toLowerCase();
        if (s0 === 'done' || s0 === 'failed') {
          await redis.xack('events:stream', 'recording-analysis-group', messageId);
          continue;
        }

        logger.info({ msg: 'Processing recording analysis', callId });

        await prisma.recordingAnalysis.update({
          where: { id: callId },
          data: { status: 'analyzing', error: null },
        });

        const selectedFields = Array.isArray(row.selectedFields)
          ? (row.selectedFields as any as string[])
          : [];

        const transcriptText = (payload.data.fullText || '').trim();
        if (!transcriptText)
          throw new Error('transcription.ready did not include fullText (required).');

        const vertical = row.vertical as Vertical;

        const prompt = buildPrompt(vertical, selectedFields, transcriptText);

        const raw = await callDeepSeekStrictJson(prompt);

        // Validate / coerce to schema
        const schema = buildDynamicSchema(selectedFields);
        const parsed = schema.safeParse(raw);

        if (!parsed.success) {
          throw new Error('LLM JSON failed schema validation: ' + parsed.error.message);
        }

        const extracted = parsed.data as ExtractedPayload;

        // Billable hard-logic override (deterministic)
        const enforced = enforceBillableHardLogic(vertical, extracted.values);

        extracted.billable = enforced.billable;
        extracted.nonbillable_reason = enforced.nonbillable_reason;

        // Only store transcript if selectedFields includes transcript
        const wantsTranscript = selectedFields.some(k => k.toLowerCase().includes('transcript'));

        await prisma.recordingAnalysis.update({
          where: { id: callId },
          data: {
            status: 'done',
            transcript: wantsTranscript ? transcriptText : null,
            extracted,
            error: null,
          },
        });

        logger.info({ msg: 'Recording analysis completed', callId });

        await redis.xack('events:stream', 'recording-analysis-group', messageId);
      } catch (e: any) {
        logger.error({ msg: 'Recording analysis failed', callId, error: e?.message });
        await redis.xack('events:stream', 'recording-analysis-group', messageId);

        // Best-effort failure update
        if (callId) {
          try {
            await prisma.recordingAnalysis.update({
              where: { id: callId },
              data: {
                status: 'failed',
                error: e?.message || 'Unknown error',
              },
            });
          } catch {}
        }
      }
    }
  }
}
