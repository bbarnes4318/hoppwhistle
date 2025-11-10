import { FastifyInstance } from 'fastify';
import { eventBus } from '../services/event-bus.js';
import { callStateService } from '../services/call-state.js';

/**
 * Demo endpoint to broadcast mocked call events
 * This simulates call events for testing the WebSocket gateway
 */
export async function registerDemoEventRoutes(fastify: FastifyInstance) {
  // Endpoint to trigger a mock call event
  fastify.post('/api/v1/demo/events/call', async (request, reply) => {
    const { callId, eventType, tenantId } = request.body as {
      callId?: string;
      eventType?: string;
      tenantId?: string;
    };

    const mockCallId = callId || `call_${Date.now()}`;
    const mockTenantId = tenantId || '00000000-0000-0000-0000-000000000000';

    // Create or update call state
    let callState = await callStateService.getCallState(mockCallId);
    if (!callState) {
      callState = {
        id: mockCallId,
        tenantId: mockTenantId,
        status: 'initiated',
        participants: [],
        timers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }

    // Determine event type and update state accordingly
    const event = eventType || 'call.started';
    let updatedState = callState;

    switch (event) {
      case 'call.started':
        updatedState = await callStateService.updateCallState(mockCallId, {
          status: 'ringing',
        }) || callState;
        break;

      case 'call.answered':
        updatedState = await callStateService.updateCallState(mockCallId, {
          status: 'answered',
        }) || callState;
        break;

      case 'call.completed':
        updatedState = await callStateService.updateCallState(mockCallId, {
          status: 'completed',
        }) || callState;
        break;

      case 'call.failed':
        updatedState = await callStateService.updateCallState(mockCallId, {
          status: 'failed',
        }) || callState;
        break;
    }

    // Publish event
    const eventData: any = {
      callId: mockCallId,
      callState: updatedState,
    };

    // Add billing-specific data for call.completed
    if (event === 'call.completed') {
      eventData.direction = 'OUTBOUND'; // Default, can be overridden
      eventData.duration = Math.floor(Math.random() * 300) + 30;
      eventData.answered = updatedState.status === 'completed' || updatedState.status === 'answered';
      eventData.hasRecording = Math.random() > 0.3;
      if (eventData.hasRecording) {
        eventData.recordingDuration = eventData.duration;
      }
    }

    await eventBus.publish('call.*', {
      event,
      tenantId: mockTenantId,
      data: eventData,
    });

    return {
      success: true,
      event,
      callId: mockCallId,
      callState: updatedState,
    };
  });

  // Endpoint to start a sequence of mock call events
  fastify.post('/api/v1/demo/events/call/sequence', async (request, reply) => {
    const { callId, tenantId, delay = 1000 } = request.body as {
      callId?: string;
      tenantId?: string;
      delay?: number;
    };

    const mockCallId = callId || `call_${Date.now()}`;
    const mockTenantId = tenantId || '00000000-0000-0000-0000-000000000000';

    // Create initial call state
    const initialState = {
      id: mockCallId,
      tenantId: mockTenantId,
      status: 'initiated' as const,
      participants: [
        {
          id: 'participant_1',
          number: '+15551234567',
          role: 'caller' as const,
          status: 'ringing' as const,
        },
      ],
      timers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await callStateService.setCallState(initialState);

    // Publish events in sequence
    const events = [
      { event: 'call.started', status: 'ringing' as const },
      { event: 'call.answered', status: 'answered' as const },
      { event: 'call.completed', status: 'completed' as const },
    ];

    for (let i = 0; i < events.length; i++) {
      setTimeout(async () => {
        const { event, status } = events[i];
        const updatedState = await callStateService.updateCallState(mockCallId, {
          status,
        });

        await eventBus.publish('call.*', {
          event,
          tenantId: mockTenantId,
          data: {
            callId: mockCallId,
            callState: updatedState,
          },
        });
      }, i * delay);
    }

    return {
      success: true,
      callId: mockCallId,
      message: `Started sequence of ${events.length} events with ${delay}ms delay`,
    };
  });
}

