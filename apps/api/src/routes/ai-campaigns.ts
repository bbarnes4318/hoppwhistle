/**
 * AI Campaigns API Routes (Fastify)
 *
 * All endpoints for managing AI outbound calling campaigns.
 * NOTE: No Vapi branding should ever be exposed in responses.
 */

import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import * as AICampaignService from '../services/ai-campaign-service.js';

export async function registerAICampaignRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Ensure auth for all routes
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user?.tenantId) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
  });

  // ============================================================================
  // Campaign CRUD
  // ============================================================================

  // List all AI campaigns
  fastify.get('/api/v1/ai-campaigns', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { page = '1', limit = '50' } = request.query as { page?: string; limit?: string };

    try {
      const result = await AICampaignService.listCampaigns(
        tenantId,
        parseInt(page),
        parseInt(limit)
      );
      return reply.send(result);
    } catch (error) {
      console.error('Failed to list AI campaigns:', error);
      return reply.status(500).send({ error: 'Failed to list campaigns' });
    }
  });

  // List available templates (for wizard vertical selection)
  fastify.get('/api/v1/ai-campaigns/templates', async (_request, reply) => {
    try {
      const templates = await AICampaignService.listTemplates();
      return reply.send({ data: templates });
    } catch (error) {
      console.error('Failed to list templates:', error);
      return reply.status(500).send({ error: 'Failed to list templates' });
    }
  });

  // Create new campaign
  interface CreateCampaignBody {
    name: string;
    description?: string;
    vertical: string;
    direction?: string;
    carrier?: 'bulkvs' | 'signalwire';
    agencyName: string;
    transferNumber: string;
    filters: Record<string, boolean>;
    phoneNumberId: string;
    maxConcurrent?: number;
    callsPerMinute?: number;
    scheduleEnabled?: boolean;
    scheduleStart?: string;
    scheduleEnd?: string;
    timezone?: string;
  }

  fastify.post('/api/v1/ai-campaigns', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const body = request.body as CreateCampaignBody;

    // Validation
    if (
      !body.name ||
      !body.phoneNumberId ||
      !body.vertical ||
      !body.agencyName ||
      !body.transferNumber
    ) {
      return reply.status(400).send({
        error: 'name, vertical, agencyName, transferNumber, and phoneNumberId are required',
      });
    }

    try {
      const campaign = await AICampaignService.createCampaign({
        ...body,
        tenantId,
        filters: body.filters || {},
        scheduleStart: body.scheduleStart ? new Date(body.scheduleStart) : undefined,
        scheduleEnd: body.scheduleEnd ? new Date(body.scheduleEnd) : undefined,
      });
      return reply.status(201).send({ data: campaign });
    } catch (error) {
      console.error('Failed to create AI campaign:', error);
      const message = error instanceof Error ? error.message : 'Failed to create campaign';
      return reply.status(400).send({ error: message });
    }
  });

  // Get campaign by ID
  fastify.get('/api/v1/ai-campaigns/:id', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const campaign = await AICampaignService.getCampaign(id, tenantId);
      if (!campaign) {
        return reply.status(404).send({ error: 'Campaign not found' });
      }
      return reply.send({ data: campaign });
    } catch (error) {
      console.error('Failed to get AI campaign:', error);
      return reply.status(500).send({ error: 'Failed to get campaign' });
    }
  });

  // Update campaign
  fastify.patch('/api/v1/ai-campaigns/:id', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id } = request.params as { id: string };
    const body = request.body as Partial<CreateCampaignBody>;

    try {
      const campaign = await AICampaignService.updateCampaign(id, tenantId, {
        ...body,
        scheduleStart: body.scheduleStart ? new Date(body.scheduleStart) : undefined,
        scheduleEnd: body.scheduleEnd ? new Date(body.scheduleEnd) : undefined,
      });
      return reply.send({ data: campaign });
    } catch (error) {
      console.error('Failed to update AI campaign:', error);
      const message = error instanceof Error ? error.message : 'Failed to update campaign';
      return reply.status(400).send({ error: message });
    }
  });

  // Delete campaign
  fastify.delete('/api/v1/ai-campaigns/:id', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id } = request.params as { id: string };

    try {
      await AICampaignService.deleteCampaign(id, tenantId);
      return reply.send({ success: true });
    } catch (error) {
      console.error('Failed to delete AI campaign:', error);
      const message = error instanceof Error ? error.message : 'Failed to delete campaign';
      return reply.status(400).send({ error: message });
    }
  });

  // ============================================================================
  // Campaign Control
  // ============================================================================

  // Start campaign
  fastify.post('/api/v1/ai-campaigns/:id/start', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const campaign = await AICampaignService.startCampaign(id, tenantId);
      return reply.send({ data: campaign });
    } catch (error) {
      console.error('Failed to start AI campaign:', error);
      const message = error instanceof Error ? error.message : 'Failed to start campaign';
      return reply.status(400).send({ error: message });
    }
  });

  // Pause campaign
  fastify.post('/api/v1/ai-campaigns/:id/pause', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const campaign = await AICampaignService.pauseCampaign(id, tenantId);
      return reply.send({ data: campaign });
    } catch (error) {
      console.error('Failed to pause AI campaign:', error);
      const message = error instanceof Error ? error.message : 'Failed to pause campaign';
      return reply.status(400).send({ error: message });
    }
  });

  // Get campaign stats
  fastify.get('/api/v1/ai-campaigns/:id/stats', async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const stats = await AICampaignService.getCampaignStats(id);
      return reply.send({ data: stats });
    } catch (error) {
      console.error('Failed to get AI campaign stats:', error);
      return reply.status(500).send({ error: 'Failed to get stats' });
    }
  });

  // Get campaign restart-unreached preview
  fastify.get('/api/v1/ai-campaigns/:id/restart-unreached/preview', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const preview = await AICampaignService.getRestartUnreachedPreview(id, tenantId);
      return reply.send({ data: preview });
    } catch (error) {
      console.error('Failed to get restart preview:', error);
      const message = error instanceof Error ? error.message : 'Failed to get preview';
      return reply.status(400).send({ error: message });
    }
  });

  // Execute campaign restart-unreached
  fastify.post('/api/v1/ai-campaigns/:id/restart-unreached', async (request, reply) => {
    const tenantId = request.user.tenantId;
    const { id } = request.params as { id: string };

    try {
      const result = await AICampaignService.executeRestartUnreached(id, tenantId);
      return reply.send({ data: result });
    } catch (error) {
      console.error('Failed to execute restart:', error);
      const message = error instanceof Error ? error.message : 'Failed to execute restart';
      return reply.status(400).send({ error: message });
    }
  });


  // ============================================================================
  // Contacts
  // ============================================================================

  // List contacts
  fastify.get('/api/v1/ai-campaigns/:id/contacts', async (request, reply) => {
    const { id } = request.params as { id: string };
    const {
      page = '1',
      limit = '50',
      status,
    } = request.query as {
      page?: string;
      limit?: string;
      status?: string;
    };

    try {
      const result = await AICampaignService.getContacts(
        id,
        parseInt(page),
        parseInt(limit),
        status as
          | 'PENDING'
          | 'CALLING'
          | 'COMPLETED'
          | 'FAILED'
          | 'SKIPPED'
          | 'NO_ANSWER'
          | undefined
      );
      return reply.send(result);
    } catch (error) {
      console.error('Failed to list contacts:', error);
      return reply.status(500).send({ error: 'Failed to list contacts' });
    }
  });

  // Upload contacts
  interface UploadContactsBody {
    contacts: Array<{
      phoneNumber: string;
      firstName?: string;
      lastName?: string;
      metadata?: Record<string, unknown>;
    }>;
  }

  fastify.post('/api/v1/ai-campaigns/:id/contacts', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as UploadContactsBody;

    if (!body.contacts || !Array.isArray(body.contacts) || body.contacts.length === 0) {
      return reply.status(400).send({ error: 'contacts array is required' });
    }

    try {
      const result = await AICampaignService.uploadContacts({
        campaignId: id,
        contacts: body.contacts,
      });
      return reply.send({ data: result });
    } catch (error) {
      console.error('Failed to upload contacts:', error);
      const message = error instanceof Error ? error.message : 'Failed to upload contacts';
      return reply.status(400).send({ error: message });
    }
  });

  // ============================================================================
  // Call Records
  // ============================================================================

  // List calls
  fastify.get('/api/v1/ai-campaigns/:id/calls', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { page = '1', limit = '50' } = request.query as { page?: string; limit?: string };

    try {
      const result = await AICampaignService.getCalls(id, parseInt(page), parseInt(limit));
      return reply.send(result);
    } catch (error) {
      console.error('Failed to list calls:', error);
      return reply.status(500).send({ error: 'Failed to list calls' });
    }
  });
}

// ============================================================================
// Vapi Webhook Handler (separate - no auth required)
// ============================================================================

export async function registerVapiWebhookRoutes(
  fastify: FastifyInstance,
  _opts: FastifyPluginOptions
): Promise<void> {
  // Vapi webhook - no auth, called by Vapi directly
  fastify.post('/api/v1/webhooks/vapi', async (request, reply) => {
    try {
      const payload = request.body as AICampaignService.VapiWebhookPayload;

      console.log('[Vapi Webhook] Received:', payload.message?.type);

      await AICampaignService.handleVapiWebhook(payload);

      return reply.send({ received: true });
    } catch (error) {
      console.error('[Vapi Webhook] Error:', error);
      // Return 200 to prevent retries
      return reply.send({ received: true, error: 'Processing error' });
    }
  });
}
