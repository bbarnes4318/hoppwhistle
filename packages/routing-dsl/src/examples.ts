import type { Flow } from './types.js';

/**
 * Example 1: Simple direct route
 * Routes call directly to a destination
 */
export const simpleDirectRouteFlow: Flow = {
  id: 'simple-direct-route',
  name: 'Simple Direct Route',
  version: '1.0.0',
  description: 'Routes call directly to a destination',
  entry: {
    id: 'entry-1',
    type: 'entry',
    target: 'tag-1',
  },
  nodes: [
    {
      id: 'tag-1',
      type: 'tag',
      tags: {
        route: 'direct',
        source: 'simple-flow',
      },
      next: 'hangup-1',
    },
    {
      id: 'hangup-1',
      type: 'hangup',
      reason: 'normal',
    },
  ],
};

/**
 * Example 2: IVR with DTMF
 * Plays a menu and routes based on DTMF input
 */
export const ivrWithDTMFFlow: Flow = {
  id: 'ivr-dtmf',
  name: 'IVR with DTMF Menu',
  version: '1.0.0',
  description: 'IVR menu with DTMF input handling',
  entry: {
    id: 'entry-1',
    type: 'entry',
    target: 'ivr-1',
  },
  nodes: [
    {
      id: 'ivr-1',
      type: 'ivr',
      prompt: 'https://example.com/prompts/main-menu.wav',
      timeout: 10,
      maxDigits: 1,
      finishOnKey: '#',
      choices: [
        {
          digits: '1',
          target: 'queue-sales',
        },
        {
          digits: '2',
          target: 'queue-support',
        },
        {
          digits: '0',
          target: 'queue-operator',
        },
      ],
      default: 'hangup-timeout',
    },
    {
      id: 'queue-sales',
      type: 'queue',
      queueId: 'sales-queue',
      waitUrl: 'https://example.com/music/hold.wav',
      timeout: 60,
      onConnect: 'tag-sales',
      onTimeout: 'hangup-timeout',
    },
    {
      id: 'queue-support',
      type: 'queue',
      queueId: 'support-queue',
      waitUrl: 'https://example.com/music/hold.wav',
      timeout: 60,
      onConnect: 'tag-support',
      onTimeout: 'hangup-timeout',
    },
    {
      id: 'queue-operator',
      type: 'queue',
      queueId: 'operator-queue',
      waitUrl: 'https://example.com/music/hold.wav',
      timeout: 60,
      onConnect: 'tag-operator',
      onTimeout: 'hangup-timeout',
    },
    {
      id: 'tag-sales',
      type: 'tag',
      tags: {
        department: 'sales',
        routedFrom: 'ivr',
      },
      next: 'hangup-normal',
    },
    {
      id: 'tag-support',
      type: 'tag',
      tags: {
        department: 'support',
        routedFrom: 'ivr',
      },
      next: 'hangup-normal',
    },
    {
      id: 'tag-operator',
      type: 'tag',
      tags: {
        department: 'operator',
        routedFrom: 'ivr',
      },
      next: 'hangup-normal',
    },
    {
      id: 'hangup-timeout',
      type: 'hangup',
      reason: 'timeout',
    },
    {
      id: 'hangup-normal',
      type: 'hangup',
      reason: 'normal',
    },
  ],
};

/**
 * Example 3: Buyer rotation with weights, caps, and concurrency limits
 */
