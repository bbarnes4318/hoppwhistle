/**
 * SignalWire Webhook Receiver
 *
 * Endpoints:
 *   POST /api/signalwire/voice       — Inbound/outbound call status callbacks (LaML)
 *   POST /api/signalwire/voice/status — Call status updates (ringing, answered, completed)
 *   POST /api/signalwire/sms         — Inbound SMS webhooks
 *   POST /api/signalwire/sms/status   — SMS delivery status callbacks
 *   POST /api/signalwire/events       — Generic RELAY / SWML event sink
 *   GET  /api/signalwire/events       — Debug: view last N received events
 *
 * SignalWire Compatibility API sends application/x-www-form-urlencoded.
 * RELAY / SWML sends application/json.
 * Both are handled transparently.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

// ── In-memory ring buffer for recent events (debug aid) ──────────────────────
const MAX_EVENTS = 200;
const recentEvents: Array<{
  timestamp: string;
  path: string;
  contentType: string | undefined;
  payload: Record<string, unknown>;
}> = [];

function pushEvent(path: string, contentType: string | undefined, payload: Record<string, unknown>) {
  recentEvents.push({
    timestamp: new Date().toISOString(),
    path,
    contentType,
    payload,
  });
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents.shift();
  }
}

/**
 * Extract payload from either JSON or form-encoded body.
 * Fastify must have @fastify/formbody registered for form parsing.
 */
function extractPayload(request: FastifyRequest): Record<string, unknown> {
  const body = request.body;
  if (body && typeof body === 'object') {
    return body as Record<string, unknown>;
  }
  return {};
}

// ── Route Registration ───────────────────────────────────────────────────────
export async function registerSignalWireWebhookRoutes(server: FastifyInstance) {
  // Register form-body parser so we can handle application/x-www-form-urlencoded
  await server.register(import('@fastify/formbody'));

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/signalwire/voice — Primary voice webhook (inbound call handling)
  // ────────────────────────────────────────────────────────────────────────────
  server.post('/api/signalwire/voice', async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = extractPayload(request);
    const ct = request.headers['content-type'];

    console.log('[SignalWire][VOICE]', JSON.stringify(payload, null, 2));
    pushEvent('/api/signalwire/voice', ct, payload);

    // Respond with LaML — default: ring then answer
    // Customize this to route calls, play messages, connect to FreeSWITCH, etc.
    const callStatus = (payload.CallStatus as string) || '';
    const from = (payload.From as string) || 'unknown';
    const to = (payload.To as string) || 'unknown';

    console.log(`[SignalWire][VOICE] ${callStatus} | ${from} → ${to}`);

    // Default: Answer and say a message, then hangup
    // Replace with your own LaML logic (e.g., <Dial>, <Connect>, <Stream>)
    const laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">This number is managed by Hopwhistle. Please hold while we connect you.</Say>
  <Dial timeout="30">
    <Sip>sip:operator@${process.env.PUBLIC_IP || '3.214.60.13'}:5060</Sip>
  </Dial>
  <Say voice="alice">We're sorry, no one is available right now. Goodbye.</Say>
  <Hangup/>
</Response>`;

    return reply
      .code(200)
      .header('Content-Type', 'application/xml')
      .send(laml);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/signalwire/voice/status — Call status callback
  // ────────────────────────────────────────────────────────────────────────────
  server.post('/api/signalwire/voice/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = extractPayload(request);
    const ct = request.headers['content-type'];

    const callSid   = (payload.CallSid as string)    || '';
    const status    = (payload.CallStatus as string)  || '';
    const duration  = (payload.CallDuration as string)|| '0';
    const from      = (payload.From as string)        || '';
    const to        = (payload.To as string)          || '';

    console.log(`[SignalWire][STATUS] ${callSid} | ${status} | ${from}→${to} | ${duration}s`);
    pushEvent('/api/signalwire/voice/status', ct, payload);

    // TODO: Persist call records to database, update campaign stats, etc.

    return reply.code(200).send({ received: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/signalwire/sms — Inbound SMS webhook
  // ────────────────────────────────────────────────────────────────────────────
  server.post('/api/signalwire/sms', async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = extractPayload(request);
    const ct = request.headers['content-type'];

    const from = (payload.From as string) || '';
    const to   = (payload.To as string)   || '';
    const body = (payload.Body as string) || '';

    console.log(`[SignalWire][SMS] ${from}→${to}: "${body}"`);
    pushEvent('/api/signalwire/sms', ct, payload);

    // Respond with LaML — empty response = accept silently, or auto-reply:
    const laml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thanks for your message. A Hopwhistle agent will get back to you shortly.</Message>
</Response>`;

    return reply
      .code(200)
      .header('Content-Type', 'application/xml')
      .send(laml);
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/signalwire/sms/status — SMS delivery receipt
  // ────────────────────────────────────────────────────────────────────────────
  server.post('/api/signalwire/sms/status', async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = extractPayload(request);
    const ct = request.headers['content-type'];

    console.log('[SignalWire][SMS-STATUS]', JSON.stringify(payload));
    pushEvent('/api/signalwire/sms/status', ct, payload);

    return reply.code(200).send({ received: true });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // POST /api/signalwire/events — Catch-all for RELAY / SWML / SWAIG events
  // ────────────────────────────────────────────────────────────────────────────
  server.post('/api/signalwire/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const payload = extractPayload(request);
    const ct = request.headers['content-type'];

    console.log('[SignalWire][EVENT]', JSON.stringify(payload, null, 2));
    pushEvent('/api/signalwire/events', ct, payload);

    return reply.code(200).send({ received: true, timestamp: new Date().toISOString() });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // GET /api/signalwire/events — Debug: view recent events
  // ────────────────────────────────────────────────────────────────────────────
  server.get('/api/signalwire/events', async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, string>;
    const limit = Math.min(parseInt(query.limit || '50', 10), MAX_EVENTS);
    const pathFilter = query.path || null;

    let filtered = recentEvents;
    if (pathFilter) {
      filtered = recentEvents.filter(e => e.path.includes(pathFilter));
    }

    return reply.code(200).send({
      count: filtered.length,
      showing: Math.min(limit, filtered.length),
      events: filtered.slice(-limit),
    });
  });

  console.log('[API] SignalWire webhook routes registered:');
  console.log('  POST /api/signalwire/voice');
  console.log('  POST /api/signalwire/voice/status');
  console.log('  POST /api/signalwire/sms');
  console.log('  POST /api/signalwire/sms/status');
  console.log('  POST /api/signalwire/events');
  console.log('  GET  /api/signalwire/events');
}
