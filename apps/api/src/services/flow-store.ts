import type { Flow, ExecutionPlan } from '@hopwhistle/routing-dsl';
import { parseFlow, createExecutionPlan } from '@hopwhistle/routing-dsl';

import { getPrismaClient } from '../lib/prisma.js';

export interface FlowVersion {
  id: string;
  flowId: string;
  version: string;
  flow: Flow;
  plan: ExecutionPlan;
  published: boolean;
  publishedAt?: string;
  createdAt: string;
  createdBy?: string;
}

/**
 * Database-backed flow store using Prisma
 */
class FlowStore {
  /**
   * Store a new flow version
   */
  async storeFlow(flow: Flow, createdBy?: string, tenantId?: string): Promise<FlowVersion> {
    const prisma = getPrismaClient();
    const plan = createExecutionPlan(flow);

    // Parse version string to integer (e.g., "1.0.0" -> 1, or "2" -> 2)
    const versionInt = this.parseVersion(flow.version);

    // Check if flow exists, create if not
    let dbFlow = await prisma.flow.findUnique({
      where: { id: flow.id },
    });

    if (!dbFlow) {
      if (!tenantId) {
        throw new Error('tenantId is required when creating a new flow');
      }
      dbFlow = await prisma.flow.create({
        data: {
          id: flow.id,
          tenantId: tenantId,
          name: flow.name || 'Unnamed Flow',
          status: 'DRAFT',
          metadata: {},
        },
      });
    } else {
      // Update flow name if it changed
      if (flow.name && flow.name !== dbFlow.name) {
        dbFlow = await prisma.flow.update({
          where: { id: flow.id },
          data: { name: flow.name },
        });
      }
    }

    // Check if version already exists
    const existingVersion = await prisma.flowVersion.findUnique({
      where: {
        flowId_version: {
          flowId: flow.id,
          version: versionInt,
        },
      },
    });

    if (existingVersion) {
      // Update existing version
      await prisma.flowVersion.update({
        where: { id: existingVersion.id },
        data: {
          metadata: {
            flow: flow,
            plan: plan,
            createdBy: createdBy,
          },
          updatedAt: new Date(),
        },
      });

      // Delete old nodes and edges
      await prisma.node.deleteMany({
        where: { flowVersionId: existingVersion.id },
      });
      await prisma.edge.deleteMany({
        where: { flowVersionId: existingVersion.id },
      });

      // Recreate nodes and edges
      await this.saveNodesAndEdges(existingVersion.id, flow);

      const version: FlowVersion = {
        id: existingVersion.id,
        flowId: flow.id,
        version: flow.version,
        flow,
        plan,
        published: existingVersion.isActive,
        publishedAt: existingVersion.isActive ? existingVersion.updatedAt.toISOString() : undefined,
        createdAt: existingVersion.createdAt.toISOString(),
        createdBy: createdBy,
      };

      return version;
    } else {
      // Create new version
      const dbVersion = await prisma.flowVersion.create({
        data: {
          flowId: flow.id,
          version: versionInt,
          isActive: false,
          metadata: {
            flow: flow,
            plan: plan,
            createdBy: createdBy,
          },
        },
      });

      // Create nodes and edges
      await this.saveNodesAndEdges(dbVersion.id, flow);

      const version: FlowVersion = {
        id: dbVersion.id,
        flowId: flow.id,
        version: flow.version,
        flow,
        plan,
        published: false,
        createdAt: dbVersion.createdAt.toISOString(),
        createdBy: createdBy,
      };

      return version;
    }
  }

