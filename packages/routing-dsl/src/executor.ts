import type {
  ExecutionPlan,
  ExecutionContext,
  TelephonyEvent,
  Node,
  IVRNode,
  IfNode,
  QueueNode,
  BuyerNode,
  RecordNode,
  TagNode,
  WhisperNode,
  TimeoutNode,
  FallbackNode,
  HangupNode,
} from './types.js';

export interface ExecutionResult {
  nextNodeId: string | null;
  action: ExecutionAction;
  context: ExecutionContext;
}

export interface ExecutionAction {
  type: string;
  params?: Record<string, unknown>;
}

/**
 * Execute a node and return the next node to execute
 */
export function executeNode(
  plan: ExecutionPlan,
  context: ExecutionContext,
  event?: TelephonyEvent
): ExecutionResult {
  const node = plan.nodes[context.currentNodeId];

  if (!node) {
    throw new Error(`Node "${context.currentNodeId}" not found in plan`);
  }

  // Update history
  const updatedContext: ExecutionContext = {
    ...context,
    history: [
      ...context.history,
      {
        nodeId: context.currentNodeId,
        timestamp: new Date().toISOString(),
        data: event ? { eventType: event.type } : undefined,
      },
    ],
  };

  // Execute based on node type
  switch (node.type) {
    case 'entry':
      return {
        nextNodeId: node.target,
        action: { type: 'continue' },
        context: updatedContext,
      };

    case 'ivr':
      return executeIVRNode(node, updatedContext, event);

    case 'if':
      return executeIfNode(node, updatedContext);

    case 'queue':
      return executeQueueNode(node, updatedContext, event);

    case 'buyer':
      return executeBuyerNode(node, updatedContext);

    case 'record':
      return executeRecordNode(node, updatedContext, event);

    case 'tag':
      return executeTagNode(node, updatedContext);

    case 'whisper':
      return executeWhisperNode(node, updatedContext, event);

    case 'timeout':
      return executeTimeoutNode(node, updatedContext);

    case 'fallback':
      return executeFallbackNode(node, updatedContext);

    case 'hangup':
      return executeHangupNode(node, updatedContext);

    default:
      throw new Error(`Unknown node type: ${(node as Node).type}`);
  }
}

function executeIVRNode(
  node: IVRNode,
  context: ExecutionContext,
  event?: TelephonyEvent
): ExecutionResult {
  // If we have DTMF input, check for matches
  if (event?.type === 'dtmf.received') {
    const digits = event.digits;
    context.ivrInput = (context.ivrInput || '') + digits;

    // Check if we have a match
    for (const choice of node.choices) {
      if (context.ivrInput === choice.digits) {
        return {
          nextNodeId: choice.target,
          action: {
            type: 'play',
            params: { url: node.prompt },
          },
          context: {
            ...context,
            currentNodeId: choice.target,
          },
        };
      }
    }

    // Check if we've exceeded max digits
    if (node.maxDigits && context.ivrInput.length >= node.maxDigits) {
      return {
        nextNodeId: node.default || null,
        action: {
          type: 'play',
          params: { url: node.prompt },
        },
        context: {
          ...context,
          currentNodeId: node.default || context.currentNodeId,
        },
      };
    }

    // Continue waiting for more digits
    return {
      nextNodeId: null, // Stay on current node
      action: {
        type: 'play',
        params: { url: node.prompt },
      },
      context,
    };
  }

  // Initial IVR prompt
  return {
    nextNodeId: null, // Wait for DTMF
    action: {
      type: 'play',
      params: { url: node.prompt },
    },
    context: {
      ...context,
      currentNodeId: node.id,
    },
  };
}

function executeIfNode(node: IfNode, context: ExecutionContext): ExecutionResult {
  // Simple expression evaluation (in production, use a proper expression parser)
  const condition = evaluateCondition(node.condition, context);

  const nextNodeId = condition ? node.then : node.else || null;

  return {
    nextNodeId,
    action: { type: 'continue' },
    context: {
      ...context,
      currentNodeId: nextNodeId || context.currentNodeId,
    },
  };
}

function executeQueueNode(
  node: QueueNode,
  context: ExecutionContext,
  event?: TelephonyEvent
): ExecutionResult {
  if (event?.type === 'queue.connected') {
    return {
      nextNodeId: node.onConnect || node.next || null,
      action: {
        type: 'queue.connect',
        params: { queueId: node.queueId, agentId: event.agentId },
      },
      context: {
        ...context,
        currentNodeId: node.onConnect || context.currentNodeId,
      },
    };
  }

  if (event?.type === 'queue.timeout') {
    return {
      nextNodeId: node.onTimeout || node.next || null,
      action: {
        type: 'queue.timeout',
        params: { queueId: node.queueId },
      },
      context: {
        ...context,
        currentNodeId: node.onTimeout || context.currentNodeId,
      },
    };
  }

  // Start queueing
  return {
    nextNodeId: null, // Wait for queue event
    action: {
      type: 'queue.join',
      params: {
        queueId: node.queueId,
        waitUrl: node.waitUrl,
        timeout: node.timeout,
        maxSize: node.maxSize,
      },
    },
    context: {
      ...context,
      currentNodeId: node.id,
    },
  };
}

