import { z } from 'zod';

import { FlowSchema, ExecutionPlanSchema, type Flow, type ExecutionPlan, type Node } from './types.js';

/**
 * Parse and validate a flow from JSON or YAML
 */
export function parseFlow(data: unknown): Flow {
  // If it's a string, try to parse as JSON
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch (err) {
      throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  }

  // Validate against schema
  const flow = FlowSchema.parse(data);

  // Additional validation: ensure entry.target exists in nodes
  const nodeIds = new Set(flow.nodes.map((n) => n.id));
  if (!nodeIds.has(flow.entry.target)) {
    throw new Error(`Entry target node "${flow.entry.target}" not found in nodes`);
  }

  // Validate all node references
  validateNodeReferences(flow.nodes, nodeIds);

  return flow;
}

/**
 * Validate that all node references (next, then, else, etc.) point to valid nodes
 */
function validateNodeReferences(nodes: Node[], validNodeIds: Set<string>): void {
  for (const node of nodes) {
    const references: string[] = [];

    // Collect all node references from this node
    switch (node.type) {
      case 'entry':
        references.push(node.target);
        if (node.next) references.push(node.next);
        break;
      case 'ivr':
        node.choices.forEach((c) => references.push(c.target));
        if (node.default) references.push(node.default);
        if (node.next) references.push(node.next);
        break;
      case 'if':
        references.push(node.then);
        if (node.else) references.push(node.else);
        if (node.next) references.push(node.next);
        break;
      case 'queue':
        if (node.onTimeout) references.push(node.onTimeout);
        if (node.onFull) references.push(node.onFull);
        if (node.onConnect) references.push(node.onConnect);
        if (node.next) references.push(node.next);
        break;
      case 'buyer':
        if (node.onNoBuyers) references.push(node.onNoBuyers);
        if (node.onAllBusy) references.push(node.onAllBusy);
        if (node.next) references.push(node.next);
        break;
      case 'record':
        if (node.onComplete) references.push(node.onComplete);
        if (node.onError) references.push(node.onError);
        if (node.next) references.push(node.next);
        break;
      case 'tag':
        if (node.next) references.push(node.next);
        break;
      case 'whisper':
        if (node.onAccept) references.push(node.onAccept);
        if (node.onReject) references.push(node.onReject);
        if (node.next) references.push(node.next);
        break;
      case 'timeout':
        if (node.next) references.push(node.next);
        break;
      case 'fallback':
        references.push(...node.targets);
        if (node.onAllFailed) references.push(node.onAllFailed);
        if (node.next) references.push(node.next);
        break;
      case 'hangup':
        // No references
        break;
    }

    // Validate all references
    for (const ref of references) {
      if (!validNodeIds.has(ref)) {
        throw new Error(`Node "${node.id}" references non-existent node "${ref}"`);
      }
    }
  }
}

/**
 * Convert a validated flow into an execution plan
 */
export function createExecutionPlan(flow: Flow): ExecutionPlan {
  // Build a map of node ID -> node for fast lookup
  const nodeMap: Record<string, Node> = {};
  for (const node of flow.nodes) {
    if (nodeMap[node.id]) {
      throw new Error(`Duplicate node ID: ${node.id}`);
    }
    nodeMap[node.id] = node;
  }

  // Ensure entry node exists
  if (!nodeMap[flow.entry.id]) {
    throw new Error(`Entry node "${flow.entry.id}" not found in nodes`);
  }

  return {
    flowId: flow.id,
    flowVersion: flow.version,
    entryNodeId: flow.entry.target,
    nodes: nodeMap,
    metadata: flow.metadata,
  };
}

/**
 * Parse and create execution plan in one step
 */
export function parseAndPlan(data: unknown): ExecutionPlan {
  const flow = parseFlow(data);
  return createExecutionPlan(flow);
}

/**
 * Generate JSONSchema for the flow DSL
 */
export function getFlowJSONSchema(): Record<string, unknown> {
  // Convert Zod schema to JSONSchema-like structure
  // This is a simplified version - in production, use zod-to-json-schema
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    type: 'object',
    required: ['id', 'name', 'version', 'entry', 'nodes'],
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      version: { type: 'string' },
      description: { type: 'string' },
      entry: {
        type: 'object',
        required: ['id', 'type', 'target'],
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['entry'] },
          target: { type: 'string' },
        },
      },
      nodes: {
        type: 'array',
        items: {
          oneOf: [
            { $ref: '#/definitions/EntryNode' },
            { $ref: '#/definitions/IVRNode' },
            { $ref: '#/definitions/IfNode' },
            { $ref: '#/definitions/QueueNode' },
            { $ref: '#/definitions/BuyerNode' },
            { $ref: '#/definitions/RecordNode' },
            { $ref: '#/definitions/TagNode' },
            { $ref: '#/definitions/WhisperNode' },
            { $ref: '#/definitions/TimeoutNode' },
            { $ref: '#/definitions/FallbackNode' },
            { $ref: '#/definitions/HangupNode' },
          ],
        },
      },
      metadata: { type: 'object' },
    },
  };
}
