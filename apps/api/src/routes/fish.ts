import { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Fish Audio voice management, cloning and preview.
 *
 * Backs the Voice Studio page (/voice-studio). Everything here proxies
 * api.fish.audio server-side so FISH_API_KEY never reaches the browser — the
 * key is account-wide (cloning, deletion, billed generation), so it must not
 * be shipped to a client where anyone with devtools can lift it.
 *
 * Voice ids produced here are pasted into the Dograh TTS config as `voice`
 * (Fish calls it reference_id). See deploy/dograh/fish-tts/.
 */

const FISH_API_BASE = process.env.FISH_API_BASE || 'https://api.fish.audio';
const FISH_API_KEY = process.env.FISH_API_KEY || '';

// s2.1-pro-free is the same model as s2.1-pro at $0, without a
// time-to-first-audio guarantee. Correct default for the Studio, where nobody
// is waiting on a live phone call. Override per-request for A/B latency tests.
const DEFAULT_MODEL = process.env.FISH_DEFAULT_MODEL || 's2.1-pro-free';

const PREVIEW_MAX_CHARS = 1200;
const CLONE_MAX_BYTES = 25 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

const ALLOWED_MODELS = ['s2.1-pro-free', 's2.1-pro', 's2-pro', 's1'] as const;
const ALLOWED_VISIBILITY = ['private', 'unlist', 'public'] as const;
const ALLOWED_LATENCY = ['balanced', 'normal'] as const;

interface HopwhistleUser {
  userId?: string;
  tenantId?: string;
  email?: string;
}

function notConfigured(reply: import('fastify').FastifyReply) {
  return reply.code(503).send({
    error: {
      code: 'FISH_NOT_CONFIGURED',
      message: 'Fish Audio is not configured. Set FISH_API_KEY on the API service.',
    },
  });
}

function requireUser(request: FastifyRequest, reply: import('fastify').FastifyReply) {
  const user = (request.user || {}) as HopwhistleUser;
  if (!user.userId && !user.tenantId) {
    void reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } });
    return null;
  }
  return user;
}

