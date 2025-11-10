import { z } from 'zod';

// Base node schema
export const BaseNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  next: z.string().optional(),
});

export type BaseNode = z.infer<typeof BaseNodeSchema>;

// Entry node - starting point of a flow
export const EntryNodeSchema = BaseNodeSchema.extend({
  type: z.literal('entry'),
  target: z.string(), // ID of the first node to execute
});

export type EntryNode = z.infer<typeof EntryNodeSchema>;

// IVR node - Interactive Voice Response with DTMF
export const IVRNodeSchema = BaseNodeSchema.extend({
  type: z.literal('ivr'),
  prompt: z.string(), // Text or audio URL to play
  timeout: z.number().optional(), // Timeout in seconds
  maxDigits: z.number().optional(), // Maximum digits to collect
  finishOnKey: z.string().optional(), // Key that finishes input (e.g., '#')
  choices: z.array(
    z.object({
      digits: z.string(), // DTMF digits to match (e.g., "1", "2", "*")
      target: z.string(), // Node ID to go to on match
    })
  ),
  default: z.string().optional(), // Default node if no match or timeout
});

export type IVRNode = z.infer<typeof IVRNodeSchema>;

// If node - conditional branching
export const IfNodeSchema = BaseNodeSchema.extend({
  type: z.literal('if'),
  condition: z.string(), // Expression to evaluate (e.g., "${caller.number == '+1234567890'}")
  then: z.string(), // Node ID if condition is true
  else: z.string().optional(), // Node ID if condition is false
});

export type IfNode = z.infer<typeof IfNodeSchema>;

// Queue node - route to a queue
export const QueueNodeSchema = BaseNodeSchema.extend({
  type: z.literal('queue'),
  queueId: z.string(),
  waitUrl: z.string().optional(), // Music/announcement to play while waiting
  timeout: z.number().optional(), // Max wait time in seconds
  maxSize: z.number().optional(), // Max queue size
  onTimeout: z.string().optional(), // Node ID if timeout
  onFull: z.string().optional(), // Node ID if queue is full
  onConnect: z.string().optional(), // Node ID when connected to agent
});

export type QueueNode = z.infer<typeof QueueNodeSchema>;

// Buyer node - route to buyers with rotation, weights, caps, concurrency
export const BuyerNodeSchema = BaseNodeSchema.extend({
  type: z.literal('buyer'),
  buyers: z.array(
    z.object({
      id: z.string(),
      destination: z.string(), // SIP URI or phone number
      weight: z.number().default(1), // Weight for rotation (higher = more calls)
      maxConcurrency: z.number().optional(), // Max simultaneous calls
      maxDailyCalls: z.number().optional(), // Max calls per day
      enabled: z.boolean().default(true),
    })
  ),
  strategy: z.enum(['round-robin', 'weighted', 'least-calls']).default('round-robin'),
  onNoBuyers: z.string().optional(), // Node ID if no available buyers
  onAllBusy: z.string().optional(), // Node ID if all buyers are busy
});

export type BuyerNode = z.infer<typeof BuyerNodeSchema>;

// Record node - record the call
export const RecordNodeSchema = BaseNodeSchema.extend({
  type: z.literal('record'),
  format: z.enum(['wav', 'mp3']).default('wav'),
  channels: z.enum(['single', 'dual']).default('dual'),
  beep: z.boolean().default(false), // Play beep before recording
  onComplete: z.string().optional(), // Node ID after recording completes
  onError: z.string().optional(), // Node ID on recording error
});

export type RecordNode = z.infer<typeof RecordNodeSchema>;

