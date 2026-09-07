import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { resolveTenant } from '../lib/tenant-context.js';

const VAPI_BASE = 'https://api.vapi.ai';

const VOICE_OPTIONS = [
  { id: 'sarah', name: 'Sarah', provider: '11labs', desc: 'Warm, professional female' },
  { id: 'mark', name: 'Mark', provider: '11labs', desc: 'Confident male' },
  { id: 'jessica', name: 'Jessica', provider: '11labs', desc: 'Friendly, approachable female' },
  { id: 'ryan', name: 'Ryan', provider: '11labs', desc: 'Calm, authoritative male' },
  { id: 'andrea', name: 'Andrea', provider: 'deepgram', desc: 'Clear, articulate female' },
];

export async function registerMusicVoiceRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Ensure auth for all routes
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user?.tenantId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // Helper to check VAPI_API_KEY
  const getApiKey = (): string => {
    const key = process.env.VAPI_API_KEY;
    if (!key) {
      throw new Error('Vapi API Key configuration error: VAPI_API_KEY is not defined.');
    }
    return key;
  };

  // 1. GET /api/v1/music-console/voice-agents
  fastify.get('/api/v1/music-console/voice-agents', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const prisma = getPrismaClient();

    try {
      const apiKey = getApiKey();

      // Retrieve all voice agents matching this tenant and source = "music-console"
      const localAgents = await prisma.voiceAgent.findMany({
        where: {
          tenantId,
          source: 'music-console',
        },
        orderBy: {
          createdAt: 'desc',
        },
      });

      if (localAgents.length === 0) {
        return reply.send([]);
      }

      // Fetch all assistants from Vapi
      const res = await fetch(`${VAPI_BASE}/assistant`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`Vapi API responded with status ${res.status}`);
      }

      const assistants = await res.json();
      const localMap = new Map(localAgents.map(a => [a.vapiAssistantId, a]));

      // Filter and enrich matching assistants
      const enriched = assistants
        .filter((a: any) => localMap.has(a.id))
        .map((a: any) => {
          const local = localMap.get(a.id)!;
          return {
            ...a,
            id: local.id, // Override ID with local DB VoiceAgent ID
            vapiAssistantId: local.vapiAssistantId,
            displayName: local.displayName,
            createdAt: local.createdAt,
            updatedAt: local.updatedAt,
          };
        });

      return reply.send(enriched);
    } catch (error: any) {
      console.error('[Music Console Voice] List error:', error);
      return reply.status(500).send({
        error: error.message || 'Failed to list voice agents',
      });
    }
  });

  // 2. POST /api/v1/music-console/voice-agents
  fastify.post('/api/v1/music-console/voice-agents', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const userId = request.user.userId;
    const prisma = getPrismaClient();
    const body = request.body as any;

    if (!body.name || !body.systemPrompt) {
      return reply.status(400).send({ error: 'Name and system prompt are required' });
    }

    try {
      const apiKey = getApiKey();
      const voiceConfig = VOICE_OPTIONS.find(v => v.id === body.voice);

      // Construct payload for Vapi assistant creation
      const vapiPayload = {
        name: body.name,
        firstMessage: body.firstMessage,
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          messages: [{ role: 'system', content: body.systemPrompt }],
        },
        voice: {
          provider: voiceConfig?.provider || '11labs',
          voiceId: voiceConfig?.id || 'sarah',
        },
        forwardingPhoneNumber: body.forwardingNumber || undefined,
        maxDurationSeconds: 3600,
        endCallFunctionEnabled: true,
        recordingEnabled: true,
        backgroundSound: 'office',
        backchannelingEnabled: true,
        firstMessageMode: 'assistant-waits-for-user',
        metadata: {
          source: 'music-console',
          tenantId,
          userId,
        },
      };

      const res = await fetch(`${VAPI_BASE}/assistant`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vapiPayload),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Vapi assistant creation failed: ${errText}`);
      }

      const createdAssistant = await res.json();

      // Save mapping record to database
      const voiceAgent = await prisma.voiceAgent.create({
        data: {
          tenantId,
          userId: userId || null,
          vapiAssistantId: createdAssistant.id,
          displayName: body.name,
          status: 'active',
          source: 'music-console',
          metadata: {
            category: body.category || 'custom',
          },
        },
      });

      return reply.status(201).send({
        ...createdAssistant,
        id: voiceAgent.id,
        vapiAssistantId: voiceAgent.vapiAssistantId,
        displayName: voiceAgent.displayName,
      });
    } catch (error: any) {
      console.error('[Music Console Voice] Create error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to create voice agent' });
    }
  });

  // 3. DELETE /api/v1/music-console/voice-agents/:id
  fastify.delete('/api/v1/music-console/voice-agents/:id', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const prisma = getPrismaClient();

    try {
      const apiKey = getApiKey();

      // Find local VoiceAgent record to verify ownership
      const agent = await prisma.voiceAgent.findFirst({
        where: {
          id,
          tenantId,
          source: 'music-console',
        },
      });

      if (!agent) {
        return reply.status(404).send({ error: 'Voice agent not found or unauthorized' });
      }

      // Delete from Vapi
      const res = await fetch(`${VAPI_BASE}/assistant/${agent.vapiAssistantId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${apiKey}` },
      });

      if (!res.ok) {
        console.warn(`Vapi assistant ${agent.vapiAssistantId} delete failed on Vapi server side.`);
      }

      // Delete locally
      await prisma.voiceAgent.delete({
        where: {
          id: agent.id,
        },
      });

      return reply.send({ success: true });
    } catch (error: any) {
      console.error('[Music Console Voice] Delete error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to delete voice agent' });
    }
  });

  // 4. GET /api/v1/music-console/voice-agents/:id/calls
  fastify.get('/api/v1/music-console/voice-agents/:id/calls', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const { limit = '50' } = request.query as { limit?: string };
    const prisma = getPrismaClient();

    try {
      const apiKey = getApiKey();

      // Verify ownership
      const agent = await prisma.voiceAgent.findFirst({
        where: {
          id,
          tenantId,
          source: 'music-console',
        },
      });

      if (!agent) {
        return reply.status(404).send({ error: 'Voice agent not found or unauthorized' });
      }

      // Fetch calls from Vapi filtered by assistant ID
      const res = await fetch(`${VAPI_BASE}/call?limit=${limit}&assistantId=${agent.vapiAssistantId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        cache: 'no-store',
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch calls from Vapi: Status ${res.status}`);
      }

      const data = await res.json();
      return reply.send(data);
    } catch (error: any) {
      console.error('[Music Console Voice] Fetch calls error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to fetch calls' });
    }
  });

  // 5. POST /api/v1/music-console/voice-agents/:id/calls
  fastify.post('/api/v1/music-console/voice-agents/:id/calls', async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const prisma = getPrismaClient();
    const body = request.body as any;

    try {
      const apiKey = getApiKey();

      // Verify ownership
      const agent = await prisma.voiceAgent.findFirst({
        where: {
          id,
          tenantId,
          source: 'music-console',
        },
      });

      if (!agent) {
        return reply.status(404).send({ error: 'Voice agent not found or unauthorized' });
      }

      // Map raw phone number Caller ID to Vapi phoneNumberId UUID if starting with '+'
      let finalPhoneNumberId = body.phoneNumberId;
      if (finalPhoneNumberId && finalPhoneNumberId.startsWith('+')) {
        const pnRes = await fetch(`${VAPI_BASE}/phone-number`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        if (pnRes.ok) {
          const phoneNumbers = await pnRes.json();
          const matched = phoneNumbers.find((pn: any) => pn.number === finalPhoneNumberId);
          if (matched) {
            finalPhoneNumberId = matched.id;
          } else {
            return reply.status(400).send({
              error: `Phone number ${body.phoneNumberId} not registered in Vapi account.`,
            });
          }
        }
      }

      const vapiPayload = {
        assistantId: agent.vapiAssistantId,
        phoneNumberId: finalPhoneNumberId,
        customer: body.customer,
      };

      const res = await fetch(`${VAPI_BASE}/call/phone`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(vapiPayload),
      });

      if (!res.ok) {
        const text = await res.text();
        let err;
        try {
          err = JSON.parse(text);
        } catch (e) {
          err = { message: text };
        }
        throw new Error(err.message || `Vapi API error: ${res.status}`);
      }

      const callData = await res.json();
      return reply.status(201).send(callData);
    } catch (error: any) {
      console.error('[Music Console Voice] Dispatch call error:', error);
      return reply.status(500).send({ error: error.message || 'Failed to dispatch call' });
    }
  });
}
