import { parseFlow } from '@hopwhistle/routing-dsl';
import { FastifyInstance } from 'fastify';

import { FlowEngine } from '../services/flow-engine.js';
import { flowStore } from '../services/flow-store.js';

// Store active flow engines by call ID
const activeEngines = new Map<string, FlowEngine>();

/**
 * Flow management routes (DSL flows)
 */
export async function registerFlowManagementRoutes(fastify: FastifyInstance) {
  // Create/update a flow version
  fastify.post('/api/v1/flows', async (request, reply) => {
    try {
      const user = (request as any).user;
      const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
      const tenantId = demoTenantId || user?.tenantId;
      
      if (!tenantId) {
        reply.code(401);
        return { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
      }

      // Add tenant ID to flow metadata
      const flowData = {
        ...request.body,
        tenantId, // Store tenant ID in flow for filtering
      };

      const flowVersion = await flowStore.parseAndStore(
        flowData,
        user?.userId || user?.id,
        tenantId
      );

      reply.code(201);
      return {
        id: flowVersion.id,
        flowId: flowVersion.flowId,
        version: flowVersion.version,
        published: flowVersion.published,
        createdAt: flowVersion.createdAt,
      };
    } catch (error) {
      reply.code(400);
      return {
        error: {
          code: 'INVALID_FLOW',
          message: error instanceof Error ? error.message : 'Invalid flow definition',
        },
      };
    }
  });

  // Get all flow versions
  fastify.get('/api/v1/flows', async request => {
    const user = (request as any).user;
    const demoTenantId = request.headers['x-demo-tenant-id'] as string | undefined;
    const tenantId = demoTenantId || user?.tenantId;
    
    if (!tenantId) {
      request.server.log.warn('No tenant ID for flows list');
      return {
        data: [],
        meta: { total: 0 },
      };
    }

    const flowIds = await flowStore.listFlows(tenantId);
    const flows = await Promise.all(
      flowIds.map(async flowId => {
        const published = await flowStore.getPublishedFlow(flowId);
        const versions = await flowStore.getFlowVersions(flowId);
        
        // Filter by tenant ID if stored in flow metadata
        const firstVersion = versions[0];
        if (firstVersion?.flow && (firstVersion.flow as any).tenantId) {
          if ((firstVersion.flow as any).tenantId !== tenantId) {
            return null; // Skip flows from other tenants
          }
        }
        
        return {
          id: flowId,
          name: (firstVersion?.flow as any)?.name || flowId,
          publishedVersion: published?.version || null,
          versions: versions.map(v => ({
            version: v.version,
            published: v.published,
            createdAt: v.createdAt,
          })),
        };
      })
    );

    // Filter out nulls
    const filteredFlows = flows.filter(f => f !== null);

    return {
      data: filteredFlows,
      meta: {
        total: filteredFlows.length,
      },
    };
  });

  // Get a specific flow version
  fastify.get<{ Params: { flowId: string; version: string } }>(
    '/api/v1/flows/:flowId/versions/:version',
    async (request, reply) => {
      const flowVersion = await flowStore.getFlowVersion(
        request.params.flowId,
        request.params.version
      );

      if (!flowVersion) {
        reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: 'Flow version not found',
          },
        };
      }

      return {
        id: flowVersion.id,
        flowId: flowVersion.flowId,
        version: flowVersion.version,
        flow: flowVersion.flow,
        published: flowVersion.published,
        publishedAt: flowVersion.publishedAt,
        createdAt: flowVersion.createdAt,
      };
    }
  );

  // Get all versions of a flow
  fastify.get<{ Params: { flowId: string } }>('/api/v1/flows/:flowId/versions', async request => {
    const versions = await flowStore.getFlowVersions(request.params.flowId);
    return {
      data: versions.map(v => ({
        id: v.id,
        version: v.version,
        published: v.published,
        publishedAt: v.publishedAt,
        createdAt: v.createdAt,
      })),
    };
  });

  // Get published version of a flow
  fastify.get<{ Params: { flowId: string } }>('/api/v1/flows/:flowId', async (request, reply) => {
    const published = await flowStore.getPublishedFlow(request.params.flowId);

    if (!published) {
      reply.code(404);
      return {
        error: {
          code: 'NOT_FOUND',
          message: 'No published version found',
        },
      };
    }

    return {
      id: published.id,
      flowId: published.flowId,
      version: published.version,
      flow: published.flow,
      published: true,
      publishedAt: published.publishedAt,
      createdAt: published.createdAt,
    };
  });

  // Publish a flow version
  fastify.post<{ Params: { flowId: string; version: string } }>(
    '/api/v1/flows/:flowId/versions/:version/publish',
    async (request, reply) => {
      try {
        const flowVersion = await flowStore.publishFlow(
          request.params.flowId,
          request.params.version
        );

        return {
          id: flowVersion.id,
          flowId: flowVersion.flowId,
          version: flowVersion.version,
          published: true,
          publishedAt: flowVersion.publishedAt,
        };
      } catch (error) {
        reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: error instanceof Error ? error.message : 'Flow version not found',
          },
        };
      }
    }
  );

  // Rollback to a previous version
  fastify.post<{ Params: { flowId: string }; Body: { version: string } }>(
    '/api/v1/flows/:flowId/rollback',
    async (request, reply) => {
      try {
        const flowVersion = await flowStore.rollbackFlow(
          request.params.flowId,
          request.body.version
        );

        return {
          id: flowVersion.id,
          flowId: flowVersion.flowId,
          version: flowVersion.version,
          published: true,
          publishedAt: flowVersion.publishedAt,
          message: 'Flow rolled back successfully',
        };
      } catch (error) {
        reply.code(404);
        return {
          error: {
            code: 'NOT_FOUND',
            message: error instanceof Error ? error.message : 'Flow version not found',
          },
        };
      }
    }
  );

  // Delete a flow version
  fastify.delete<{ Params: { flowId: string; version: string } }>(
    '/api/v1/flows/:flowId/versions/:version',
    async (request, reply) => {
      try {
        const deleted = await flowStore.deleteFlowVersion(
          request.params.flowId,
          request.params.version
        );

        if (!deleted) {
          reply.code(404);
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'Flow version not found',
            },
          };
        }

        reply.code(204);
        return;
      } catch (error) {
        reply.code(400);
        return {
          error: {
            code: 'INVALID_OPERATION',
            message: error instanceof Error ? error.message : 'Cannot delete flow version',
          },
        };
      }
    }
  );

  // Validate a flow without storing it
  fastify.post('/api/v1/flows/validate', async (request, reply) => {
    try {
      const flow = parseFlow(request.body);
      reply.code(200);
      return {
        valid: true,
        flowId: flow.id,
        version: flow.version,
        nodeCount: flow.nodes.length,
      };
    } catch (error) {
      reply.code(400);
      return {
        valid: false,
        error: {
          code: 'INVALID_FLOW',
          message: error instanceof Error ? error.message : 'Invalid flow definition',
        },
      };
    }
  });

  // Execute a flow for a call
  fastify.post<{ Body: { callId: string; flowId: string; version?: string } }>(
    '/api/v1/flows/execute',
    async (request, reply) => {
      try {
        const { callId, flowId, version } = request.body;
        const tenantId = (request as any).user?.tenantId || 'default';

        // Get flow plan
        let plan;
        if (version) {
          const flowVersion = await flowStore.getFlowVersion(flowId, version);
          if (!flowVersion) {
            reply.code(404);
            return {
              error: {
                code: 'NOT_FOUND',
                message: 'Flow version not found',
              },
            };
          }
          plan = flowVersion.plan;
        } else {
          const published = await flowStore.getPublishedFlow(flowId);
          if (!published) {
            reply.code(404);
            return {
              error: {
                code: 'NOT_FOUND',
                message: 'No published version found',
              },
            };
          }
          plan = published.plan;
        }

        // Create and start flow engine
        const engine = new FlowEngine({
          callId,
          tenantId,
          plan,
        });

        activeEngines.set(callId, engine);
        await engine.start();

        return {
          success: true,
          callId,
          flowId,
          currentNodeId: engine.getContext().currentNodeId,
        };
      } catch (error) {
        reply.code(400);
        return {
          error: {
            code: 'EXECUTION_ERROR',
            message: error instanceof Error ? error.message : 'Failed to execute flow',
          },
        };
      }
    }
  );

  // Process telephony event for a call
  fastify.post<{ Body: { callId: string; event: unknown } }>(
    '/api/v1/flows/events',
    async (request, reply) => {
      try {
        const { callId, event } = request.body;
        const engine = activeEngines.get(callId);

        if (!engine) {
          reply.code(404);
          return {
            error: {
              code: 'NOT_FOUND',
              message: 'No active flow engine found for call',
            },
          };
        }

        // Validate and process event
        const { TelephonyEventSchema } = await import('@hopwhistle/routing-dsl');
        const telephonyEvent = TelephonyEventSchema.parse(event);

        await engine.processEvent(telephonyEvent);

        return {
          success: true,
          callId,
          currentNodeId: engine.getContext().currentNodeId,
        };
      } catch (error) {
        reply.code(400);
        return {
          error: {
            code: 'INVALID_EVENT',
            message: error instanceof Error ? error.message : 'Invalid telephony event',
          },
        };
      }
    }
  );
}
