import { FastifyInstance } from 'fastify';
import { eventBus } from '../services/event-bus.js';
import type { EventPayload, EventChannel } from '../services/event-bus.js';

interface WebSocketMessage {
  type: 'subscribe' | 'unsubscribe' | 'ping';
  channels?: EventChannel[];
}

/**
 * Simple authentication for WebSocket connections
 * Supports API key via query parameter or header
 */
function authenticateWebSocket(request: any): { tenantId: string } | null {
  // Check for API key in query params
  const apiKey = request.query?.apiKey || request.headers['x-api-key'];
  
  if (!apiKey) {
    return null;
  }

  // In production, validate against database
  // For demo, accept any API key and use default tenant
  const validApiKeys = (process.env.VALID_API_KEYS || '').split(',').filter(Boolean);
  
  if (validApiKeys.length > 0 && !validApiKeys.includes(apiKey)) {
    return null;
  }

  return {
    tenantId: process.env.DEFAULT_TENANT_ID || '00000000-0000-0000-0000-000000000000',
  };
}

export async function registerWebSocketRoutes(fastify: FastifyInstance) {
  await fastify.register(async function (fastify) {
    // Register WebSocket plugin
    await fastify.register(import('@fastify/websocket'));

    // WebSocket endpoint for event subscriptions
    fastify.get(
      '/ws/events',
      { websocket: true },
      async (connection, request) => {
        // Authenticate the WebSocket connection
        const auth = authenticateWebSocket(request);
        
        if (!auth) {
          connection.socket.close(1008, 'Unauthorized');
          return;
        }

        const { tenantId } = auth;
        const subscribedChannels = new Set<EventChannel>();

        // Subscribe to pub/sub channels
        const unsubscribe = await eventBus.subscribePubSub(
          ['call.*', 'billing.*', 'recording.*'],
          (channel, payload) => {
            // Only send events for this tenant
            if (payload.tenantId === tenantId) {
              connection.socket.send(
                JSON.stringify({
                  type: 'event',
                  channel,
                  payload,
                })
              );
            }
          }
        );

        // Handle incoming messages
        connection.socket.on('message', (message: Buffer) => {
          try {
            const data = JSON.parse(message.toString()) as WebSocketMessage;

            switch (data.type) {
              case 'subscribe':
                if (data.channels) {
                  data.channels.forEach((ch) => subscribedChannels.add(ch));
                  connection.socket.send(
                    JSON.stringify({
                      type: 'subscribed',
                      channels: Array.from(subscribedChannels),
                    })
                  );
                }
                break;

              case 'unsubscribe':
                if (data.channels) {
                  data.channels.forEach((ch) => subscribedChannels.delete(ch));
                  connection.socket.send(
                    JSON.stringify({
                      type: 'unsubscribed',
                      channels: Array.from(subscribedChannels),
                    })
                  );
                }
                break;

              case 'ping':
                connection.socket.send(
                  JSON.stringify({
                    type: 'pong',
                    timestamp: new Date().toISOString(),
                  })
                );
                break;
            }
          } catch (err) {
            connection.socket.send(
              JSON.stringify({
                type: 'error',
                message: 'Invalid message format',
              })
            );
          }
        });

        // Handle connection close
        connection.socket.on('close', async () => {
          await unsubscribe();
        });

        // Handle errors
        connection.socket.on('error', (err) => {
          console.error('WebSocket error:', err);
        });

        // Send welcome message
        connection.socket.send(
          JSON.stringify({
            type: 'connected',
            tenantId,
            timestamp: new Date().toISOString(),
          })
        );
      }
    );
  });
}
