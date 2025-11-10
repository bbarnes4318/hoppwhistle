import type { Flow } from '@hopwhistle/routing-dsl';
import type { Node, Edge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';

export class FlowSerializer {
  serializeToFlow(
    nodes: Node[],
    edges: Edge[],
    name: string,
    version: string,
    flowId: string | null
  ): Flow {
    const entryNode = nodes.find(n => n.type === 'entry');
    if (!entryNode) {
      throw new Error('Flow must have an entry node');
    }

    // Build node map
    const nodeMap = new Map<string, Node>();
    nodes.forEach(node => {
      nodeMap.set(node.id, node);
    });

    // Build edge map: source -> targets
    const edgeMap = new Map<
      string,
      Array<{ target: string; condition?: string; weight?: number }>
    >();
    edges.forEach(edge => {
      if (!edgeMap.has(edge.source)) {
        edgeMap.set(edge.source, []);
      }
      edgeMap.get(edge.source)!.push({
        target: edge.target,
        condition: edge.data?.condition,
        weight: edge.data?.weight,
      });
    });

    // Convert nodes to Flow format
    const flowNodes = nodes
      .filter(node => node.type !== 'entry')
      .map(node => this.convertNodeToFlowNode(node, edgeMap));

    // Create entry node
    const entryTarget = entryNode.data.config?.target as string | undefined;
    const entryEdges = edgeMap.get(entryNode.id) || [];
    const target = entryTarget || entryEdges[0]?.target || flowNodes[0]?.id || '';

    const entryFlowNode = {
      id: entryNode.id,
      type: 'entry' as const,
      target,
    };

    return {
      id: flowId || `flow-${Date.now()}`,
      name,
      version,
      entry: entryFlowNode,
      nodes: flowNodes,
    };
  }

  private convertNodeToFlowNode(
    node: Node,
    edgeMap: Map<string, Array<{ target: string; condition?: string; weight?: number }>>
  ): Flow['nodes'][number] {
    const config = (node.data.config || {}) as Record<string, unknown>;
    const outgoingEdges = edgeMap.get(node.id) || [];
    const next = outgoingEdges[0]?.target;

    switch (node.type) {
      case 'ivr': {
        const choices = outgoingEdges
          .filter(e => e.condition)
          .map(e => ({
            digits: e.condition || '',
            target: e.target,
          }));

        return {
          id: node.id,
          type: 'ivr',
          prompt: (config.prompt as string) || '',
          timeout: (config.timeout as number) || undefined,
          maxDigits: (config.maxDigits as number) || undefined,
          finishOnKey: (config.finishOnKey as string) || undefined,
          choices,
          default: outgoingEdges.find(e => !e.condition)?.target || config.default,
          ...(next ? { next } : {}),
        };
      }

      case 'if': {
        const thenEdge = outgoingEdges.find(e => e.condition === 'true' || e.weight === 1);
        const elseEdge = outgoingEdges.find(e => e.condition === 'false' || e.weight === 0);

        return {
          id: node.id,
          type: 'if',
          condition: (config.condition as string) || '',
          then: thenEdge?.target || (config.then as string) || '',
          else: elseEdge?.target || (config.else as string) || undefined,
        };
      }

      case 'queue': {
        const onConnectEdge = outgoingEdges.find(e => e.condition === 'connected');
        const onTimeoutEdge = outgoingEdges.find(e => e.condition === 'timeout');
        const onFullEdge = outgoingEdges.find(e => e.condition === 'full');

        return {
          id: node.id,
          type: 'queue',
          queueId: (config.queueId as string) || '',
          waitUrl: (config.waitUrl as string) || undefined,
          timeout: (config.timeout as number) || undefined,
          maxSize: (config.maxSize as number) || undefined,
          onTimeout: onTimeoutEdge?.target || (config.onTimeout as string) || undefined,
          onFull: onFullEdge?.target || (config.onFull as string) || undefined,
          onConnect: onConnectEdge?.target || (config.onConnect as string) || undefined,
        };
      }

      case 'buyer': {
        return {
          id: node.id,
          type: 'buyer',
          buyers:
            (config.buyers as Array<{
              id: string;
              destination: string;
              weight?: number;
              maxConcurrency?: number;
              maxDailyCalls?: number;
              enabled?: boolean;
            }>) || [],
          strategy:
            (config.strategy as 'round-robin' | 'weighted' | 'least-calls') || 'round-robin',
          onNoBuyers:
            outgoingEdges.find(e => e.condition === 'no-buyers')?.target ||
            (config.onNoBuyers as string) ||
            undefined,
          onAllBusy:
            outgoingEdges.find(e => e.condition === 'all-busy')?.target ||
            (config.onAllBusy as string) ||
            undefined,
          ...(next ? { next } : {}),
        };
      }

      case 'record': {
        const onCompleteEdge = outgoingEdges.find(e => e.condition === 'complete');
        const onErrorEdge = outgoingEdges.find(e => e.condition === 'error');

        return {
          id: node.id,
          type: 'record',
          format: (config.format as 'wav' | 'mp3') || 'wav',
          channels: (config.channels as 'single' | 'dual') || 'dual',
          beep: (config.beep as boolean) || false,
          onComplete: onCompleteEdge?.target || (config.onComplete as string) || undefined,
          onError: onErrorEdge?.target || (config.onError as string) || undefined,
        };
      }

      case 'tag': {
        return {
          id: node.id,
          type: 'tag',
          tags: (config.tags as Record<string, string | number | boolean>) || {},
          ...(next ? { next } : {}),
        };
      }

      case 'whisper': {
        const onAcceptEdge = outgoingEdges.find(e => e.condition === 'accept');
        const onRejectEdge = outgoingEdges.find(e => e.condition === 'reject');

        return {
          id: node.id,
          type: 'whisper',
          callerPrompt: (config.callerPrompt as string) || undefined,
          calleePrompt: (config.calleePrompt as string) || undefined,
          onAccept: onAcceptEdge?.target || (config.onAccept as string) || undefined,
          onReject: onRejectEdge?.target || (config.onReject as string) || undefined,
          timeout: (config.timeout as number) || undefined,
        };
      }

      case 'timeout': {
        return {
          id: node.id,
          type: 'timeout',
          duration: (config.duration as number) || 0,
          ...(next ? { next } : {}),
        };
      }

      case 'fallback': {
        const targets = outgoingEdges.map(e => e.target);

        return {
          id: node.id,
          type: 'fallback',
          targets: targets.length > 0 ? targets : (config.targets as string[]) || [],
          onAllFailed:
            outgoingEdges.find(e => e.condition === 'all-failed')?.target ||
            (config.onAllFailed as string) ||
            undefined,
        };
      }

      case 'hangup': {
        return {
          id: node.id,
          type: 'hangup',
          reason:
            (config.reason as 'normal' | 'busy' | 'rejected' | 'timeout' | 'error') || 'normal',
        };
      }

      default:
        throw new Error(`Unknown node type: ${node.type}`);
    }
  }

  /**
   * Deserialize a Flow from backend format to React Flow nodes and edges
   */
  deserializeFromFlow(flow: Flow): { nodes: Node[]; edges: Edge[] } {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    // Create entry node
    const entryNode: Node = {
      id: flow.entry.id,
      type: 'entry',
      position: { x: 250, y: 100 },
      data: {
        label: 'Entry',
        nodeType: 'entry',
        config: {
          target: flow.entry.target,
        },
      },
    };
    nodes.push(entryNode);

    // Create edges from entry
    if (flow.entry.target) {
      edges.push({
        id: `edge-${flow.entry.id}-${flow.entry.target}`,
        source: flow.entry.id,
        target: flow.entry.target,
        type: 'smoothstep',
        animated: true,
        markerEnd: { type: MarkerType.ArrowClosed },
      });
    }

    // Convert flow nodes to React Flow nodes
    const nodePositions = new Map<string, { x: number; y: number }>();
    const xOffset = 250;
    const yOffset = 200;

    flow.nodes.forEach((flowNode, index) => {
      // Calculate position (simple grid layout)
      const row = Math.floor(index / 3);
      const col = index % 3;
      const position = {
        x: xOffset + col * 300,
        y: yOffset + row * 150,
      };
      nodePositions.set(flowNode.id, position);

      const reactNode = this.convertFlowNodeToNode(flowNode, position);
      nodes.push(reactNode);

      // Create edges based on node type
      this.createEdgesFromFlowNode(flowNode, edges);
    });

    return { nodes, edges };
  }

  private convertFlowNodeToNode(
    flowNode: Flow['nodes'][number],
    position: { x: number; y: number }
  ): Node {
    const baseNode: Node = {
      id: flowNode.id,
      type: flowNode.type,
      position,
      data: {
        label: flowNode.type.charAt(0).toUpperCase() + flowNode.type.slice(1),
        nodeType: flowNode.type,
        config: {},
      },
    };

    switch (flowNode.type) {
      case 'ivr':
        baseNode.data.config = {
          prompt: flowNode.prompt,
          timeout: flowNode.timeout,
          maxDigits: flowNode.maxDigits,
          finishOnKey: flowNode.finishOnKey,
          default: flowNode.default,
        };
        break;

      case 'if':
        baseNode.data.config = {
          condition: flowNode.condition,
          then: flowNode.then,
          else: flowNode.else,
        };
        break;

      case 'queue':
        baseNode.data.config = {
          queueId: flowNode.queueId,
          waitUrl: flowNode.waitUrl,
          timeout: flowNode.timeout,
          maxSize: flowNode.maxSize,
          onTimeout: flowNode.onTimeout,
          onFull: flowNode.onFull,
          onConnect: flowNode.onConnect,
        };
        break;

      case 'buyer':
        baseNode.data.config = {
          buyers: flowNode.buyers,
          strategy: flowNode.strategy,
          onNoBuyers: flowNode.onNoBuyers,
          onAllBusy: flowNode.onAllBusy,
        };
        break;

      case 'record':
        baseNode.data.config = {
          format: flowNode.format,
          channels: flowNode.channels,
          beep: flowNode.beep,
          onComplete: flowNode.onComplete,
          onError: flowNode.onError,
        };
        break;

      case 'tag':
        baseNode.data.config = {
          tags: flowNode.tags,
        };
        break;

      case 'whisper':
        baseNode.data.config = {
          callerPrompt: flowNode.callerPrompt,
          calleePrompt: flowNode.calleePrompt,
          onAccept: flowNode.onAccept,
          onReject: flowNode.onReject,
          timeout: flowNode.timeout,
        };
        break;

      case 'timeout':
        baseNode.data.config = {
          duration: flowNode.duration,
        };
        break;

      case 'fallback':
        baseNode.data.config = {
          targets: flowNode.targets,
          onAllFailed: flowNode.onAllFailed,
        };
        break;

      case 'hangup':
        baseNode.data.config = {
          reason: flowNode.reason,
        };
        break;
    }

    return baseNode;
  }

  private createEdgesFromFlowNode(
    flowNode: Flow['nodes'][number],
    edges: Edge[]
  ): void {
    switch (flowNode.type) {
      case 'ivr':
        // Create edges for IVR choices
        if (flowNode.choices) {
          flowNode.choices.forEach((choice, index) => {
            edges.push({
              id: `edge-${flowNode.id}-${choice.target}-${index}`,
              source: flowNode.id,
              target: choice.target,
              type: 'smoothstep',
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed },
              data: { condition: choice.digits },
            });
          });
        }
        // Default edge
        if (flowNode.default) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.default}-default`,
            source: flowNode.id,
            target: flowNode.default,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
        // Next edge
        if ('next' in flowNode && flowNode.next) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.next}-next`,
            source: flowNode.id,
            target: flowNode.next,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
        break;

      case 'if':
        if (flowNode.then) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.then}-then`,
            source: flowNode.id,
            target: flowNode.then,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'true' },
          });
        }
        if (flowNode.else) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.else}-else`,
            source: flowNode.id,
            target: flowNode.else,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'false' },
          });
        }
        break;

      case 'queue':
        if (flowNode.onConnect) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onConnect}-connect`,
            source: flowNode.id,
            target: flowNode.onConnect,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'connected' },
          });
        }
        if (flowNode.onTimeout) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onTimeout}-timeout`,
            source: flowNode.id,
            target: flowNode.onTimeout,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'timeout' },
          });
        }
        if (flowNode.onFull) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onFull}-full`,
            source: flowNode.id,
            target: flowNode.onFull,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'full' },
          });
        }
        break;

      case 'buyer':
        if ('next' in flowNode && flowNode.next) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.next}-next`,
            source: flowNode.id,
            target: flowNode.next,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
        if (flowNode.onNoBuyers) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onNoBuyers}-no-buyers`,
            source: flowNode.id,
            target: flowNode.onNoBuyers,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'no-buyers' },
          });
        }
        if (flowNode.onAllBusy) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onAllBusy}-all-busy`,
            source: flowNode.id,
            target: flowNode.onAllBusy,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'all-busy' },
          });
        }
        break;

      case 'record':
        if (flowNode.onComplete) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onComplete}-complete`,
            source: flowNode.id,
            target: flowNode.onComplete,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'complete' },
          });
        }
        if (flowNode.onError) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onError}-error`,
            source: flowNode.id,
            target: flowNode.onError,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'error' },
          });
        }
        break;

      case 'tag':
        if ('next' in flowNode && flowNode.next) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.next}-next`,
            source: flowNode.id,
            target: flowNode.next,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
        break;

      case 'whisper':
        if (flowNode.onAccept) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onAccept}-accept`,
            source: flowNode.id,
            target: flowNode.onAccept,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'accept' },
          });
        }
        if (flowNode.onReject) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onReject}-reject`,
            source: flowNode.id,
            target: flowNode.onReject,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'reject' },
          });
        }
        break;

      case 'timeout':
        if ('next' in flowNode && flowNode.next) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.next}-next`,
            source: flowNode.id,
            target: flowNode.next,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
          });
        }
        break;

      case 'fallback':
        if (flowNode.targets) {
          flowNode.targets.forEach((target, index) => {
            edges.push({
              id: `edge-${flowNode.id}-${target}-${index}`,
              source: flowNode.id,
              target: target,
              type: 'smoothstep',
              animated: true,
              markerEnd: { type: MarkerType.ArrowClosed },
            });
          });
        }
        if (flowNode.onAllFailed) {
          edges.push({
            id: `edge-${flowNode.id}-${flowNode.onAllFailed}-all-failed`,
            source: flowNode.id,
            target: flowNode.onAllFailed,
            type: 'smoothstep',
            animated: true,
            markerEnd: { type: MarkerType.ArrowClosed },
            data: { condition: 'all-failed' },
          });
        }
        break;

      case 'hangup':
        // No outgoing edges
        break;
    }
  }
}