// Tag node - add metadata/tags to the call
export const TagNodeSchema = BaseNodeSchema.extend({
  type: z.literal('tag'),
  tags: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

export type TagNode = z.infer<typeof TagNodeSchema>;

// Whisper node - play announcement to caller/callee before connecting
export const WhisperNodeSchema = BaseNodeSchema.extend({
  type: z.literal('whisper'),
  callerPrompt: z.string().optional(), // Prompt for caller
  calleePrompt: z.string().optional(), // Prompt for callee
  onAccept: z.string().optional(), // Node ID if callee accepts
  onReject: z.string().optional(), // Node ID if callee rejects
  timeout: z.number().optional(), // Timeout in seconds
});

export type WhisperNode = z.infer<typeof WhisperNodeSchema>;

// Timeout node - wait for a specified duration
export const TimeoutNodeSchema = BaseNodeSchema.extend({
  type: z.literal('timeout'),
  duration: z.number(), // Duration in seconds
});

export type TimeoutNode = z.infer<typeof TimeoutNodeSchema>;

// Fallback node - try multiple nodes in sequence
export const FallbackNodeSchema = BaseNodeSchema.extend({
  type: z.literal('fallback'),
  targets: z.array(z.string()), // Array of node IDs to try in order
  onAllFailed: z.string().optional(), // Node ID if all targets fail
});

export type FallbackNode = z.infer<typeof FallbackNodeSchema>;

// Hangup node - end the call
export const HangupNodeSchema = BaseNodeSchema.extend({
  type: z.literal('hangup'),
  reason: z.enum(['normal', 'busy', 'rejected', 'timeout', 'error']).default('normal'),
});

export type HangupNode = z.infer<typeof HangupNodeSchema>;

// Union of all node types
export const NodeSchema = z.discriminatedUnion('type', [
  EntryNodeSchema,
  IVRNodeSchema,
  IfNodeSchema,
  QueueNodeSchema,
  BuyerNodeSchema,
  RecordNodeSchema,
  TagNodeSchema,
  WhisperNodeSchema,
  TimeoutNodeSchema,
  FallbackNodeSchema,
  HangupNodeSchema,
]);

export type Node = z.infer<typeof NodeSchema>;

// Flow schema - complete routing flow definition
export const FlowSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  entry: EntryNodeSchema,
  nodes: z.array(NodeSchema),
  metadata: z.record(z.unknown()).optional(),
});

export type Flow = z.infer<typeof FlowSchema>;

// Execution plan - validated and ready to execute
export const ExecutionPlanSchema = z.object({
  flowId: z.string(),
  flowVersion: z.string(),
  entryNodeId: z.string(),
  nodes: z.record(z.string(), NodeSchema), // Map of node ID -> node
  metadata: z.record(z.unknown()).optional(),
});

export type ExecutionPlan = z.infer<typeof ExecutionPlanSchema>;

// Execution context - current state during flow execution
export interface ExecutionContext {
  callId: string;
  tenantId: string;
  currentNodeId: string;
  variables: Record<string, unknown>;
  history: Array<{
    nodeId: string;
    timestamp: string;
    data?: Record<string, unknown>;
  }>;
  ivrInput?: string; // Collected DTMF digits
  recordingUrl?: string;
  tags: Record<string, unknown>;
}

// Telephony event types
export const TelephonyEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('call.started'),
    callId: z.string(),
    from: z.string(),
    to: z.string(),
  }),
  z.object({
    type: z.literal('call.answered'),
    callId: z.string(),
  }),
  z.object({
    type: z.literal('call.ended'),
    callId: z.string(),
    reason: z.string(),
  }),
  z.object({
    type: z.literal('dtmf.received'),
    callId: z.string(),
    digits: z.string(),
  }),
  z.object({
    type: z.literal('recording.completed'),
    callId: z.string(),
    url: z.string(),
  }),
  z.object({
    type: z.literal('queue.connected'),
    callId: z.string(),
    agentId: z.string(),
  }),
  z.object({
    type: z.literal('queue.timeout'),
    callId: z.string(),
  }),
  z.object({
    type: z.literal('whisper.accepted'),
    callId: z.string(),
  }),
  z.object({
    type: z.literal('whisper.rejected'),
    callId: z.string(),
  }),
]);

export type TelephonyEvent = z.infer<typeof TelephonyEventSchema>;

