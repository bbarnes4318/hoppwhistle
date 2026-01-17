// AI Bot routes - Campaign control, TTS preview, lead management
import { promises as fs } from 'fs';

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

// Configuration paths (same as dial.py)
const LEAD_FILE = '/opt/hopwhistle/test_lead.txt';
const PAUSE_FLAG = '/opt/hopwhistle/pause.flag';
const STATUS_FILE = '/opt/hopwhistle/dialer_status.json';
const DIDS_FILE = '/opt/hopwhistle/dids.json';
const SETTINGS_FILE = '/opt/hopwhistle/bot_settings.json';

interface BotStatus {
  status: 'idle' | 'running' | 'paused' | 'complete' | 'error';
  active_calls: number;
  completed: number;
  remaining: number;
  timestamp: number;
}

interface Lead {
  id: string;
  phone: string;
  name?: string;
  status: 'pending' | 'calling' | 'success' | 'failed' | 'no_answer';
}

interface BotSettings {
  script: string;
  voice: string;
  concurrency: number;
}

function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return 'Unknown error';
}

export function registerBotRoutes(fastify: FastifyInstance): void {
  // Get current bot/dialer status
  fastify.get('/api/bot/status', async () => {
    try {
      const statusData = await fs.readFile(STATUS_FILE, 'utf-8');
      const status = JSON.parse(statusData) as BotStatus;
      return status;
    } catch {
      // No status file means dialer isn't running
      return {
        status: 'idle',
        active_calls: 0,
        completed: 0,
        remaining: 0,
        timestamp: Date.now() / 1000,
      };
    }
  });

  // Start the dialing campaign
  fastify.post<{
    Body: {
      concurrency?: number;
      callDelay?: [number, number];
      script?: string;
    };
  }>('/api/bot/start', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Remove pause flag if it exists
      try {
        await fs.unlink(PAUSE_FLAG);
      } catch {
        // File doesn't exist, that's fine
      }

      // Write initial status
      const status: BotStatus = {
        status: 'running',
        active_calls: 0,
        completed: 0,
        remaining: 0,
        timestamp: Date.now() / 1000,
      };
      await fs.writeFile(STATUS_FILE, JSON.stringify(status));

      return { success: true, message: 'Campaign started' };
    } catch (e: unknown) {
      void reply.code(500);
      return { error: 'Failed to start campaign', message: getErrorMessage(e) };
    }
  });

  // Pause the dialing campaign
  fastify.post('/api/bot/pause', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Create pause flag
      await fs.writeFile(PAUSE_FLAG, new Date().toISOString());

      // Update status
      try {
        const statusData = await fs.readFile(STATUS_FILE, 'utf-8');
        const status = JSON.parse(statusData) as BotStatus;
        status.status = 'paused';
        await fs.writeFile(STATUS_FILE, JSON.stringify(status));
      } catch {
        // Status file might not exist
      }

      return { success: true, message: 'Campaign paused' };
    } catch (e: unknown) {
      void reply.code(500);
      return { error: 'Failed to pause campaign', message: getErrorMessage(e) };
    }
  });

  // Stop/reset the dialing campaign
  fastify.post('/api/bot/stop', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Create pause flag to stop any running calls
      await fs.writeFile(PAUSE_FLAG, new Date().toISOString());

      // Update status to idle
      const status: BotStatus = {
        status: 'idle',
        active_calls: 0,
        completed: 0,
        remaining: 0,
        timestamp: Date.now() / 1000,
      };
      await fs.writeFile(STATUS_FILE, JSON.stringify(status));

      return { success: true, message: 'Campaign stopped' };
    } catch (e: unknown) {
      void reply.code(500);
      return { error: 'Failed to stop campaign', message: getErrorMessage(e) };
    }
  });

  // Upload leads CSV
  fastify.post('/api/bot/leads/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // For multipart file upload
      const data = await request.file();
      if (!data) {
        void reply.code(400);
        return { error: 'No file uploaded' };
      }

      const buffer = await data.toBuffer();
      const content = buffer.toString('utf-8');

      // Parse CSV-ish content (one phone per line, optional name)
      const lines = content.split('\n').filter((l: string) => l.trim());
      const leads: Lead[] = [];
      const phoneSet = new Set<string>();

      for (const line of lines) {
        const parts = line.split(',').map((p: string) => p.trim());
        const phone = parts[0]?.replace(/[^\d+]/g, '');

        if (phone && phone.length >= 10 && !phoneSet.has(phone)) {
          phoneSet.add(phone);
          leads.push({
            id: `lead_${leads.length + 1}`,
            phone,
            name: parts[1] || undefined,
            status: 'pending',
          });
        }
      }

      // Write to lead file for dialer
      const phoneNumbers = leads.map((l: Lead) => l.phone).join('\n');
      await fs.writeFile(LEAD_FILE, phoneNumbers);

      return {
        success: true,
        leads,
        count: leads.length,
      };
    } catch (e: unknown) {
      void reply.code(500);
      return { error: 'Failed to upload leads', message: getErrorMessage(e) };
    }
  });

  // Get leads list
  fastify.get('/api/bot/leads', async () => {
    try {
      const content = await fs.readFile(LEAD_FILE, 'utf-8');
      const phones = content.split('\n').filter((l: string) => l.trim());

      const leads: Lead[] = phones.map((phone: string, i: number) => ({
        id: `lead_${i + 1}`,
        phone: phone.trim(),
        status: 'pending' as const,
      }));

      return { leads };
    } catch {
      return { leads: [] };
    }
  });

  // TTS Preview using Deepgram
  fastify.post<{
    Body: { text: string; voice?: string };
  }>(
    '/api/bot/tts/preview',
    async (
      request: FastifyRequest<{ Body: { text: string; voice?: string } }>,
      reply: FastifyReply
    ) => {
      try {
        const { text, voice = 'aura-asteria-en' } = request.body;

        if (!text || text.trim().length === 0) {
          void reply.code(400);
          return { error: 'Text is required' };
        }

        // Get Deepgram API key from environment
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
          void reply.code(500);
          return { error: 'Deepgram API key not configured' };
        }

        // Call Deepgram TTS API with selected voice
        const response = await fetch(`https://api.deepgram.com/v1/speak?model=${voice}`, {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text: text.trim() }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          void reply.code(response.status);
          return { error: 'TTS generation failed', details: errorText };
        }

        // Stream audio back to client
        const audioBuffer = await response.arrayBuffer();
        void reply
          .header('Content-Type', 'audio/mpeg')
          .header('Content-Length', audioBuffer.byteLength)
          .send(Buffer.from(audioBuffer));
        return;
      } catch (e: unknown) {
        void reply.code(500);
        return { error: 'TTS preview failed', message: getErrorMessage(e) };
      }
    }
  );

  // Get DID pool for caller ID rotation
  fastify.get('/api/bot/dids', async () => {
    try {
      const content = await fs.readFile(DIDS_FILE, 'utf-8');
      const dids = JSON.parse(content) as Record<string, unknown>;
      return { dids: Object.keys(dids) };
    } catch {
      return { dids: [] };
    }
  });

  // Get saved bot settings
  fastify.get('/api/bot/settings', async () => {
    try {
      const content = await fs.readFile(SETTINGS_FILE, 'utf-8');
      const settings = JSON.parse(content) as BotSettings;
      return settings;
    } catch {
      // Return defaults if no settings file
      return {
        script: `Hello! This is a quick call from {company}.

We're reaching out about the final expense coverage you requested information on.

Is this a good time to speak for just a moment?`,
        voice: 'aura-asteria-en',
        concurrency: 10,
      };
    }
  });

  // Save bot settings
  fastify.post<{
    Body: BotSettings;
  }>(
    '/api/bot/settings',
    async (request: FastifyRequest<{ Body: BotSettings }>, reply: FastifyReply) => {
      try {
        const settings = request.body;
        await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2));
        return { success: true, message: 'Settings saved' };
      } catch (e: unknown) {
        void reply.code(500);
        return { error: 'Failed to save settings', message: getErrorMessage(e) };
      }
    }
  );
}