export const buyerRotationFlow: Flow = {
  id: 'buyer-rotation',
  name: 'Buyer Rotation with Weights',
  version: '1.0.0',
  description: 'Routes to buyers with weighted rotation and limits',
  entry: {
    id: 'entry-1',
    type: 'entry',
    target: 'if-vip',
  },
  nodes: [
    {
      id: 'if-vip',
      type: 'if',
      condition: "${caller.number == '+1234567890'}",
      then: 'buyer-vip',
      else: 'buyer-standard',
    },
    {
      id: 'buyer-vip',
      type: 'buyer',
      strategy: 'weighted',
      buyers: [
        {
          id: 'buyer-1',
          destination: 'sip:buyer1@example.com',
          weight: 3,
          maxConcurrency: 5,
          maxDailyCalls: 100,
          enabled: true,
        },
        {
          id: 'buyer-2',
          destination: 'sip:buyer2@example.com',
          weight: 2,
          maxConcurrency: 3,
          maxDailyCalls: 50,
          enabled: true,
        },
      ],
      onNoBuyers: 'fallback-all',
      onAllBusy: 'queue-fallback',
      next: 'record-call',
    },
    {
      id: 'buyer-standard',
      type: 'buyer',
      strategy: 'round-robin',
      buyers: [
        {
          id: 'buyer-3',
          destination: 'sip:buyer3@example.com',
          weight: 1,
          maxConcurrency: 10,
          maxDailyCalls: 200,
          enabled: true,
        },
        {
          id: 'buyer-4',
          destination: 'sip:buyer4@example.com',
          weight: 1,
          maxConcurrency: 10,
          maxDailyCalls: 200,
          enabled: true,
        },
        {
          id: 'buyer-5',
          destination: 'sip:buyer5@example.com',
          weight: 1,
          maxConcurrency: 10,
          maxDailyCalls: 200,
          enabled: false, // Disabled buyer
        },
      ],
      onNoBuyers: 'fallback-all',
      onAllBusy: 'queue-fallback',
      next: 'record-call',
    },
    {
      id: 'record-call',
      type: 'record',
      format: 'wav',
      channels: 'dual',
      beep: true,
      onComplete: 'tag-recorded',
      onError: 'tag-error',
    },
    {
      id: 'tag-recorded',
      type: 'tag',
      tags: {
        recorded: true,
        recordingFormat: 'wav',
      },
      next: 'hangup-normal',
    },
    {
      id: 'tag-error',
      type: 'tag',
      tags: {
        recordingError: true,
      },
      next: 'hangup-normal',
    },
    {
      id: 'fallback-all',
      type: 'fallback',
      targets: ['buyer-vip', 'buyer-standard'],
      onAllFailed: 'queue-fallback',
    },
    {
      id: 'queue-fallback',
      type: 'queue',
      queueId: 'fallback-queue',
      waitUrl: 'https://example.com/music/hold.wav',
      timeout: 30,
      onTimeout: 'hangup-timeout',
      onConnect: 'tag-fallback',
    },
    {
      id: 'tag-fallback',
      type: 'tag',
      tags: {
        routedTo: 'fallback-queue',
      },
      next: 'hangup-normal',
    },
    {
      id: 'hangup-timeout',
      type: 'hangup',
      reason: 'timeout',
    },
    {
      id: 'hangup-normal',
      type: 'hangup',
      reason: 'normal',
    },
  ],
};

/**
 * Example 4: Complex flow with whisper, timeout, and conditional routing
 */
export const complexFlow: Flow = {
  id: 'complex-flow',
  name: 'Complex Routing Flow',
  version: '1.0.0',
  description: 'Demonstrates multiple node types working together',
  entry: {
    id: 'entry-1',
    type: 'entry',
    target: 'timeout-1',
  },
  nodes: [
    {
      id: 'timeout-1',
      type: 'timeout',
      duration: 2,
      next: 'whisper-1',
    },
    {
      id: 'whisper-1',
      type: 'whisper',
      callerPrompt: 'https://example.com/prompts/caller-announcement.wav',
      calleePrompt: 'https://example.com/prompts/callee-announcement.wav',
      timeout: 10,
      onAccept: 'tag-accepted',
      onReject: 'hangup-rejected',
    },
    {
      id: 'tag-accepted',
      type: 'tag',
      tags: {
        whisperAccepted: true,
      },
      next: 'if-business-hours',
    },
    {
      id: 'if-business-hours',
      type: 'if',
      condition: "${hour >= 9 && hour < 17}",
      then: 'queue-primary',
      else: 'queue-after-hours',
    },
    {
      id: 'queue-primary',
      type: 'queue',
      queueId: 'primary-queue',
      waitUrl: 'https://example.com/music/hold.wav',
      timeout: 60,
      onConnect: 'tag-primary',
      onTimeout: 'queue-secondary',
    },
    {
      id: 'queue-secondary',
      type: 'queue',
      queueId: 'secondary-queue',
      waitUrl: 'https://example.com/music/hold.wav',
      timeout: 30,
      onConnect: 'tag-secondary',
      onTimeout: 'hangup-timeout',
    },
    {
      id: 'queue-after-hours',
      type: 'queue',
      queueId: 'after-hours-queue',
      waitUrl: 'https://example.com/music/hold.wav',
      timeout: 120,
      onConnect: 'tag-after-hours',
      onTimeout: 'hangup-timeout',
    },
    {
      id: 'tag-primary',
      type: 'tag',
      tags: {
        queue: 'primary',
        businessHours: true,
      },
      next: 'hangup-normal',
    },
    {
      id: 'tag-secondary',
      type: 'tag',
      tags: {
        queue: 'secondary',
        businessHours: true,
      },
      next: 'hangup-normal',
    },
    {
      id: 'tag-after-hours',
      type: 'tag',
      tags: {
        queue: 'after-hours',
        businessHours: false,
      },
      next: 'hangup-normal',
    },
    {
      id: 'hangup-rejected',
      type: 'hangup',
      reason: 'rejected',
    },
    {
      id: 'hangup-timeout',
      type: 'hangup',
      reason: 'timeout',
    },
    {
      id: 'hangup-normal',
      type: 'hangup',
      reason: 'normal',
    },
  ],
};

export const exampleFlows: Record<string, Flow> = {
  'simple-direct-route': simpleDirectRouteFlow,
  'ivr-dtmf': ivrWithDTMFFlow,
  'buyer-rotation': buyerRotationFlow,
  'complex-flow': complexFlow,
};