  private async saveNodesAndEdges(flowVersionId: string, flow: Flow): Promise<void> {
    const prisma = getPrismaClient();

    // Create entry node
    const entryNode = await prisma.node.create({
      data: {
        flowVersionId,
        type: 'IVR', // Entry is represented as IVR type
        name: 'Entry',
        config: {
          target: flow.entry.target,
        },
        position: { x: 250, y: 100 },
      },
    });

    // Create all flow nodes
    const nodeMap = new Map<string, string>(); // flow node id -> db node id
    nodeMap.set(flow.entry.id, entryNode.id);

    for (const flowNode of flow.nodes) {
      const dbNode = await prisma.node.create({
        data: {
          flowVersionId,
          type: this.mapNodeType(flowNode.type),
          name: flowNode.type.charAt(0).toUpperCase() + flowNode.type.slice(1),
          config: this.extractNodeConfig(flowNode),
          position: { x: 0, y: 0 }, // Will be updated by UI
        },
      });
      nodeMap.set(flowNode.id, dbNode.id);
    }

    // Create edges
    // Entry edge
    if (flow.entry.target) {
      const targetNodeId = nodeMap.get(flow.entry.target);
      if (targetNodeId) {
        await prisma.edge.create({
          data: {
            flowVersionId,
            fromNodeId: entryNode.id,
            toNodeId: targetNodeId,
            condition: null,
            priority: 0,
          },
        });
      }
    }

    // Create edges for each node
    for (const flowNode of flow.nodes) {
      const fromNodeId = nodeMap.get(flowNode.id);
      if (!fromNodeId) continue;

      const edges = this.extractEdges(flowNode);
      for (let i = 0; i < edges.length; i++) {
        const edge = edges[i];
        const toNodeId = nodeMap.get(edge.target);
        if (toNodeId) {
          await prisma.edge.create({
            data: {
              flowVersionId,
              fromNodeId,
              toNodeId,
              condition: edge.condition || null,
              priority: i,
            },
          });
        }
      }
    }
  }

  private extractNodeConfig(flowNode: Flow['nodes'][number]): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    
    switch (flowNode.type) {
      case 'ivr':
        config.prompt = flowNode.prompt;
        config.timeout = flowNode.timeout;
        config.maxDigits = flowNode.maxDigits;
        config.finishOnKey = flowNode.finishOnKey;
        config.choices = flowNode.choices;
        config.default = flowNode.default;
        if ('next' in flowNode) config.next = flowNode.next;
        break;
      case 'if':
        config.condition = flowNode.condition;
        config.then = flowNode.then;
        config.else = flowNode.else;
        break;
      case 'queue':
        config.queueId = flowNode.queueId;
        config.waitUrl = flowNode.waitUrl;
        config.timeout = flowNode.timeout;
        config.maxSize = flowNode.maxSize;
        config.onTimeout = flowNode.onTimeout;
        config.onFull = flowNode.onFull;
        config.onConnect = flowNode.onConnect;
        break;
      case 'buyer':
        config.buyers = flowNode.buyers;
        config.strategy = flowNode.strategy;
        config.onNoBuyers = flowNode.onNoBuyers;
        config.onAllBusy = flowNode.onAllBusy;
        if ('next' in flowNode) config.next = flowNode.next;
        break;
      case 'record':
        config.format = flowNode.format;
        config.channels = flowNode.channels;
        config.beep = flowNode.beep;
        config.onComplete = flowNode.onComplete;
        config.onError = flowNode.onError;
        break;
      case 'tag':
        config.tags = flowNode.tags;
        if ('next' in flowNode) config.next = flowNode.next;
        break;
      case 'whisper':
        config.callerPrompt = flowNode.callerPrompt;
        config.calleePrompt = flowNode.calleePrompt;
        config.onAccept = flowNode.onAccept;
        config.onReject = flowNode.onReject;
        config.timeout = flowNode.timeout;
        break;
      case 'timeout':
        config.duration = flowNode.duration;
        if ('next' in flowNode) config.next = flowNode.next;
        break;
      case 'fallback':
        config.targets = flowNode.targets;
        config.onAllFailed = flowNode.onAllFailed;
        break;
      case 'hangup':
        config.reason = flowNode.reason;
        break;
    }
    
