import { z } from 'zod';

export const RecordingReadyEventSchema = z.object({
  event: z.literal('recording.ready'),
  tenantId: z.string(),
  data: z.object({
    callId: z.string(),
    recordingUrl: z.string(),
    format: z.string().optional(),
    durationSec: z.number().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
  timestamp: z.string().optional(),
  id: z.string().optional(),
});

export type RecordingReadyEvent = z.infer<typeof RecordingReadyEventSchema>;

export const TranscriptionReadyEventSchema = z.object({
  event: z.literal('transcription.ready'),
  tenantId: z.string(),
  data: z.object({
    callId: z.string(),
    transcriptId: z.string(),
    stats: z.object({
      segments: z.number(),
      words: z.number(),
      speakerLabels: z.boolean(),
      latencyMs: z.number(),
    }),
  }),
  timestamp: z.string().optional(),
  id: z.string().optional(),
});

export type TranscriptionReadyEvent = z.infer<typeof TranscriptionReadyEventSchema>;

