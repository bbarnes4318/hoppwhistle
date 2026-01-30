/**
 * Lead Injection Webhook Routes
 *
 * Purpose: Accept incoming lead data before a call connects, allowing the Agent UI
 * to be pre-populated with customer details (DOB, Gender, Name, etc.)
 *
 * JSON Payload Specification:
 * {
 *   "lead_token": "string (optional) - Unique identifier for the lead",
 *   "caller_id": "string (required) - Phone number of the caller",
 *   "first_name": "string (optional)",
 *   "last_name": "string (optional)",
 *   "email": "string (optional)",
 *   "phone": "string (optional) - Alternative to caller_id",
 *   "city": "string (optional)",
 *   "state": "string (optional) - 2-letter state code",
 *   "zip": "string (optional)",
 *   "dob": "string (optional) - Date of birth in YYYY-MM-DD format",
 *   "date_of_birth": "string (optional) - Alias for dob",
 *   "age": "number (optional) - Pre-calculated age",
 *   "gender": "string (optional) - 'Male' or 'Female'",
 *   "coverage_amount": "number (optional) - Requested coverage amount",
 *   "beneficiary": "string (optional) - Beneficiary name",
 *   "source": "string (optional) - Lead source identifier",
 *   "campaign_id": "string (optional) - Campaign identifier",
 *   "custom_fields": "object (optional) - Any additional custom data"
 * }
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { EventEmitter } from 'events';

// Global event emitter for lead data broadcasts
// In production, this should be replaced with Redis pub/sub or similar
const leadEventEmitter = new EventEmitter();
leadEventEmitter.setMaxListeners(100); // Support many connected agents

// Types
interface LeadInjectPayload {
  lead_token?: string;
  caller_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  city?: string;
  state?: string;
  zip?: string;
  dob?: string;
  date_of_birth?: string;
  age?: number;
  gender?: string;
  coverage_amount?: number;
  beneficiary?: string;
  source?: string;
  campaign_id?: string;
  custom_fields?: Record<string, unknown>;
}

interface LeadInjectRequest extends FastifyRequest {
  body: LeadInjectPayload;
}

// In-memory store for recent leads (last 100)
// In production, use Redis or database
const recentLeads: Map<string, LeadInjectPayload & { receivedAt: string }> = new Map();
const MAX_RECENT_LEADS = 100;

function addRecentLead(lead: LeadInjectPayload): string {
  const leadId = lead.lead_token || lead.caller_id || `lead-${Date.now()}`;
  const enrichedLead = {
    ...lead,
    receivedAt: new Date().toISOString(),
  };

  // Add to front, remove oldest if over limit
  recentLeads.set(leadId, enrichedLead);
  if (recentLeads.size > MAX_RECENT_LEADS) {
    const oldestKey = recentLeads.keys().next().value;
    if (oldestKey) recentLeads.delete(oldestKey);
  }

  return leadId;
}

export async function registerLeadInjectRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/lead-inject
   *
   * Main webhook endpoint to receive lead data before a call.
   * Validates the payload and broadcasts to connected agents.
   */
  fastify.post<{ Body: LeadInjectPayload }>(
    '/api/v1/lead-inject',
    async (request: LeadInjectRequest, reply: FastifyReply) => {
      const body = request.body;

      // Validate required fields - need at least a phone identifier
      const phoneId = body.caller_id || body.phone;
      if (!phoneId) {
        return reply.code(400).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Either caller_id or phone is required',
          },
        });
      }

      // Normalize the payload
      const normalizedLead: LeadInjectPayload = {
        ...body,
        caller_id: phoneId,
        phone: phoneId,
        // Normalize DOB field names
        dob: body.dob || body.date_of_birth,
        // Normalize gender to Title Case
        gender: body.gender
          ? body.gender.charAt(0).toUpperCase() + body.gender.slice(1).toLowerCase()
          : undefined,
      };

      // Calculate age from DOB if not provided
      if ((normalizedLead.dob || normalizedLead.date_of_birth) && !normalizedLead.age) {
        const dobStr = normalizedLead.dob || normalizedLead.date_of_birth;
        if (dobStr) {
          const dob = new Date(dobStr);
          const today = new Date();
          let age = today.getFullYear() - dob.getFullYear();
          const monthDiff = today.getMonth() - dob.getMonth();
          if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
            age--;
          }
          normalizedLead.age = age;
        }
      }

      // Store the lead
      const leadId = addRecentLead(normalizedLead);

      // Broadcast to all connected SSE clients
      console.log(`[LeadInject] Broadcasting lead data for ${phoneId}`);
      leadEventEmitter.emit('lead', normalizedLead);

      // Log for debugging
      fastify.log.info({
        event: 'lead_inject',
        leadId,
        phone: phoneId,
        hasName: !!(normalizedLead.first_name || normalizedLead.last_name),
        hasDob: !!normalizedLead.dob,
        hasGender: !!normalizedLead.gender,
        hasLocation: !!(normalizedLead.city || normalizedLead.state),
      });

      return reply.code(200).send({
        success: true,
        leadId,
        message: 'Lead data received and broadcast to agents',
        receivedAt: new Date().toISOString(),
      });
    }
  );

  /**
   * GET /api/v1/lead-inject/stream
   *
   * SSE endpoint for agents to receive real-time lead data.
   * The frontend should connect to this endpoint to listen for incoming leads.
   */
  fastify.get('/api/v1/lead-inject/stream', async (request, reply) => {
    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial connection message
    reply.raw.write(
      `data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`
    );

    // Handler for new leads
    const leadHandler = (lead: LeadInjectPayload) => {
      try {
        reply.raw.write(`data: ${JSON.stringify({ type: 'lead', data: lead })}\n\n`);
      } catch (err) {
        console.error('[LeadInject] Error sending SSE message:', err);
      }
    };

    // Subscribe to lead events
    leadEventEmitter.on('lead', leadHandler);

    // Keep-alive ping every 30 seconds
    const keepAliveInterval = setInterval(() => {
      try {
        reply.raw.write(`: keepalive\n\n`);
      } catch (err) {
        // Connection closed
        clearInterval(keepAliveInterval);
      }
    }, 30000);

    // Cleanup on connection close
    request.raw.on('close', () => {
      leadEventEmitter.off('lead', leadHandler);
      clearInterval(keepAliveInterval);
      console.log('[LeadInject] SSE client disconnected');
    });

    // Don't end the response - keep it open for SSE
    return reply;
  });

  /**
   * GET /api/v1/lead-inject/recent
   *
   * Get recently received leads (for debugging/recovery).
   */
  fastify.get('/api/v1/lead-inject/recent', async (request, reply) => {
    const leads = Array.from(recentLeads.values())
      .reverse() // Most recent first
      .slice(0, 20); // Limit to 20

    return {
      count: leads.length,
      leads: leads.map(lead => ({
        ...lead,
        // Mask sensitive data for security
        phone: lead.phone ? `***-***-${lead.phone.slice(-4)}` : undefined,
        caller_id: lead.caller_id ? `***-***-${lead.caller_id.slice(-4)}` : undefined,
      })),
    };
  });

  /**
   * GET /api/v1/lead-inject/lookup/:phoneNumber
   *
   * Look up a specific lead by phone number.
   * Used when a call comes in to check if we have pre-populated data.
   */
  fastify.get<{ Params: { phoneNumber: string } }>(
    '/api/v1/lead-inject/lookup/:phoneNumber',
    async (request, reply) => {
      const { phoneNumber } = request.params;
      const normalizedPhone = phoneNumber.replace(/\D/g, '');

      // Search recent leads for matching phone
      for (const [_, lead] of recentLeads) {
        const leadPhone = (lead.caller_id || lead.phone || '').replace(/\D/g, '');
        if (
          leadPhone === normalizedPhone ||
          leadPhone.endsWith(normalizedPhone) ||
          normalizedPhone.endsWith(leadPhone)
        ) {
          return {
            found: true,
            lead: {
              ...lead,
              // Don't mask data for matched lookup
            },
          };
        }
      }

      return {
        found: false,
        message: 'No pre-populated data found for this number',
      };
    }
  );
}

// Export the event emitter for use in other modules (e.g., call events)
export { leadEventEmitter };
