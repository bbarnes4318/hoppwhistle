import {
  RESEARCH_MODES,
  SCHEMA_VERSION,
  STAGE_DEFINITIONS,
  normalizeBrief,
  resolveAssignments,
  structuredReportSchema,
  type CanonicalBrief,
  type ProviderRole,
  type ResearchBriefInput,
} from '@hopwhistle/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResearchOrchestrator } from '../orchestrator';

// Isolated unit test. Mocks the HTTP transport (global fetch) only — the
// orchestrator + RealAdapter run their real code paths. No mock research
// adapter, no OpenAI, no Anthropic self-verification.

type Row = Record<string, unknown>;

function applyData(target: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in (v as Row)) {
      target[k] = ((target[k] as number) ?? 0) + ((v as { increment: number }).increment ?? 0);
    } else target[k] = v;
  }
}

function makeFakePrisma() {
  const runs = new Map<string, Row>();
  const stages: Row[] = [];
  const reports: Row[] = [];
  let seq = 0;
  return {
    _runs: runs,
    _stages: stages,
    _reports: reports,
    researchRun: {
      findUnique: ({ where, include }: any) => {
        const run = runs.get(where.id);
        if (!run) return Promise.resolve(null);
        if (include?.stages)
          return Promise.resolve({ ...run, stages: stages.filter(s => s.runId === where.id) });
        return Promise.resolve({ ...run });
      },
      update: ({ where, data }: any) => {
        applyData(runs.get(where.id)!, data);
        return Promise.resolve({ ...runs.get(where.id)! });
      },
    },
    researchStage: {
      findFirst: ({ where }: any) =>
        Promise.resolve(
          stages.find(s => s.runId === where.runId && s.stageKey === where.stageKey) ?? null
        ),
      findMany: ({ where }: any) =>
        Promise.resolve(
          stages.filter(s => s.runId === where.runId && where.stageKey.in.includes(s.stageKey))
        ),
      update: ({ where, data }: any) => {
        applyData(stages.find(s => s.id === where.id)!, data);
        return Promise.resolve({});
      },
    },
    researchReport: {
      create: ({ data }: any) => {
        const row = { id: `report-${++seq}`, ...data };
        reports.push(row);
        return Promise.resolve(row);
      },
      findFirst: ({ where }: any) =>
        Promise.resolve(
          reports
            .filter(r => r.runId === where.runId)
            .sort((a, b) => (b.version as number) - (a.version as number))[0] ?? null
        ),
    },
  };
}

function seedRun(fake: ReturnType<typeof makeFakePrisma>, input: ResearchBriefInput) {
  const brief: CanonicalBrief = normalizeBrief(input, {
    researchBriefId: 'brief-1',
    now: new Date('2026-07-18T00:00:00Z'),
  });
  const assignments = resolveAssignments(process.env, input);
  const runId = 'run-1';
  fake._runs.set(runId, {
    id: runId,
    tenantId: 'tenant-1',
    status: 'queued',
    brief,
    providerAssignments: assignments,
    maxBudgetUsd: input.maxBudgetUsd,
    accruedCostUsd: 0,
    progress: [],
    startedAt: null,
    finishedAt: null,
  });
  const active = new Set<ProviderRole>(RESEARCH_MODES[input.mode].roles);
  for (const d of STAGE_DEFINITIONS) {
    const skipped = Boolean(d.role) && !active.has(d.role as ProviderRole);
    fake._stages.push({
      id: `stage-${d.key}`,
      runId,
      stageKey: d.key,
      label: d.label,
      role: d.role ?? null,
      status: skipped ? 'skipped' : 'pending',
      costUsd: 0,
      usedFallback: false,
      output: null,
      createdAt: new Date(),
    });
  }
  return runId;
}

function res(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h === 'x-request-id' ? 'req_test_123' : null) },
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
    json: () => Promise.resolve(body),
  });
}

