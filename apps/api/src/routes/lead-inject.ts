/**
 * Lead Injection Webhook Routes
 *
 * Purpose: Accept incoming lead data before a call connects, allowing the Agent UI
 * to be pre-populated with customer details (DOB, Gender, Name, etc.)
 *
 * ── Tenancy ──────────────────────────────────────────────────────────────────
 *
 * Every route here handles a consumer's name, date of birth, address and
 * requested coverage. None of them had any tenant concept at all:
 *
 *   - POST /lead-inject took a payload from anyone and stored it.
 *   - GET  /lead-inject/stream broadcast EVERY injected lead to EVERY connected
 *     listener. One agency's agents watched another agency's leads arrive.
 *   - GET  /lead-inject/recent and /lead-inject/lookup/:phoneNumber read the
 *     same shared store, and `lookup` returned the record unmasked.
 *
 * The routes sit under /api/v1, where the auth hook populates `request.user`
 * but never refuses a request, so all four answered anonymous callers.
 *
 * Both the store and the event bus are now keyed by tenant, and each route
 * derives its tenant the way its kind requires:
 *
 *   - The POST is a webhook from a lead vendor. It authenticates with an API
 *     key, and the tenant is the key's own tenant -- the addressed resource,
 *     not anything in the payload. A vendor posting to the wrong tenant is not
 *     something a body field should be able to arrange.
 *   - The three read routes are agent-facing and take the tenant from the
 *     authenticated session, like every other authenticated route.
 *
 * The store remains in memory and per-process: a lead is a transient hint for
 * the screen pop that is about to happen, not a record. What changed is that
 * one process's memory is no longer shared across agencies.
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

import { EventEmitter } from 'events';

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { resolveTenant } from '../lib/tenant-context.js';
import { authenticateAPIKey } from '../middleware/auth.js';

// Global event emitter for lead data broadcasts.
//
// Events are namespaced `lead:<tenantId>`, so a listener subscribes to its own
// agency and receives nothing else. It used to emit a single `lead` event that
// every listener on the process received.
//
// In production, this should be replaced with Redis pub/sub or similar.
const leadEventEmitter = new EventEmitter();
leadEventEmitter.setMaxListeners(100); // Support many connected agents

function leadChannel(tenantId: string): string {
  return `lead:${tenantId}`;
}

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

type StoredLead = LeadInjectPayload & { receivedAt: string };

// In-memory store for recent leads, per tenant (last 100 each).
// In production, use Redis or database.
const recentLeadsByTenant = new Map<string, Map<string, StoredLead>>();
const MAX_RECENT_LEADS = 100;

function leadsFor(tenantId: string): Map<string, StoredLead> {
  let leads = recentLeadsByTenant.get(tenantId);
  if (!leads) {
    leads = new Map<string, StoredLead>();
    recentLeadsByTenant.set(tenantId, leads);
  }
  return leads;
}

function addRecentLead(tenantId: string, lead: LeadInjectPayload): string {
  const leadId = lead.lead_token || lead.caller_id || `lead-${Date.now()}`;
  const enrichedLead: StoredLead = {
    ...lead,
    receivedAt: new Date().toISOString(),
  };

  const recentLeads = leadsFor(tenantId);

  // Add to front, remove oldest if over limit
  recentLeads.set(leadId, enrichedLead);
  if (recentLeads.size > MAX_RECENT_LEADS) {
    const oldestKey = recentLeads.keys().next().value;
    if (oldestKey) recentLeads.delete(oldestKey);
  }

  return leadId;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerLeadInjectRoutes(fastify: FastifyInstance) {
  /**
   * POST /api/v1/lead-inject
   *
   * Webhook endpoint for a lead vendor to push lead data ahead of a call.
   * Authenticated with an API key; the key's tenant is the lead's tenant.
   */
  fastify.post<{ Body: LeadInjectPayload }>(
    '/api/v1/lead-inject',
    { preHandler: [authenticateAPIKey] },
    async (request: LeadInjectRequest, reply: FastifyReply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

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
      const leadId = addRecentLead(tenantId, normalizedLead);

      // Broadcast to this tenant's connected SSE clients only.
      leadEventEmitter.emit(leadChannel(tenantId), normalizedLead);

      // Log for debugging. The phone number is not logged: this is a consumer's
      // number arriving on a lead, and it used to be printed in full.
      fastify.log.info({
        event: 'lead_inject',
        leadId,
        tenantId,
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
   * SSE endpoint for agents to receive real-time lead data for their own
   * agency. The frontend connects here to listen for incoming leads.
   */
  fastify.get('/api/v1/lead-inject/stream', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    // Set SSE headers.
    //
    // No `Access-Control-Allow-Origin: *` here any more: this stream carries
    // one agency's leads, and a wildcard let any page on any origin open it
    // with the viewer's credentials and read them.
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
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
        request.log.error({ err }, '[LeadInject] Error sending SSE message');
      }
    };

    // Subscribe to this tenant's lead events
    const channel = leadChannel(tenantId);
    leadEventEmitter.on(channel, leadHandler);

    // Keep-alive ping every 30 seconds
    const keepAliveInterval = setInterval(() => {
      try {
        reply.raw.write(`: keepalive\n\n`);
      } catch {
        // Connection closed
        clearInterval(keepAliveInterval);
      }
    }, 30000);

    // Cleanup on connection close
    request.raw.on('close', () => {
      leadEventEmitter.off(channel, leadHandler);
      clearInterval(keepAliveInterval);
    });

    // Don't end the response - keep it open for SSE
    return reply;
  });

  /**
   * GET /api/v1/lead-inject/recent
   *
   * Recently received leads for the caller's own agency (for debugging and
   * recovery).
   */
  fastify.get('/api/v1/lead-inject/recent', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;

    const leads = Array.from(leadsFor(tenantId).values())
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
   * Look up a lead by phone number within the caller's own agency.
   * Used when a call comes in to check if we have pre-populated data.
   */
  fastify.get<{ Params: { phoneNumber: string } }>(
    '/api/v1/lead-inject/lookup/:phoneNumber',
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;

      const { phoneNumber } = request.params;
      const normalizedPhone = phoneNumber.replace(/\D/g, '');

      // Search this tenant's recent leads for a matching phone
      for (const lead of leadsFor(tenantId).values()) {
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

// Export the event emitter and its channel naming for use in other modules
// (e.g. call events). Anything publishing here must name a tenant.
export { leadEventEmitter, leadChannel };