async function fishFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${FISH_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${FISH_API_KEY}`,
        ...(init.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Surface Fish's own error text rather than a generic 500 — cloning fails for
 *  specific, fixable reasons (sample too short, unsupported codec) and the
 *  user needs to see which. */
async function passThroughError(
  response: Response,
  reply: import('fastify').FastifyReply,
  fallback: string
) {
  const body = await response.text().catch(() => '');
  return reply.code(response.status === 401 ? 502 : response.status).send({
    error: {
      code: 'FISH_UPSTREAM_ERROR',
      message: body?.slice(0, 500) || fallback,
    },
  });
}

export async function registerFishRoutes(fastify: FastifyInstance) {
  /** Whether the Studio is usable at all, plus remaining credit. */
  fastify.get('/api/v1/fish/status', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    if (!FISH_API_KEY) {
      return reply.send({ configured: false, defaultModel: DEFAULT_MODEL, models: ALLOWED_MODELS });
    }

    let credit: unknown = null;
    try {
      const response = await fishFetch('/wallet/self/api-credit');
      if (response.ok) credit = await response.json();
    } catch (err) {
      request.log.warn({ msg: 'Fish credit lookup failed', err });
    }

    return reply.send({
      configured: true,
      defaultModel: DEFAULT_MODEL,
      models: ALLOWED_MODELS,
      credit,
    });
  });

  /** List voice models. `self=true` (default) is your own library; false
   *  searches Fish's public Voice Library. */
  fastify.get('/api/v1/fish/voices', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    if (!FISH_API_KEY) return notConfigured(reply);

    const query = request.query as Record<string, string | undefined>;
    const params = new URLSearchParams();
    params.set('self', query.self === 'false' ? 'false' : 'true');
    params.set('page_size', String(Math.min(Number(query.page_size) || 24, 100)));
    params.set('page_number', String(Math.max(Number(query.page_number) || 1, 1)));
    if (query.title) params.set('title', query.title);
    if (query.language) params.set('language', query.language);

    try {
      const response = await fishFetch(`/model?${params.toString()}`);
      if (!response.ok) return passThroughError(response, reply, 'Could not list voices');
      return reply.send(await response.json());
    } catch (err) {
      request.log.error({ msg: 'Fish list voices failed', err });
      return reply.code(502).send({
        error: { code: 'FISH_UNREACHABLE', message: 'Could not reach Fish Audio' },
      });
    }
  });

  fastify.get('/api/v1/fish/voices/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    if (!FISH_API_KEY) return notConfigured(reply);

    const { id } = request.params as { id: string };
    try {
      const response = await fishFetch(`/model/${encodeURIComponent(id)}`);
      if (!response.ok) return passThroughError(response, reply, 'Could not fetch voice');
      return reply.send(await response.json());
    } catch (err) {
      request.log.error({ msg: 'Fish get voice failed', err });
      return reply.code(502).send({
        error: { code: 'FISH_UNREACHABLE', message: 'Could not reach Fish Audio' },
      });
    }
  });

  /**
   * Clone a voice. Multipart in, multipart straight back out to Fish — we
   * re-assemble rather than stream so we can enforce a size cap and reject
   * junk before spending an upload.
   *
   * Requires @fastify/multipart. Accepts repeated `voices` file parts plus
   * optional `texts` transcripts, `title`, `description`, `visibility`,
   * `enhance_audio_quality`.
   */
  fastify.post('/api/v1/fish/voices', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    if (!FISH_API_KEY) return notConfigured(reply);

    const anyRequest = request as unknown as {
      isMultipart?: () => boolean;
      parts?: () => AsyncIterableIterator<{
        type: string;
        fieldname: string;
        filename?: string;
        mimetype?: string;
        value?: string;
        toBuffer?: () => Promise<Buffer>;
      }>;
    };

    if (typeof anyRequest.isMultipart !== 'function' || !anyRequest.isMultipart()) {
      return reply.code(400).send({
        error: { code: 'EXPECTED_MULTIPART', message: 'Send the samples as multipart/form-data' },
      });
    }

    const form = new FormData();
    form.set('type', 'tts');
    form.set('train_mode', 'fast');

    let totalBytes = 0;
    let sampleCount = 0;
    const fields: Record<string, string> = {};

    try {
      for await (const part of anyRequest.parts!()) {
        if (part.type === 'file' && part.toBuffer) {
          const buffer = await part.toBuffer();
          totalBytes += buffer.length;
          if (totalBytes > CLONE_MAX_BYTES) {
            return reply.code(413).send({
              error: { code: 'SAMPLES_TOO_LARGE', message: 'Samples exceed 25 MB in total' },
            });
          }
          sampleCount += 1;
          form.append(
            'voices',
            new Blob([buffer], { type: part.mimetype || 'application/octet-stream' }),
            part.filename || `sample-${sampleCount}.wav`
          );
        } else if (part.type === 'field' && typeof part.value === 'string') {
          if (part.fieldname === 'texts') {
            form.append('texts', part.value);
          } else {
            fields[part.fieldname] = part.value;
          }
        }
      }
    } catch (err) {
      request.log.error({ msg: 'Fish clone upload parse failed', err });
      return reply.code(400).send({
        error: { code: 'BAD_UPLOAD', message: 'Could not read the uploaded samples' },
      });
    }

    if (sampleCount === 0) {
      return reply.code(400).send({
        error: { code: 'NO_SAMPLES', message: 'Attach at least one audio sample' },
      });
    }

    const title = (fields.title || '').trim();
    if (!title) {
      return reply
        .code(400)
        .send({ error: { code: 'TITLE_REQUIRED', message: 'Give the voice a name' } });
    }
    form.set('title', title);
    if (fields.description) form.set('description', fields.description);

    // Default private: a cloned sales voice published to Fish's public library
    // by accident is not recoverable.
    const visibility = ALLOWED_VISIBILITY.includes(fields.visibility as never)
      ? fields.visibility
      : 'private';
    form.set('visibility', visibility!);

    if (fields.enhance_audio_quality === 'false') {
      form.set('enhance_audio_quality', 'false');
    }

    try {
      const response = await fishFetch('/model', { method: 'POST', body: form });
      if (!response.ok) return passThroughError(response, reply, 'Voice cloning failed');
      return reply.send(await response.json());
    } catch (err) {
      request.log.error({ msg: 'Fish clone failed', err });
      return reply.code(502).send({
        error: { code: 'FISH_UNREACHABLE', message: 'Could not reach Fish Audio' },
      });
    }
  });

  fastify.patch('/api/v1/fish/voices/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    if (!FISH_API_KEY) return notConfigured(reply);

    const { id } = request.params as { id: string };
    const body = (request.body || {}) as Record<string, unknown>;
    const payload: Record<string, unknown> = {};
    if (typeof body.title === 'string') payload.title = body.title;
    if (typeof body.description === 'string') payload.description = body.description;
    if (ALLOWED_VISIBILITY.includes(body.visibility as never)) payload.visibility = body.visibility;

    if (Object.keys(payload).length === 0) {
      return reply
        .code(400)
        .send({ error: { code: 'NOTHING_TO_UPDATE', message: 'No updatable fields supplied' } });
    }

    try {
      const response = await fishFetch(`/model/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) return passThroughError(response, reply, 'Could not update voice');
      return reply.send({ ok: true });
    } catch (err) {
      request.log.error({ msg: 'Fish update voice failed', err });
      return reply.code(502).send({
        error: { code: 'FISH_UNREACHABLE', message: 'Could not reach Fish Audio' },
      });
    }
  });

  fastify.delete('/api/v1/fish/voices/:id', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    if (!FISH_API_KEY) return notConfigured(reply);

    const { id } = request.params as { id: string };
    try {
      const response = await fishFetch(`/model/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!response.ok) return passThroughError(response, reply, 'Could not delete voice');
      return reply.send({ ok: true });
    } catch (err) {
      request.log.error({ msg: 'Fish delete voice failed', err });
      return reply.code(502).send({
        error: { code: 'FISH_UNREACHABLE', message: 'Could not reach Fish Audio' },
      });
    }
  });

  /**
   * Preview: type a script, hear the voice perform it.
   *
   * Returns mp3 audio bytes for the browser to play. Emotion cues and phoneme
   * tags are part of `text`, so whatever you preview here is exactly what the
   * agent will sound like saying the same line.
   */
  fastify.post('/api/v1/fish/preview', async (request, reply) => {
    if (!requireUser(request, reply)) return;
    if (!FISH_API_KEY) return notConfigured(reply);

    const body = (request.body || {}) as Record<string, unknown>;
    const text = typeof body.text === 'string' ? body.text.trim() : '';

    if (!text) {
      return reply
        .code(400)
        .send({ error: { code: 'TEXT_REQUIRED', message: 'Type a script to preview' } });
    }
    if (text.length > PREVIEW_MAX_CHARS) {
      return reply.code(400).send({
        error: {
          code: 'TEXT_TOO_LONG',
          message: `Previews are capped at ${PREVIEW_MAX_CHARS} characters`,
        },
      });
    }

    const model = ALLOWED_MODELS.includes(body.model as never)
      ? (body.model as string)
      : DEFAULT_MODEL;
    const latency = ALLOWED_LATENCY.includes(body.latency as never)
      ? (body.latency as string)
      : 'balanced';

    const clamp = (value: unknown, min: number, max: number, fallback: number) => {
      const n = Number(value);
      return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
    };

    const payload: Record<string, unknown> = {
      text,
      format: 'mp3',
      mp3_bitrate: 128,
      latency,
      chunk_length: clamp(body.chunk_length, 100, 300, 200),
      normalize: body.normalize === false ? false : true,
      prosody: {
        speed: clamp(body.speed, 0.5, 2.0, 1.0),
        volume: clamp(body.volume, -20, 20, 0),
      },
    };
    if (typeof body.voice === 'string' && body.voice.trim()) {
      payload.reference_id = body.voice.trim();
    }
    if (body.temperature !== undefined) payload.temperature = clamp(body.temperature, 0, 1, 0.7);
    if (body.top_p !== undefined) payload.top_p = clamp(body.top_p, 0, 1, 0.7);

    try {
      const response = await fishFetch('/v1/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', model },
        body: JSON.stringify(payload),
      });

      if (!response.ok) return passThroughError(response, reply, 'Preview generation failed');

      const audio = Buffer.from(await response.arrayBuffer());
      return reply
        .header('Content-Type', 'audio/mpeg')
        .header('Cache-Control', 'no-store')
        .header('X-Fish-Model', model)
        .send(audio);
    } catch (err) {
      request.log.error({ msg: 'Fish preview failed', err });
      return reply.code(502).send({
        error: { code: 'FISH_UNREACHABLE', message: 'Could not reach Fish Audio' },
      });
    }
  });
}