// Anthropic synthesis now streams (SSE). Build a mock streamed Messages response
// carrying the report text as a single text_delta plus terminal usage/stop_reason.
function anthropicSse(
  text: string,
  { inputTokens = 2000, outputTokens = 3000, stopReason = 'end_turn' } = {}
) {
  const events = [
    { type: 'message_start', message: { usage: { input_tokens: inputTokens, cache_read_input_tokens: 0 } } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    { type: 'message_delta', delta: { stop_reason: stopReason }, usage: { output_tokens: outputTokens } },
    { type: 'message_stop' },
  ];
  const payload = events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(payload));
      c.close();
    },
  });
  return Promise.resolve({
    ok: true,
    status: 200,
    headers: { get: (h: string) => (h === 'x-request-id' ? 'req_test_123' : null) },
    body: stream,
    text: () => Promise.resolve(payload),
  });
}

function validReportJson(runId: string): string {
  return JSON.stringify({
    reportMetadata: {
      researchRunId: runId,
      researchBriefId: 'brief-1',
      industry: 'Commercial HVAC maintenance services',
      geography: 'United States',
      mode: 'rapid_scan',
      generatedAt: '2026-07-18T00:00:00Z',
      synthesisProvider: 'anthropic',
      synthesisModel: 'claude-opus-4-8',
      schemaVersion: SCHEMA_VERSION,
    },
    executiveVerdict: {
      verdict: 'CONDITIONAL_GO',
      overallScore: 63,
      confidence: 0.6,
      bestSegment: 'SMB',
      bestCustomer: 'Owner-operators',
      bestBusinessModel: 'Productized service',
      timeToFirstRevenue: '30-45 days',
      initialCapital: 'Under $25k',
      biggestOpportunity: 'Automation',
      biggestRisk: 'CAC',
      oneSentenceConclusion: 'Enter via a narrow wedge.',
    },
    assumptions: [],
    sections: [{ key: 'economics', title: 'Economics', markdown: 'Base case margins ~45%.' }],
    competitors: [],
    unitEconomicsScenarios: [],
    rankedOpportunities: [],
    killCriteria: ['CAC > 8 months margin'],
    contradictions: [],
    unknowns: [],
    evidenceLedger: [],
    sources: [],
    confidenceAssessment: 'moderate',
  });
}

function factualJson(verdict: string): string {
  return JSON.stringify({
    verdict,
    confidence: 0.8,
    claimsChecked: 5,
    supportedClaims: ['a'],
    partiallySupportedClaims: [],
    unsupportedClaims: verdict === 'pass' ? [] : ['bogus claim'],
    citationFailures: [],
    outdatedSources: [],
    calculationProblems: [],
    missingEvidence: [],
    requiredRepairs: [],
    blockingDefects: verdict === 'reject' ? ['fundamental'] : [],
  });
}

const OLD_ENV = { ...process.env };

