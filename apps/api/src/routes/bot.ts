// AI Bot routes - Campaign control, TTS preview, lead management
import { FastifyInstance, FastifyRequest } from 'fastify';
import { promises as fs } from 'fs';
import path from 'path';

// Configuration paths (same as dial.py)
const LEAD_FILE = '/opt/hopwhistle/test_lead.txt';
const PAUSE_FLAG = '/opt/hopwhistle/pause.flag';
const STATUS_FILE = '/opt/hopwhistle/dialer_status.json';
const DIDS_FILE = '/opt/hopwhistle/dids.json';

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

export async function registerBotRoutes(fastify: FastifyInstance) {
  // Get current bot/dialer status
  fastify.get('/api/bot/status', async (_request, reply) => {
    try {
      const statusData = await fs.readFile(STATUS_FILE, 'utf-8');
      const status: BotStatus = JSON.parse(statusData);
      return status;
    } catch (e) {
      // No status file means dialer isn't running
      return {
        status: 'idle',
        active_calls: 0,
        completed: 0,
        remaining: 0,
        timestamp: Date.now() / 1000
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
  }>('/api/bot/start', async (request, reply) => {
    try {
      // Remove pause flag if it exists
      try {
        await fs.unlink(PAUSE_FLAG);
      } catch (e) {
        // File doesn't exist, that's fine
      }

      // Write initial status
      const status: BotStatus = {
        status: 'running',
        active_calls: 0,
        completed: 0,
        remaining: 0,
        timestamp: Date.now() / 1000
      };
      await fs.writeFile(STATUS_FILE, JSON.stringify(status));

      // TODO: In production, this would trigger the Python dialer process
      // For now, we just update the status and the dialer polls this

      return { success: true, message: 'Campaign started' };
    } catch (e: any) {
      void reply.code(500);
      return { error: 'Failed to start campaign', message: e.message };
    }
  });

  // Pause the dialing campaign
  fastify.post('/api/bot/pause', async (_request, reply) => {
    try {
      // Create pause flag
      await fs.writeFile(PAUSE_FLAG, new Date().toISOString());

      // Update status
      try {
        const statusData = await fs.readFile(STATUS_FILE, 'utf-8');
        const status: BotStatus = JSON.parse(statusData);
        status.status = 'paused';
        await fs.writeFile(STATUS_FILE, JSON.stringify(status));
      } catch (e) {
        // Status file might not exist
      }

      return { success: true, message: 'Campaign paused' };
    } catch (e: any) {
      void reply.code(500);
      return { error: 'Failed to pause campaign', message: e.message };
    }
  });

  // Stop/reset the dialing campaign
  fastify.post('/api/bot/stop', async (_request, reply) => {
    try {
      // Create pause flag to stop any running calls
      await fs.writeFile(PAUSE_FLAG, new Date().toISOString());

      // Update status to idle
      const status: BotStatus = {
        status: 'idle',
        active_calls: 0,
        completed: 0,
        remaining: 0,
        timestamp: Date.now() / 1000
      };
      await fs.writeFile(STATUS_FILE, JSON.stringify(status));

      return { success: true, message: 'Campaign stopped' };
    } catch (e: any) {
      void reply.code(500);
      return { error: 'Failed to stop campaign', message: e.message };
    }
  });

  // Upload leads CSV
  fastify.post('/api/bot/leads/upload', async (request, reply) => {
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
      const lines = content.split('\n').filter(l => l.trim());
      const leads: Lead[] = [];
      const phoneSet = new Set<string>();

      for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        const phone = parts[0]?.replace(/[^\d+]/g, '');

        if (phone && phone.length >= 10 && !phoneSet.has(phone)) {
          phoneSet.add(phone);
          leads.push({
            id: `lead_${leads.length + 1}`,
            phone,
            name: parts[1] || undefined,
            status: 'pending'
          });
        }
      }

      // Write to lead file for dialer
      const phoneNumbers = leads.map(l => l.phone).join('\n');
      await fs.writeFile(LEAD_FILE, phoneNumbers);

      return {
        success: true,
        leads,
        count: leads.length
      };
    } catch (e: any) {
      void reply.code(500);
      return { error: 'Failed to upload leads', message: e.message };
    }
  });

  // Get leads list
  fastify.get('/api/bot/leads', async (_request, reply) => {
    try {
      const content = await fs.readFile(LEAD_FILE, 'utf-8');
      const phones = content.split('\n').filter(l => l.trim());

      const leads: Lead[] = phones.map((phone, i) => ({
        id: `lead_${i + 1}`,
        phone: phone.trim(),
        status: 'pending'
      }));

      return { leads };
    } catch (e) {
      return { leads: [] };
    }
  });

  // TTS Preview using Deepgram
  fastify.post<{
    Body: { text: string };
  }>('/api/bot/tts/preview', async (request, reply) => {
    try {
      const { text } = request.body;

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

      // Call Deepgram TTS API
      const response = await fetch('https://api.deepgram.com/v1/speak?model=aura-asteria-en', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ text: text.trim() })
      });

      if (!response.ok) {
        const error = await response.text();
        void reply.code(response.status);
        return { error: 'TTS generation failed', details: error };
      }

      // Stream audio back to client
      const audioBuffer = await response.arrayBuffer();
      void reply
        .header('Content-Type', 'audio/mpeg')
        .header('Content-Length', audioBuffer.byteLength)
        .send(Buffer.from(audioBuffer));

    } catch (e: any) {
      void reply.code(500);
      return { error: 'TTS preview failed', message: e.message };
    }
  });

  // Get DID pool for caller ID rotation
  fastify.get('/api/bot/dids', async (_request, reply) => {
    try {
      const content = await fs.readFile(DIDS_FILE, 'utf-8');
      const dids = JSON.parse(content);
      return { dids: Object.keys(dids) };
    } catch (e) {
      return { dids: [] };
    }
  });
}