function executeBuyerNode(node: BuyerNode, context: ExecutionContext): ExecutionResult {
  // Filter enabled buyers
  const availableBuyers = node.buyers.filter((b) => b.enabled);

  if (availableBuyers.length === 0) {
    return {
      nextNodeId: node.onNoBuyers || node.next || null,
      action: { type: 'buyer.none' },
      context: {
        ...context,
        currentNodeId: node.onNoBuyers || context.currentNodeId,
      },
    };
  }

  // Select buyer based on strategy
  const selectedBuyer = selectBuyer(availableBuyers, node.strategy, context);

  if (!selectedBuyer) {
    return {
      nextNodeId: node.onAllBusy || node.next || null,
      action: { type: 'buyer.allBusy' },
      context: {
        ...context,
        currentNodeId: node.onAllBusy || context.currentNodeId,
      },
    };
  }

  return {
    nextNodeId: node.next || null,
    action: {
      type: 'buyer.route',
      params: {
        buyerId: selectedBuyer.id,
        destination: selectedBuyer.destination,
      },
    },
    context: {
      ...context,
      currentNodeId: node.next || context.currentNodeId,
    },
  };
}

function executeRecordNode(
  node: RecordNode,
  context: ExecutionContext,
  event?: TelephonyEvent
): ExecutionResult {
  if (event?.type === 'recording.completed') {
    return {
      nextNodeId: node.onComplete || node.next || null,
      action: {
        type: 'record.complete',
        params: { url: event.url },
      },
      context: {
        ...context,
        currentNodeId: node.onComplete || context.currentNodeId,
        recordingUrl: event.url,
      },
    };
  }

  // Start recording
  return {
    nextNodeId: null, // Wait for recording to complete
    action: {
      type: 'record.start',
      params: {
        format: node.format,
        channels: node.channels,
        beep: node.beep,
      },
    },
    context: {
      ...context,
      currentNodeId: node.id,
    },
  };
}

function executeTagNode(node: TagNode, context: ExecutionContext): ExecutionResult {
  return {
    nextNodeId: node.next || null,
    action: {
      type: 'tag',
      params: { tags: node.tags },
    },
    context: {
      ...context,
      currentNodeId: node.next || context.currentNodeId,
      tags: { ...context.tags, ...node.tags },
    },
  };
}

function executeWhisperNode(
  node: WhisperNode,
  context: ExecutionContext,
  event?: TelephonyEvent
): ExecutionResult {
  if (event?.type === 'whisper.accepted') {
    return {
      nextNodeId: node.onAccept || node.next || null,
      action: {
        type: 'whisper.accept',
      },
      context: {
        ...context,
        currentNodeId: node.onAccept || context.currentNodeId,
      },
    };
  }

  if (event?.type === 'whisper.rejected') {
    return {
      nextNodeId: node.onReject || node.next || null,
      action: {
        type: 'whisper.reject',
      },
      context: {
        ...context,
        currentNodeId: node.onReject || context.currentNodeId,
      },
    };
  }

  // Start whisper
  return {
    nextNodeId: null, // Wait for accept/reject
    action: {
      type: 'whisper.start',
      params: {
        callerPrompt: node.callerPrompt,
        calleePrompt: node.calleePrompt,
        timeout: node.timeout,
      },
    },
    context: {
      ...context,
      currentNodeId: node.id,
    },
  };
}

function executeTimeoutNode(node: TimeoutNode, context: ExecutionContext): ExecutionResult {
  return {
    nextNodeId: node.next || null,
    action: {
      type: 'timeout',
      params: { duration: node.duration },
    },
    context: {
      ...context,
      currentNodeId: node.next || context.currentNodeId,
    },
  };
}

function executeFallbackNode(node: FallbackNode, context: ExecutionContext): ExecutionResult {
  // Try first target
  const firstTarget = node.targets[0];
  if (firstTarget) {
    return {
      nextNodeId: firstTarget,
      action: {
        type: 'fallback.try',
        params: { target: firstTarget, index: 0 },
      },
      context: {
        ...context,
        currentNodeId: firstTarget,
      },
    };
  }

  // No targets, go to failure handler
  return {
    nextNodeId: node.onAllFailed || null,
    action: { type: 'fallback.failed' },
    context: {
      ...context,
      currentNodeId: node.onAllFailed || context.currentNodeId,
    },
  };
}

function executeHangupNode(node: HangupNode, context: ExecutionContext): ExecutionResult {
  return {
    nextNodeId: null, // End of flow
    action: {
      type: 'hangup',
      params: { reason: node.reason },
    },
    context: {
      ...context,
      currentNodeId: node.id,
    },
  };
}

/**
 * Simple condition evaluator (in production, use a proper expression parser)
 */
function evaluateCondition(condition: string, context: ExecutionContext): boolean {
  // Simple variable substitution: ${variable.name}
  const evaluated = condition.replace(/\$\{([^}]+)\}/g, (_, varPath) => {
    const parts = varPath.split('.');
    let value: unknown = context.variables;

    for (const part of parts) {
      if (value && typeof value === 'object' && part in value) {
        value = (value as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }

    return String(value);
  });

  // Simple boolean evaluation (very basic - in production use a proper parser)
  try {
    // eslint-disable-next-line no-eval
    return Boolean(eval(evaluated));
  } catch {
    return false;
  }
}

/**
 * Select a buyer based on strategy
 */
function selectBuyer(
  buyers: BuyerNode['buyers'],
  strategy: BuyerNode['strategy'],
  context: ExecutionContext
): BuyerNode['buyers'][0] | null {
  if (buyers.length === 0) return null;

  switch (strategy) {
    case 'round-robin':
      // Simple round-robin (in production, track state)
      return buyers[0];

    case 'weighted':
      // Weighted random selection
      const totalWeight = buyers.reduce((sum, b) => sum + b.weight, 0);
      let random = Math.random() * totalWeight;
      for (const buyer of buyers) {
        random -= buyer.weight;
        if (random <= 0) {
          return buyer;
        }
      }
      return buyers[0];

    case 'least-calls':
      // Select buyer with least calls (in production, track call counts)
      return buyers[0];

    default:
      return buyers[0];
  }
}