describe('ResearchOrchestrator (real-only, four-provider architecture, HTTP mocked)', () => {
  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      GEMINI_API_KEY: 'k',
      PERPLEXITY_API_KEY: 'k',
      XAI_API_KEY: 'k',
      ANTHROPIC_API_KEY: 'k',
      GOOGLE_DEEP_RESEARCH_MAX_RETRIES: '0',
      PERPLEXITY_MAX_RETRIES: '0',
      XAI_MAX_RETRIES: '0',
      ANTHROPIC_MAX_RETRIES: '0',
      INDUSTRY_RESEARCH_REAL_FALLBACK: 'false',
    };
    delete process.env.OPENAI_API_KEY;
  });
  afterEach(() => {
    process.env = { ...OLD_ENV };
    vi.unstubAllGlobals();
  });

  function mockRapid(runId: string, factualVerdict = 'pass') {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('generativelanguage')) {
          return res(200, {
            candidates: [
              {
                content: { parts: [{ text: 'Gemini grounded findings. https://sec.gov/x' }] },
                groundingMetadata: {
                  groundingChunks: [{ web: { uri: 'https://sec.gov/x', title: 'SEC' } }],
                },
              },
            ],
            usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 500 },
          });
        }
        if (url.includes('api.anthropic.com')) return anthropicSse(validReportJson(runId));
        if (url.includes('perplexity.ai'))
          return res(200, {
            choices: [{ message: { content: factualJson(factualVerdict) } }],
            usage: { prompt_tokens: 300, completion_tokens: 200 },
          });
        return res(404, { error: 'unexpected url' });
      })
    );
  }

  it('rapid_scan happy path: grounded primary + synthesis + independent Perplexity factual (pass) → published report', async () => {
    const runId = 'run-1';
    mockRapid(runId, 'pass');
    const fake = makeFakePrisma();
    seedRun(fake, {
      industry: 'Commercial HVAC maintenance services',
      geography: 'United States',
      capabilities: [],
      mode: 'rapid_scan',
      maxBudgetUsd: 40,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new ResearchOrchestrator(fake as any).processRun(runId);

    const run = fake._runs.get(runId)!;
    expect(run.status).toBe('completed');
    expect(run.verdict).toBe('CONDITIONAL_GO');
    const report = fake._reports.at(-1)!;
    expect(report).toBeTruthy();
    expect(structuredReportSchema.safeParse(report.structured).success).toBe(true);
    expect(report.synthesisProvider).toBe('anthropic');
    // Independent verification present; adversarial/adjudication skipped in rapid.
    expect(fake._stages.find(s => s.stageKey === 'verify_factual')!.status).toBe('completed');
    expect(fake._stages.find(s => s.stageKey === 'verify_adversarial')!.status).toBe('skipped');
    expect((run.accruedCostUsd as number) > 0).toBe(true);
  });

  it('verification reject: Perplexity factual returns reject → run failed, NO report published', async () => {
    const runId = 'run-1';
    mockRapid(runId, 'reject');
    const fake = makeFakePrisma();
    seedRun(fake, {
      industry: 'Commercial HVAC maintenance services',
      capabilities: [],
      mode: 'rapid_scan',
      maxBudgetUsd: 40,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new ResearchOrchestrator(fake as any).processRun(runId);

    const run = fake._runs.get(runId)!;
    expect(run.status).toBe('failed');
    expect(String(run.error)).toContain('VERIFICATION_REJECTED');
    expect(fake._reports).toHaveLength(0);
  });

  it('pass_with_caveats: factual verifier returns pass_with_caveats → run COMPLETED, report PUBLISHED', async () => {
    const runId = 'run-1';
    mockRapid(runId, 'pass_with_caveats');
    const fake = makeFakePrisma();
    seedRun(fake, {
      industry: 'Commercial HVAC maintenance services',
      capabilities: [],
      mode: 'rapid_scan',
      maxBudgetUsd: 40,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new ResearchOrchestrator(fake as any).processRun(runId);

    const run = fake._runs.get(runId)!;
    expect(run.status).toBe('completed');
    expect(fake._reports).toHaveLength(1);
    // caveats are attached via the stored verification object
    const rep = fake._reports.at(-1)!;
    expect((rep.verification as { factual?: { verdict?: string } }).factual?.verdict).toBe('pass_with_caveats');
  });

  it('provider failure: primary errors (no fallback) → failed stage → failed run → NO report', async () => {
    const runId = 'run-1';
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('generativelanguage')) return res(500, { error: 'provider down' });
        return res(200, { content: [{ type: 'text', text: validReportJson(runId) }], usage: {} });
      })
    );
    const fake = makeFakePrisma();
    seedRun(fake, {
      industry: 'Commercial HVAC maintenance services',
      capabilities: [],
      mode: 'rapid_scan',
      maxBudgetUsd: 40,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new ResearchOrchestrator(fake as any).processRun(runId);

    const run = fake._runs.get(runId)!;
    expect(run.status).toBe('failed');
    expect(fake._stages.find(s => s.stageKey === 'primary')!.status).toBe('failed');
    expect(fake._stages.find(s => s.stageKey === 'synthesis')!.status).not.toBe('completed');
    expect(fake._reports).toHaveLength(0);
  });

  it('preflight: missing provider keys → run fails immediately, no provider calls, no report', async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const fetchSpy = vi.fn(() => res(200, {}));
    vi.stubGlobal('fetch', fetchSpy);
    const fake = makeFakePrisma();
    const runId = seedRun(fake, {
      industry: 'Commercial HVAC maintenance services',
      capabilities: [],
      mode: 'rapid_scan',
      maxBudgetUsd: 40,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await new ResearchOrchestrator(fake as any).processRun(runId);

    const run = fake._runs.get(runId)!;
    expect(run.status).toBe('failed');
    expect(String(run.error)).toMatch(/Missing provider configuration/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake._reports).toHaveLength(0);
  });
});