    return config;
  }

  private extractEdges(flowNode: Flow['nodes'][number]): Array<{ target: string; condition?: string }> {
    const edges: Array<{ target: string; condition?: string }> = [];

    switch (flowNode.type) {
      case 'ivr':
        if (flowNode.choices) {
          flowNode.choices.forEach(choice => {
            edges.push({ target: choice.target, condition: choice.digits });
          });
        }
        if (flowNode.default) {
          edges.push({ target: flowNode.default });
        }
        if ('next' in flowNode && flowNode.next) {
          edges.push({ target: flowNode.next });
        }
        break;
      case 'if':
        if (flowNode.then) {
          edges.push({ target: flowNode.then, condition: 'true' });
        }
        if (flowNode.else) {
          edges.push({ target: flowNode.else, condition: 'false' });
        }
        break;
      case 'queue':
        if (flowNode.onConnect) {
          edges.push({ target: flowNode.onConnect, condition: 'connected' });
        }
        if (flowNode.onTimeout) {
          edges.push({ target: flowNode.onTimeout, condition: 'timeout' });
        }
        if (flowNode.onFull) {
          edges.push({ target: flowNode.onFull, condition: 'full' });
        }
        break;
      case 'buyer':
        if ('next' in flowNode && flowNode.next) {
          edges.push({ target: flowNode.next });
        }
        if (flowNode.onNoBuyers) {
          edges.push({ target: flowNode.onNoBuyers, condition: 'no-buyers' });
        }
        if (flowNode.onAllBusy) {
          edges.push({ target: flowNode.onAllBusy, condition: 'all-busy' });
        }
        break;
      case 'record':
        if (flowNode.onComplete) {
          edges.push({ target: flowNode.onComplete, condition: 'complete' });
        }
        if (flowNode.onError) {
          edges.push({ target: flowNode.onError, condition: 'error' });
        }
        break;
      case 'tag':
        if ('next' in flowNode && flowNode.next) {
          edges.push({ target: flowNode.next });
        }
        break;
      case 'whisper':
        if (flowNode.onAccept) {
          edges.push({ target: flowNode.onAccept, condition: 'accept' });
        }
        if (flowNode.onReject) {
          edges.push({ target: flowNode.onReject, condition: 'reject' });
        }
        break;
      case 'timeout':
        if ('next' in flowNode && flowNode.next) {
          edges.push({ target: flowNode.next });
        }
        break;
      case 'fallback':
        if (flowNode.targets) {
          flowNode.targets.forEach(target => {
            edges.push({ target });
          });
        }
        if (flowNode.onAllFailed) {
          edges.push({ target: flowNode.onAllFailed, condition: 'all-failed' });
        }
        break;
      case 'hangup':
        // No edges
        break;
    }

    return edges;
  }

  private mapNodeType(type: Flow['nodes'][number]['type']): string {
    const mapping: Record<string, string> = {
      'ivr': 'IVR',
      'if': 'CONDITIONAL',
      'queue': 'QUEUE',
      'buyer': 'BUYER_FORWARD',
      'record': 'RECORDING',
      'tag': 'IVR', // Tag is stored as IVR
      'whisper': 'TRANSFER',
      'timeout': 'IVR',
      'fallback': 'TRANSFER',
      'hangup': 'HANGUP',
    };
    return mapping[type] || 'IVR';
  }

  private parseVersion(version: string): number {
    // Parse version string to integer
    // "1.0.0" -> 1, "2.1.0" -> 2, "2" -> 2
    const match = version.match(/^(\d+)/);
    return match ? parseInt(match[1], 10) : 1;
  }

  /**
   * Get a flow version by ID
   */
  async getFlowVersion(flowId: string, version: string): Promise<FlowVersion | null> {
    const prisma = getPrismaClient();
    const versionInt = this.parseVersion(version);

    const dbVersion = await prisma.flowVersion.findUnique({
      where: {
        flowId_version: {
          flowId,
          version: versionInt,
        },
      },
      include: {
        flow: {
          select: {
            name: true,
          },
        },
        nodes: {
          include: {
            edgesFrom: true,
            edgesTo: true,
          },
        },
        edges: true,
      },
    });

    if (!dbVersion) {
      return null;
    }

    const flow = this.reconstructFlow(dbVersion);
    const plan = (dbVersion.metadata as any)?.plan || createExecutionPlan(flow);

    return {
      id: dbVersion.id,
      flowId: dbVersion.flowId,
      version: version,
      flow,
      plan,
      published: dbVersion.isActive,
      publishedAt: dbVersion.isActive ? dbVersion.updatedAt.toISOString() : undefined,
      createdAt: dbVersion.createdAt.toISOString(),
      createdBy: (dbVersion.metadata as any)?.createdBy,
    };
  }

  private reconstructFlow(dbVersion: any): Flow {
    // Reconstruct Flow from database nodes and edges
    const nodes = dbVersion.nodes;
    const edges = dbVersion.edges;

    if (!nodes || nodes.length === 0) {
      // Fallback to metadata if nodes not loaded
      const flowFromMetadata = (dbVersion.metadata)?.flow;
      if (flowFromMetadata) {
        return flowFromMetadata;
      }
      throw new Error('Flow has no nodes');
    }

    // Find entry node (node with type IVR and name 'Entry', or first node)
    const entryNode = nodes.find((n: any) => n.name === 'Entry') || nodes[0];
    
    // Build node map (db node id -> db node)
    const nodeMap = new Map<string, any>();
    nodes.forEach((node: any) => {
      nodeMap.set(node.id, node);
    });

    // Build edge map (fromNodeId -> edges[])
    const edgeMap = new Map<string, any[]>();
    edges.forEach((edge: any) => {
      if (!edgeMap.has(edge.fromNodeId)) {
        edgeMap.set(edge.fromNodeId, []);
      }
      edgeMap.get(edge.fromNodeId)!.push(edge);
    });

    // Create node ID mapping (we'll use db node IDs as flow node IDs for now)
    // In a real implementation, you might want to store original flow node IDs
    const nodeIdMap = new Map<string, string>();
    nodes.forEach((node: any) => {
      nodeIdMap.set(node.id, node.id); // For now, use same ID
    });

    // Reconstruct flow nodes (all except entry)
    const flowNodes = nodes
      .filter((n: any) => n.id !== entryNode.id)
      .map((node: any) => this.reconstructFlowNode(node, edgeMap, nodeIdMap));

    // Reconstruct entry
    const entryEdges = edgeMap.get(entryNode.id) || [];
    const entryTarget = entryNode.config?.target || (entryEdges[0] ? entryEdges[0].toNodeId : null) || (flowNodes[0]?.id || '');

    // Get flow name from Flow table or metadata
    const flowName = (dbVersion.metadata)?.flow?.name || dbVersion.flow?.name || 'Unnamed Flow';

    return {
      id: dbVersion.flowId,
      name: flowName,
      version: dbVersion.version.toString(),
      entry: {
        id: entryNode.id,
        type: 'entry',
        target: entryTarget,
      },
      nodes: flowNodes,
    };
  }

  private reconstructFlowNode(dbNode: any, edgeMap: Map<string, any[]>, nodeIdMap: Map<string, string>): Flow['nodes'][number] {
    const config = dbNode.config || {};
    const outgoingEdges = edgeMap.get(dbNode.id) || [];

    // Map node type back
    const nodeType = this.mapDbNodeTypeToFlowType(dbNode.type);

    // Helper to get target node ID from edge
    const getTargetId = (edge: any) => {
      const targetDbNodeId = edge.toNodeId;
      // Find the original flow node ID from the nodeIdMap (reverse lookup)
      for (const [flowNodeId, dbNodeId] of nodeIdMap.entries()) {
        if (dbNodeId === targetDbNodeId) {
          return flowNodeId;
        }
      }
      return targetDbNodeId; // Fallback
    };

    switch (nodeType) {
      case 'ivr': {
        const choices = outgoingEdges
          .filter((e: any) => e.condition)
          .map((e: any) => ({
            digits: e.condition || '',
            target: getTargetId(e),
          }));
        const defaultEdge = outgoingEdges.find((e: any) => !e.condition);
        
        return {
          id: dbNode.id,
          type: 'ivr',
          prompt: config.prompt || '',
          timeout: config.timeout,
          maxDigits: config.maxDigits,
          finishOnKey: config.finishOnKey,
          choices: choices.length > 0 ? choices : (config.choices || []),
          default: defaultEdge ? getTargetId(defaultEdge) : config.default,
          ...(config.next ? { next: config.next } : {}),
        };
      }
      case 'if': {
        const thenEdge = outgoingEdges.find((e: any) => e.condition === 'true');
        const elseEdge = outgoingEdges.find((e: any) => e.condition === 'false');
        
        return {
          id: dbNode.id,
          type: 'if',
          condition: config.condition || '',
          then: thenEdge ? getTargetId(thenEdge) : (config.then || ''),
          else: elseEdge ? getTargetId(elseEdge) : config.else,
        };
      }
      case 'queue': {
        const onConnectEdge = outgoingEdges.find((e: any) => e.condition === 'connected');
        const onTimeoutEdge = outgoingEdges.find((e: any) => e.condition === 'timeout');
        const onFullEdge = outgoingEdges.find((e: any) => e.condition === 'full');
        
        return {
          id: dbNode.id,
          type: 'queue',
          queueId: config.queueId || '',
          waitUrl: config.waitUrl,
          timeout: config.timeout,
          maxSize: config.maxSize,
          onTimeout: onTimeoutEdge ? getTargetId(onTimeoutEdge) : config.onTimeout,
          onFull: onFullEdge ? getTargetId(onFullEdge) : config.onFull,
          onConnect: onConnectEdge ? getTargetId(onConnectEdge) : config.onConnect,
        };
      }
      case 'buyer': {
        const nextEdge = outgoingEdges.find((e: any) => !e.condition);
        const onNoBuyersEdge = outgoingEdges.find((e: any) => e.condition === 'no-buyers');
        const onAllBusyEdge = outgoingEdges.find((e: any) => e.condition === 'all-busy');
        
        return {
          id: dbNode.id,
          type: 'buyer',
          buyers: config.buyers || [],
          strategy: config.strategy || 'round-robin',
          onNoBuyers: onNoBuyersEdge ? getTargetId(onNoBuyersEdge) : config.onNoBuyers,
          onAllBusy: onAllBusyEdge ? getTargetId(onAllBusyEdge) : config.onAllBusy,
          ...(nextEdge ? { next: getTargetId(nextEdge) } : (config.next ? { next: config.next } : {})),
        };
      }
      case 'record': {
        const onCompleteEdge = outgoingEdges.find((e: any) => e.condition === 'complete');
        const onErrorEdge = outgoingEdges.find((e: any) => e.condition === 'error');
        
        return {
          id: dbNode.id,
          type: 'record',
          format: config.format || 'wav',
          channels: config.channels || 'dual',
          beep: config.beep || false,
          onComplete: onCompleteEdge ? getTargetId(onCompleteEdge) : config.onComplete,
          onError: onErrorEdge ? getTargetId(onErrorEdge) : config.onError,
        };
      }
      case 'tag': {
        const nextEdge = outgoingEdges.find((e: any) => !e.condition);
        
        return {
          id: dbNode.id,
          type: 'tag',
          tags: config.tags || {},
          ...(nextEdge ? { next: getTargetId(nextEdge) } : (config.next ? { next: config.next } : {})),
        };
      }
      case 'whisper': {
        const onAcceptEdge = outgoingEdges.find((e: any) => e.condition === 'accept');
        const onRejectEdge = outgoingEdges.find((e: any) => e.condition === 'reject');
        
        return {
          id: dbNode.id,
          type: 'whisper',
          callerPrompt: config.callerPrompt,
          calleePrompt: config.calleePrompt,
          onAccept: onAcceptEdge ? getTargetId(onAcceptEdge) : config.onAccept,
          onReject: onRejectEdge ? getTargetId(onRejectEdge) : config.onReject,
          timeout: config.timeout,
        };
      }
      case 'timeout': {
        const nextEdge = outgoingEdges.find((e: any) => !e.condition);
        
        return {
          id: dbNode.id,
          type: 'timeout',
          duration: config.duration || 0,
          ...(nextEdge ? { next: getTargetId(nextEdge) } : (config.next ? { next: config.next } : {})),
        };
      }
      case 'fallback': {
        const targets = outgoingEdges
          .filter((e: any) => !e.condition || e.condition !== 'all-failed')
          .map((e: any) => getTargetId(e));
        const onAllFailedEdge = outgoingEdges.find((e: any) => e.condition === 'all-failed');
        
        return {
          id: dbNode.id,
          type: 'fallback',
          targets: targets.length > 0 ? targets : (config.targets || []),
          onAllFailed: onAllFailedEdge ? getTargetId(onAllFailedEdge) : config.onAllFailed,
        };
      }
      case 'hangup':
        return {
          id: dbNode.id,
          type: 'hangup',
          reason: config.reason || 'normal',
        };
      default:
        throw new Error(`Unsupported node type: ${nodeType}`);
    }
  }

  private mapDbNodeTypeToFlowType(dbType: string): Flow['nodes'][number]['type'] {
    const mapping: Record<string, Flow['nodes'][number]['type']> = {
      'IVR': 'ivr',
      'CONDITIONAL': 'if',
      'QUEUE': 'queue',
      'BUYER_FORWARD': 'buyer',
      'RECORDING': 'record',
      'TRANSFER': 'whisper',
      'HANGUP': 'hangup',
    };
    return mapping[dbType] || 'ivr';
  }

  /**
   * Get all versions of a flow
   */
  async getFlowVersions(flowId: string): Promise<FlowVersion[]> {
    const prisma = getPrismaClient();

    const dbVersions = await prisma.flowVersion.findMany({
      where: { flowId },
      orderBy: { version: 'desc' },
      include: {
        nodes: true,
        edges: true,
      },
    });

    return dbVersions.map(v => {
      const flow = this.reconstructFlow(v);
      const plan = (v.metadata as any)?.plan || createExecutionPlan(flow);
      return {
        id: v.id,
        flowId: v.flowId,
        version: v.version.toString(),
        flow,
        plan,
        published: v.isActive,
        publishedAt: v.isActive ? v.updatedAt.toISOString() : undefined,
        createdAt: v.createdAt.toISOString(),
        createdBy: (v.metadata as any)?.createdBy,
      };
    });
  }

  /**
   * Get the published version of a flow
   */
  async getPublishedFlow(flowId: string): Promise<FlowVersion | null> {
    const prisma = getPrismaClient();

    const dbVersion = await prisma.flowVersion.findFirst({
      where: {
        flowId,
        isActive: true,
      },
      include: {
        flow: {
          select: {
            name: true,
          },
        },
        nodes: {
          include: {
            edgesFrom: true,
            edgesTo: true,
          },
        },
        edges: true,
      },
      orderBy: { version: 'desc' },
    });

    if (!dbVersion) {
      return null;
    }

    const flow = this.reconstructFlow(dbVersion);
    const plan = (dbVersion.metadata as any)?.plan || createExecutionPlan(flow);

    return {
      id: dbVersion.id,
      flowId: dbVersion.flowId,
      version: dbVersion.version.toString(),
      flow,
      plan,
      published: true,
      publishedAt: dbVersion.updatedAt.toISOString(),
      createdAt: dbVersion.createdAt.toISOString(),
      createdBy: (dbVersion.metadata as any)?.createdBy,
    };
  }

  /**
   * Publish a flow version
   */
  async publishFlow(flowId: string, version: string): Promise<FlowVersion> {
    const prisma = getPrismaClient();
    const versionInt = this.parseVersion(version);

    // Unpublish all other versions
    await prisma.flowVersion.updateMany({
      where: {
        flowId,
        isActive: true,
      },
      data: {
        isActive: false,
      },
    });

    // Publish this version
    const dbVersion = await prisma.flowVersion.update({
      where: {
        flowId_version: {
          flowId,
          version: versionInt,
        },
      },
      data: {
        isActive: true,
        updatedAt: new Date(),
      },
      include: {
        nodes: {
          include: {
            edgesFrom: true,
            edgesTo: true,
          },
        },
        edges: true,
      },
    });

    const flow = this.reconstructFlow(dbVersion);
    const plan = (dbVersion.metadata as any)?.plan || createExecutionPlan(flow);

    return {
      id: dbVersion.id,
      flowId: dbVersion.flowId,
      version: version,
      flow,
      plan,
      published: true,
      publishedAt: dbVersion.updatedAt.toISOString(),
      createdAt: dbVersion.createdAt.toISOString(),
      createdBy: (dbVersion.metadata as any)?.createdBy,
    };
  }

  /**
   * Rollback to a previous version
   */
  async rollbackFlow(flowId: string, targetVersion: string): Promise<FlowVersion> {
    return this.publishFlow(flowId, targetVersion);
  }

  /**
   * Parse and store a flow from JSON/YAML
   */
  async parseAndStore(data: unknown, createdBy?: string, tenantId?: string): Promise<FlowVersion> {
    const flow = parseFlow(data);
    const extractedTenantId = (flow as any).tenantId || tenantId;
    return this.storeFlow(flow, createdBy, extractedTenantId);
  }

  /**
   * List all flows
   */
  async listFlows(tenantId?: string): Promise<string[]> {
    const prisma = getPrismaClient();
    
    const where: any = {};
    if (tenantId) {
      where.tenantId = tenantId;
    }

    const flows = await prisma.flow.findMany({
      where,
      select: { id: true },
    });

    return flows.map(f => f.id);
  }

  /**
   * Delete a flow version
   */
  async deleteFlowVersion(flowId: string, version: string): Promise<boolean> {
    const prisma = getPrismaClient();
    const versionInt = this.parseVersion(version);

    const dbVersion = await prisma.flowVersion.findUnique({
      where: {
        flowId_version: {
          flowId,
          version: versionInt,
        },
      },
    });

    if (!dbVersion) {
      return false;
    }

    // Don't allow deleting published versions
    if (dbVersion.isActive) {
      throw new Error('Cannot delete published flow version');
    }

    await prisma.flowVersion.delete({
      where: { id: dbVersion.id },
    });

    return true;
  }
}

export const flowStore = new FlowStore();
