/**
 * AI Campaign Service — Template-Based Vapi Integration
 *
 * Users select a Vertical → input variables → toggle filters.
 * Backend fetches the VapiTemplate, injects variables, appends filter logic,
 * then calls Vapi API to provision a unique assistant per campaign.
 *
 * IMPORTANT: Vapi branding is NEVER exposed in the UI.
 *
 * A note on raw SQL in this file: do not cast id parameters to ::uuid.
 * Prisma maps `String @id` to a text column unless it is annotated @db.Uuid,
 * and nothing in this schema is -- there is not one uuid-typed column in the
 * database. `WHERE id = ${x}::uuid` therefore asks Postgres for a text = uuid
 * comparison, which has no operator, and the query fails with 42883 every
 * time. Every raw-SQL function below carried that cast, so none of them had
 * ever executed successfully; see ai-campaign-service.raw-sql.test.ts, which
 * drives each one against a real database.
 *
 * The same care applies to the status columns, which are Postgres enums
 * (AICampaignStatus, ContactStatus, AICallStatus). A bare string literal is
 * fine -- Postgres resolves an unknown-typed literal to the enum -- but a bound
 * parameter arrives as text and needs an explicit cast, or the query fails with
 * 42883 on a comparison or 42804 on an assignment. Those failures were
 * invisible until the ::uuid casts came off, because the query never got that
 * far.
 */

import type { Prisma } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';
import type { VoipCarrier } from './vapi-carrier-service.js';

// Vapi API configuration
export const VapiConfig = {
  apiUrl: 'https://api.vapi.ai',
  apiKey: process.env.VAPI_API_KEY || '',
};

// Billing configuration
const MINIMUM_WALLET_BALANCE = 5.0;
const COST_MARGIN_MULTIPLIER = 1.2;
const DEFAULT_COST_PER_MINUTE = 0.25;

// ============================================================================
// Type Definitions
// ============================================================================

type AICampaignStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED';
type ContactStatus = 'PENDING' | 'CALLING' | 'COMPLETED' | 'FAILED' | 'SKIPPED' | 'NO_ANSWER';
type AICallStatus =
  | 'QUEUED'
  | 'RINGING'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'FAILED'
  | 'NO_ANSWER'
  | 'BUSY'
  | 'VOICEMAIL';

interface AICampaign {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  status: AICampaignStatus;
  vertical: string;
  direction: string;
  carrier: VoipCarrier;
  agencyName: string;
  transferNumber: string;
  filters: Prisma.JsonValue;
  vapiAssistantId: string | null;
  vapiPhoneNumberId: string | null;
  phoneNumberId: string;
  maxConcurrent: number;
  callsPerMinute: number;
  scheduleEnabled: boolean;
  scheduleStart: Date | null;
  scheduleEnd: Date | null;
  timezone: string;
  createdAt: Date;
  updatedAt: Date;
}

interface AICampaignContact {
  id: string;
  campaignId: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  metadata: Prisma.JsonValue;
  status: ContactStatus;
  callId: string | null;
  calledAt: Date | null;
  createdAt: Date;
}

interface AICampaignCall {
  id: string;
  campaignId: string;
  contactId: string;
  externalId: string | null;
  status: AICallStatus;
  duration: number | null;
  outcome: string | null;
  recordingUrl: string | null;
  transcript: string | null;
  analysis: Prisma.JsonValue;
  extraction: Prisma.JsonValue;
  cost: Prisma.Decimal | null;
  billable: Prisma.Decimal | null;
  startedAt: Date;
  endedAt: Date | null;
}

interface VapiTemplate {
  id: string;
  name: string;
  vertical: string;
  basePrompt: string;
  voiceId: string;
  firstMessage: string;
  costPerMinute: number;
}

interface CreateCampaignInput {
  tenantId: string;
  name: string;
  description?: string;
  vertical: string;
  direction?: string;
  carrier?: VoipCarrier;
  agencyName: string;
  transferNumber: string;
  filters: Record<string, boolean>;
  phoneNumberId: string;
  maxConcurrent?: number;
  callsPerMinute?: number;
  scheduleEnabled?: boolean;
  scheduleStart?: Date;
  scheduleEnd?: Date;
  timezone?: string;
}

interface UploadContactsInput {
  campaignId: string;
  contacts: Array<{
    phoneNumber: string;
    firstName?: string;
    lastName?: string;
    metadata?: Record<string, unknown>;
  }>;
}

// Response type for Vapi calls - exported for webhook handler
export interface VapiCallResponse {
  id: string;
  status: string;
  cost?: number;
  analysis?: Record<string, unknown>;
  transcript?: string;
  recordingUrl?: string;
  endedReason?: string;
}

// ============================================================================
// Vapi Template Engine
// ============================================================================

/**
 * Fetch the VapiTemplate for a given vertical.
 */
async function getTemplate(vertical: string): Promise<VapiTemplate> {
  const prisma = getPrismaClient();
  const results = await prisma.$queryRaw<VapiTemplate[]>`
    SELECT id, name, vertical, "basePrompt", "voiceId",
           "firstMessage", "costPerMinute"
    FROM vapi_templates WHERE vertical = ${vertical}
  `;
  if (results.length === 0) {
    throw new Error(`No template found for vertical: ${vertical}`);
  }
  return results[0];
}

/**
 * List all available templates (for the UI wizard).
 */
export async function listTemplates(): Promise<VapiTemplate[]> {
  const prisma = getPrismaClient();
  return prisma.$queryRaw<VapiTemplate[]>`
    SELECT id, name, vertical, "voiceId",
           "firstMessage", "costPerMinute",
           '' as "basePrompt"
    FROM vapi_templates ORDER BY name
  `;
}

/**
 * Compile the final prompt by injecting variables and appending filter logic.
 */
function compilePrompt(
  template: VapiTemplate,
  campaign: { agencyName: string; transferNumber: string; filters: Record<string, boolean> }
): { systemPrompt: string; firstMessage: string } {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Replace placeholders
  let prompt = template.basePrompt
    .replace(/\{\{agency_name\}\}/g, campaign.agencyName)
    .replace(/\{\{transfer_number\}\}/g, campaign.transferNumber)
    .replace(/\{\{date\}\}/g, today);

  const firstMsg = template.firstMessage
    .replace(/\{\{agency_name\}\}/g, campaign.agencyName)
    .replace(/\{\{transfer_number\}\}/g, campaign.transferNumber)
    .replace(/\{\{date\}\}/g, today);

  // Append conditional filter logic
  const filterAppendix: string[] = [];

  if (campaign.filters.no_marketplace) {
    filterAppendix.push(
      'ADDITIONAL DISQUALIFICATION: Ask if they currently have an active Marketplace health plan. If YES, say: "It sounds like you already have Marketplace coverage. We focus on helping people who don\'t currently have a plan. Thank you for your time." Then end the call politely.'
    );
  }

  if (campaign.filters.active_bank) {
    filterAppendix.push(
      'ADDITIONAL VERIFICATION: Before transferring, ask: "Do you have an active checking or savings account?" If NO, say: "Unfortunately, an active bank account is required for the enrollment process. Thank you for your time." Then end the call politely.'
    );
  }

  if (campaign.filters.no_alzheimers) {
    filterAppendix.push(
      'ADDITIONAL DISQUALIFICATION: Gently ask: "Are you currently being treated for or diagnosed with Alzheimer\'s or dementia?" If YES, say: "I understand, and I appreciate you sharing that. Unfortunately, our plans may not be the best fit. I\'d recommend speaking with a specialist." Then end the call politely.'
    );
  }

  if (campaign.filters.not_nursing_home) {
    filterAppendix.push(
      'ADDITIONAL DISQUALIFICATION: Ask: "Are you currently residing in a nursing home or long-term care facility?" If YES, say: "Thank you for letting me know. Our plans are designed for those living independently. I appreciate your time." Then end the call politely.'
    );
  }

  if (filterAppendix.length > 0) {
    prompt += '\n\n--- ADDITIONAL CAMPAIGN FILTERS ---\n' + filterAppendix.join('\n\n');
  }

  return { systemPrompt: prompt, firstMessage: firstMsg };
}

/**
 * Provision a unique Vapi assistant for a specific campaign.
 * Calls POST https://api.vapi.ai/assistant and stores the returned ID.
 */
async function createVapiAssistant(campaign: AICampaign): Promise<string> {
  if (!VapiConfig.apiKey) {
    throw new Error('VAPI_API_KEY environment variable is not configured');
  }

  const template = await getTemplate(campaign.vertical);
  const filters = (campaign.filters as Record<string, boolean>) || {};
  const { systemPrompt, firstMessage } = compilePrompt(template, {
    agencyName: campaign.agencyName,
    transferNumber: campaign.transferNumber,
    filters,
  });

  const assistantPayload = {
    name: `${campaign.name}_${campaign.id.substring(0, 8)}`,
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }],
      tools: [
        {
          type: 'transferCall',
          destinations: [
            {
              type: 'number',
              number: campaign.transferNumber,
              message: 'Please hold while I transfer you to a licensed agent.',
            },
          ],
        },
      ],
    },
    voice: {
      provider: 'openai',
      voiceId: template.voiceId,
    },
    transcriber: {
      provider: 'deepgram',
      model: 'nova-2',
      language: 'en',
    },
    firstMessage,
    endCallMessage: 'Thank you for your time. Have a great day!',
    serverUrl: `${process.env.API_PUBLIC_URL || 'https://hopwhistle.com'}/api/v1/webhooks/vapi`,
  };

  console.log(`[Vapi] Provisioning assistant for campaign ${campaign.id}...`);

  const response = await fetch(`${VapiConfig.apiUrl}/assistant`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VapiConfig.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(assistantPayload),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[Vapi] Assistant creation failed: ${response.status}`, errorBody);
    throw new Error(`Vapi assistant creation failed: ${response.status} - ${errorBody}`);
  }

  const result = (await response.json()) as { id: string };
  console.log(`[Vapi] ✅ Assistant provisioned: ${result.id}`);

  // Store the assistant ID on the campaign
  const prisma = getPrismaClient();
  await prisma.$executeRaw`
    UPDATE ai_campaigns SET "vapiAssistantId" = ${result.id}, "updatedAt" = NOW()
    WHERE id = ${campaign.id}
  `;

  return result.id;
}

// ============================================================================
// Campaign CRUD
// ============================================================================

export async function createCampaign(input: CreateCampaignInput): Promise<AICampaign> {
  const prisma = getPrismaClient();

  // Validate phone number ownership
  const phoneNumber = await prisma.phoneNumber.findFirst({
    where: {
      id: input.phoneNumberId,
      tenantId: input.tenantId,
      status: 'ACTIVE',
    },
  });

  if (!phoneNumber) {
    throw new Error('Phone number not found or not owned by tenant');
  }

  // Validate template exists
  await getTemplate(input.vertical);

  // Create campaign record
  const filtersJson = JSON.stringify(input.filters || {});
  const carrierValue = input.carrier ?? 'bulkvs';
  const result = await prisma.$queryRaw<AICampaign[]>`
    INSERT INTO ai_campaigns (
      id, "tenantId", name, description, status, vertical, direction, carrier,
      "agencyName", "transferNumber", filters,
      "phoneNumberId", "maxConcurrent", "callsPerMinute",
      "scheduleEnabled", "scheduleStart", "scheduleEnd", timezone,
      "createdAt", "updatedAt"
    ) VALUES (
      gen_random_uuid(), ${input.tenantId}, ${input.name}, ${input.description ?? null},
      'DRAFT', ${input.vertical}, ${input.direction ?? 'OUTBOUND'}, ${carrierValue},
      ${input.agencyName}, ${input.transferNumber}, ${filtersJson}::jsonb,
      ${input.phoneNumberId}, ${input.maxConcurrent ?? 1}, ${input.callsPerMinute ?? 10},
      ${input.scheduleEnabled ?? false}, ${input.scheduleStart ?? null},
      ${input.scheduleEnd ?? null}, ${input.timezone ?? 'America/New_York'},
      NOW(), NOW()
    )
    RETURNING *
  `;

  const campaign = result[0];

  // Provision Vapi assistant in background (don't block creation)
  try {
    await createVapiAssistant(campaign);
  } catch (err) {
    console.error('[Campaign] Vapi provisioning failed (campaign still created):', err);
    // Campaign is created but without assistant — can be retried
  }

  // Re-fetch to get the updated vapiAssistantId
  const updated = await getCampaign(campaign.id, input.tenantId);
  return updated || campaign;
}

export async function getCampaign(
  campaignId: string,
  tenantId: string
): Promise<AICampaign | null> {
  const prisma = getPrismaClient();
  const results = await prisma.$queryRaw<AICampaign[]>`
    SELECT * FROM ai_campaigns
    WHERE id = ${campaignId} AND "tenantId" = ${tenantId}
  `;
  return results[0] || null;
}

export async function listCampaigns(
  tenantId: string,
  page = 1,
  limit = 50
): Promise<{
  data: AICampaign[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}> {
  const prisma = getPrismaClient();
  const offset = (page - 1) * limit;

  const [campaigns, countResult] = await Promise.all([
    prisma.$queryRaw<AICampaign[]>`
      SELECT * FROM ai_campaigns
      WHERE "tenantId" = ${tenantId}
      ORDER BY "createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM ai_campaigns WHERE "tenantId" = ${tenantId}
    `,
  ]);

  const total = Number(countResult[0].count);

  return {
    data: campaigns,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateCampaign(
  campaignId: string,
  tenantId: string,
  updates: Partial<CreateCampaignInput>
): Promise<AICampaign> {
  const campaign = await getCampaign(campaignId, tenantId);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status === 'RUNNING') throw new Error('Cannot update a running campaign');

  const prisma = getPrismaClient();

  // Build SET parts dynamically
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push('name = $1');
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    sets.push(`description = $${values.length + 1}`);
    values.push(updates.description);
  }

  // For MVP, use a simple update of common fields
  const result = await prisma.$queryRaw<AICampaign[]>`
    UPDATE ai_campaigns SET
      name = COALESCE(${updates.name ?? null}, name),
      description = COALESCE(${updates.description ?? null}, description),
      "updatedAt" = NOW()
    WHERE id = ${campaignId} AND "tenantId" = ${tenantId}
    RETURNING *
  `;

  return result[0];
}

export async function deleteCampaign(campaignId: string, tenantId: string): Promise<void> {
  const prisma = getPrismaClient();
  const campaign = await getCampaign(campaignId, tenantId);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status === 'RUNNING') throw new Error('Cannot delete a running campaign');

  // Clean up Vapi assistant if provisioned
  if (campaign.vapiAssistantId && VapiConfig.apiKey) {
    try {
      await fetch(`${VapiConfig.apiUrl}/assistant/${campaign.vapiAssistantId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${VapiConfig.apiKey}` },
      });
      console.log(`[Vapi] Deleted assistant ${campaign.vapiAssistantId}`);
    } catch (err) {
      console.error('[Vapi] Failed to delete assistant:', err);
    }
  }

  await prisma.$executeRaw`
    DELETE FROM ai_campaigns WHERE id = ${campaignId} AND "tenantId" = ${tenantId}
  `;
}

// ============================================================================
// Contact Management
// ============================================================================

export async function uploadContacts(input: UploadContactsInput): Promise<{
  imported: number;
  skipped: number;
  errors: string[];
}> {
  const prisma = getPrismaClient();
  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const contact of input.contacts) {
    const normalized = normalizePhoneNumber(contact.phoneNumber);
    if (!normalized) {
      skipped++;
      errors.push(`Invalid phone: ${contact.phoneNumber}`);
      continue;
    }

    // Check for duplicates
    const existing = await prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM ai_campaign_contacts
      WHERE "campaignId" = ${input.campaignId} AND "phoneNumber" = ${normalized}
    `;

    if (Number(existing[0].count) > 0) {
      skipped++;
      continue;
    }

    const metadata = contact.metadata ? JSON.stringify(contact.metadata) : null;
    await prisma.$executeRaw`
      INSERT INTO ai_campaign_contacts (
        id, "campaignId", "phoneNumber", "firstName", "lastName", metadata, status, "createdAt"
      ) VALUES (
        gen_random_uuid(), ${input.campaignId}, ${normalized},
        ${contact.firstName ?? null}, ${contact.lastName ?? null},
        ${metadata}::jsonb, 'PENDING', NOW()
      )
    `;
    imported++;
  }

  // Auto-update status to READY if campaign has contacts and is in DRAFT
  if (imported > 0) {
    await prisma.$executeRaw`
      UPDATE ai_campaigns SET status = 'READY', "updatedAt" = NOW()
      WHERE id = ${input.campaignId} AND status = 'DRAFT'
    `;
  }

  return { imported, skipped, errors };
}

export async function getContacts(
  campaignId: string,
  page = 1,
  limit = 50,
  status?: ContactStatus
): Promise<{
  data: AICampaignContact[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}> {
  const prisma = getPrismaClient();
  const offset = (page - 1) * limit;

  if (status) {
    const [contacts, countResult] = await Promise.all([
      prisma.$queryRaw<AICampaignContact[]>`
        SELECT * FROM ai_campaign_contacts
        WHERE "campaignId" = ${campaignId} AND status = ${status}::"ContactStatus"
        ORDER BY "createdAt" ASC
        LIMIT ${limit} OFFSET ${offset}
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM ai_campaign_contacts
        WHERE "campaignId" = ${campaignId} AND status = ${status}::"ContactStatus"
      `,
    ]);

    const total = Number(countResult[0].count);
    return { data: contacts, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }

  const [contacts, countResult] = await Promise.all([
    prisma.$queryRaw<AICampaignContact[]>`
      SELECT * FROM ai_campaign_contacts
      WHERE "campaignId" = ${campaignId}
      ORDER BY "createdAt" ASC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM ai_campaign_contacts
      WHERE "campaignId" = ${campaignId}
    `,
  ]);

  const total = Number(countResult[0].count);
  return { data: contacts, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

// ============================================================================
// Campaign Execution
// ============================================================================

export async function startCampaign(campaignId: string, tenantId: string): Promise<AICampaign> {
  const prisma = getPrismaClient();

  const campaign = await getCampaign(campaignId, tenantId);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status === 'RUNNING') throw new Error('Campaign is already running');

  // Check for pending contacts
  const pendingCheck = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM ai_campaign_contacts
    WHERE "campaignId" = ${campaignId} AND status = 'PENDING'
  `;

  if (Number(pendingCheck[0].count) === 0) {
    throw new Error('No pending contacts to call');
  }

  // Billing check — require minimum balance
  const hasBalance = await checkWalletBalance(tenantId);
  if (!hasBalance) throw new Error('Insufficient wallet balance. Minimum $5.00 required.');

  // Ensure Vapi assistant is provisioned
  if (!campaign.vapiAssistantId) {
    try {
      await createVapiAssistant(campaign);
    } catch (err) {
      throw new Error(
        `Failed to provision AI assistant: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    }
  }

  const result = await prisma.$queryRaw<AICampaign[]>`
    UPDATE ai_campaigns SET status = 'RUNNING', "updatedAt" = NOW()
    WHERE id = ${campaignId} AND "tenantId" = ${tenantId}
    RETURNING *
  `;

  return result[0];
}

export async function pauseCampaign(campaignId: string, tenantId: string): Promise<AICampaign> {
  const prisma = getPrismaClient();

  const campaign = await getCampaign(campaignId, tenantId);
  if (!campaign) throw new Error('Campaign not found');

  const result = await prisma.$queryRaw<AICampaign[]>`
    UPDATE ai_campaigns SET status = 'PAUSED', "updatedAt" = NOW()
    WHERE id = ${campaignId} AND "tenantId" = ${tenantId}
    RETURNING *
  `;

  return result[0];
}

// ============================================================================
// Webhook Handler
// ============================================================================

export interface VapiWebhookPayload {
  message: {
    type: string;
    call?: {
      id: string;
      status: string;
      endedReason?: string;
      duration?: number;
      cost?: number;
      analysis?: Record<string, unknown>;
      transcript?: string;
      recordingUrl?: string;
      metadata?: {
        campaignId?: string;
        contactId?: string;
        callRecordId?: string;
      };
    };
  };
}

export async function handleVapiWebhook(payload: VapiWebhookPayload): Promise<void> {
  const prisma = getPrismaClient();
  const { type, call } = payload.message;

  if (!call?.metadata?.callRecordId) {
    console.log('Webhook: No call record ID, skipping');
    return;
  }

  const callRecordId = call.metadata.callRecordId;

  switch (type) {
    case 'call-started':
      await prisma.$executeRaw`
        UPDATE ai_campaign_calls SET status = 'IN_PROGRESS'
        WHERE id = ${callRecordId}
      `;
      break;

    case 'call-ended':
      await handleCallEnded(callRecordId, call);
      break;
  }
}

async function handleCallEnded(
  callRecordId: string,
  call: NonNullable<VapiWebhookPayload['message']['call']>
): Promise<void> {
  const prisma = getPrismaClient();

  const outcomeMap: Record<string, AICallStatus> = {
    'customer-ended-call': 'COMPLETED',
    'assistant-ended-call': 'COMPLETED',
    voicemail: 'VOICEMAIL',
    'customer-did-not-answer': 'NO_ANSWER',
    'customer-busy': 'BUSY',
    'failed-to-connect': 'FAILED',
  };

  const status = outcomeMap[call.endedReason ?? ''] ?? 'COMPLETED';

  // Get call record to find campaign for billing
  const callRecords = await prisma.$queryRaw<
    Array<{ contactId: string; campaignId: string; tenantId: string }>
  >`
    SELECT c."contactId", c."campaignId", camp."tenantId"
    FROM ai_campaign_calls c
    JOIN ai_campaigns camp ON c."campaignId" = camp.id
    WHERE c.id = ${callRecordId}
  `;

  if (callRecords.length === 0) return;

  const callRecord = callRecords[0];

  // Calculate cost: use template rate or Vapi cost, whichever is available
  const durationMinutes = (call.duration ?? 0) / 60;
  let vapiCost = call.cost ?? 0;

  // If no Vapi cost reported, calculate from template rate
  if (vapiCost === 0 && durationMinutes > 0) {
    // Fetch the campaign's vertical to get the rate
    const campaigns = await prisma.$queryRaw<Array<{ vertical: string }>>`
      SELECT vertical FROM ai_campaigns WHERE id = ${callRecord.campaignId}
    `;
    let costPerMinute = DEFAULT_COST_PER_MINUTE;
    if (campaigns.length > 0) {
      const templates = await prisma.$queryRaw<Array<{ costPerMinute: number }>>`
        SELECT "costPerMinute" FROM vapi_templates WHERE vertical = ${campaigns[0].vertical}
      `;
      if (templates.length > 0) {
        costPerMinute = Number(templates[0].costPerMinute);
      }
    }
    vapiCost = durationMinutes * costPerMinute;
  }

  const billableAmount = vapiCost * COST_MARGIN_MULTIPLIER;

  // Update call record
  await prisma.$executeRaw`
    UPDATE ai_campaign_calls SET
      status = ${status}::"AICallStatus",
      outcome = ${call.endedReason ?? null},
      duration = ${call.duration ?? null},
      "recordingUrl" = ${call.recordingUrl ?? null},
      transcript = ${call.transcript ?? null},
      analysis = ${JSON.stringify(call.analysis ?? {})}::jsonb,
      extraction = ${JSON.stringify(extractKeyData(call.analysis))}::jsonb,
      cost = ${vapiCost},
      billable = ${billableAmount},
      "endedAt" = NOW()
    WHERE id = ${callRecordId}
  `;

  // Update contact status
  const contactStatus: ContactStatus =
    status === 'COMPLETED' ? 'COMPLETED' : status === 'NO_ANSWER' ? 'NO_ANSWER' : 'FAILED';

  await prisma.$executeRaw`
    UPDATE ai_campaign_contacts SET status = ${contactStatus}::"ContactStatus"
    WHERE id = ${callRecord.contactId}
  `;

  // Deduct from wallet
  if (billableAmount > 0) {
    await deductFromWallet(callRecord.tenantId, billableAmount, callRecordId);
  }
}

function extractKeyData(analysis: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!analysis) return {};
  const extraction: Record<string, unknown> = {};
  if (analysis.sentiment) extraction.sentiment = analysis.sentiment;
  if (analysis.appointmentTime) extraction.appointmentTime = analysis.appointmentTime;
  if (analysis.interested) extraction.interested = analysis.interested;
  if (analysis.summary) extraction.summary = analysis.summary;
  return extraction;
}

// ============================================================================
// Billing
// ============================================================================

async function checkWalletBalance(tenantId: string): Promise<boolean> {
  const prisma = getPrismaClient();
  const budget = await prisma.tenantBudget.findUnique({ where: { tenantId } });
  if (!budget) return true; // No budget = no restriction
  const remaining = Number(budget.monthlyBudget ?? 0) - Number(budget.currentMonthSpend ?? 0);
  return remaining >= MINIMUM_WALLET_BALANCE;
}

async function deductFromWallet(
  tenantId: string,
  amount: number,
  _callRecordId: string
): Promise<void> {
  const prisma = getPrismaClient();

  await prisma.tenantBudget.update({
    where: { tenantId },
    data: {
      currentDaySpend: { increment: amount },
      currentMonthSpend: { increment: amount },
    },
  });

  // Check if balance is low — auto-pause campaigns
  const budget = await prisma.tenantBudget.findUnique({ where: { tenantId } });
  if (budget) {
    const remaining = Number(budget.monthlyBudget ?? 0) - Number(budget.currentMonthSpend ?? 0);
    if (remaining < MINIMUM_WALLET_BALANCE) {
      await prisma.$executeRaw`
        UPDATE ai_campaigns SET status = 'PAUSED', "updatedAt" = NOW()
        WHERE "tenantId" = ${tenantId} AND status = 'RUNNING'
      `;
      console.log(
        `[Billing] Auto-paused campaigns for tenant ${tenantId} — low balance: $${remaining.toFixed(2)}`
      );
    }
  }
}

// ============================================================================
// Stats
// ============================================================================

export interface CampaignStats {
  campaignId: string;
  totalContacts: number;
  pendingContacts: number;
  completedContacts: number;
  failedContacts: number;
  totalCalls: number;
  activeCalls: number;
  completedCalls: number;
  totalCost: number;
  totalBillable: number;
  avgDuration: number;
  successRate: number;
}

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const prisma = getPrismaClient();

  const contactStats = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT status, COUNT(*) as count
    FROM ai_campaign_contacts
    WHERE "campaignId" = ${campaignId}
    GROUP BY status
  `;

  const callStats = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT status, COUNT(*) as count
    FROM ai_campaign_calls
    WHERE "campaignId" = ${campaignId}
    GROUP BY status
  `;

  const costStats = await prisma.$queryRaw<
    [
      {
        total_cost: number | null;
        total_billable: number | null;
        avg_duration: number | null;
        total_calls: bigint;
      },
    ]
  >`
    SELECT
      SUM(cost) as total_cost,
      SUM(billable) as total_billable,
      AVG(duration) as avg_duration,
      COUNT(*) as total_calls
    FROM ai_campaign_calls
    WHERE "campaignId" = ${campaignId}
  `;

  const contactCounts = contactStats.reduce(
    (acc, s) => {
      acc[s.status] = Number(s.count);
      return acc;
    },
    {} as Record<string, number>
  );

  const callCounts = callStats.reduce(
    (acc, s) => {
      acc[s.status] = Number(s.count);
      return acc;
    },
    {} as Record<string, number>
  );

  const totalContacts = Object.values(contactCounts).reduce((a, b) => a + b, 0);
  const completedContacts = contactCounts['COMPLETED'] ?? 0;

  return {
    campaignId,
    totalContacts,
    pendingContacts: contactCounts['PENDING'] ?? 0,
    completedContacts,
    failedContacts: (contactCounts['FAILED'] ?? 0) + (contactCounts['NO_ANSWER'] ?? 0),
    totalCalls: Number(costStats[0].total_calls),
    activeCalls:
      (callCounts['QUEUED'] ?? 0) + (callCounts['RINGING'] ?? 0) + (callCounts['IN_PROGRESS'] ?? 0),
    completedCalls: callCounts['COMPLETED'] ?? 0,
    totalCost: Number(costStats[0].total_cost ?? 0),
    totalBillable: Number(costStats[0].total_billable ?? 0),
    avgDuration: Number(costStats[0].avg_duration ?? 0),
    successRate: totalContacts > 0 ? (completedContacts / totalContacts) * 100 : 0,
  };
}

export async function getCalls(
  campaignId: string,
  page = 1,
  limit = 50
): Promise<{
  data: AICampaignCall[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}> {
  const prisma = getPrismaClient();
  const offset = (page - 1) * limit;

  const [calls, countResult] = await Promise.all([
    prisma.$queryRaw<AICampaignCall[]>`
      SELECT * FROM ai_campaign_calls
      WHERE "campaignId" = ${campaignId}
      ORDER BY "startedAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM ai_campaign_calls
      WHERE "campaignId" = ${campaignId}
    `,
  ]);

  const total = Number(countResult[0].count);

  return {
    data: calls,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

// ============================================================================
// Utilities
// ============================================================================

function normalizePhoneNumber(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
}

// ============================================================================
// Disposition & Classification Helpers (Centralized)
// ============================================================================

export function classifyCall(call: { status: string; outcome: string | null }): 'HUMAN_REACHED' | 'ASSISTANT_ENDED' | 'VOICEMAIL' | 'NO_ANSWER' | 'BUSY' | 'FAILED' | 'UNKNOWN' {
  const outcome = call.outcome;
  const status = call.status;

  if (outcome === 'customer-ended-call') {
    return 'HUMAN_REACHED';
  }
  if (outcome === 'assistant-ended-call') {
    return 'ASSISTANT_ENDED';
  }
  if (status === 'COMPLETED') {
    if (!outcome) return 'UNKNOWN';
    if (outcome === 'customer-ended-call') return 'HUMAN_REACHED';
    if (outcome === 'assistant-ended-call') return 'ASSISTANT_ENDED';
    return 'UNKNOWN';
  }
  if (status === 'VOICEMAIL' || outcome === 'voicemail') {
    return 'VOICEMAIL';
  }
  if (status === 'NO_ANSWER' || outcome === 'customer-did-not-answer' || outcome === 'no-answer') {
    return 'NO_ANSWER';
  }
  if (status === 'BUSY' || outcome === 'customer-busy' || outcome === 'busy') {
    return 'BUSY';
  }
  if (status === 'FAILED' || outcome === 'failed-to-connect' || outcome === 'failed' || outcome === 'error' || outcome === 'silence-timeout') {
    return 'FAILED';
  }
  return 'UNKNOWN';
}


// ============================================================================
// Restart Unreached Campaign Action
// ============================================================================

export interface RestartUnreachedPreview {
  totalContacts: number;
  humanReachedExcluded: number;
  assistantEndedExcluded: number;
  unknownExcluded: number;
  dncExcluded: number;
  wrongNumberExcluded: number;
  activeCallExcluded: number;
  neverAttemptedEligible: number;
  noAnswerEligible: number;
  busyEligible: number;
  voicemailEligible: number;
  failedOrSilenceEligible: number;
  totalEligible: number;
}

export async function getRestartUnreachedPreview(
  campaignId: string,
  tenantId: string
): Promise<RestartUnreachedPreview> {
  const prisma = getPrismaClient();

  const campaign = await prisma.aICampaign.findFirst({
    where: { id: campaignId, tenantId },
  });
  if (!campaign) {
    throw new Error('Campaign not found or unauthorized');
  }

  const contacts = await prisma.aICampaignContact.findMany({
    where: { campaignId },
    include: {
      calls: {
        orderBy: { startedAt: 'desc' },
      },
    },
  });

  const preview: RestartUnreachedPreview = {
    totalContacts: contacts.length,
    humanReachedExcluded: 0,
    assistantEndedExcluded: 0,
    unknownExcluded: 0,
    dncExcluded: 0,
    wrongNumberExcluded: 0,
    activeCallExcluded: 0,
    neverAttemptedEligible: 0,
    noAnswerEligible: 0,
    busyEligible: 0,
    voicemailEligible: 0,
    failedOrSilenceEligible: 0,
    totalEligible: 0,
  };

  const { complianceService } = await import('./compliance-service.js');

  for (const contact of contacts) {
    const dncResult = await complianceService.checkDnc(tenantId, contact.phoneNumber, campaignId);
    if (dncResult.blocked || contact.status === 'SKIPPED') {
      preview.dncExcluded++;
      continue;
    }

    const isWrongNumber =
      (contact.metadata && typeof contact.metadata === 'object' && (contact.metadata as { wrongNumber?: unknown }).wrongNumber === true) ||
      contact.calls.some(c => c.outcome && ['wrong-number', 'wrong_number', 'WRONG_NUMBER'].includes(c.outcome));
    if (isWrongNumber) {
      preview.wrongNumberExcluded++;
      continue;
    }

    const hasActiveCall = contact.calls.some(c =>
      ['QUEUED', 'RINGING', 'IN_PROGRESS'].includes(c.status)
    );
    if (hasActiveCall) {
      preview.activeCallExcluded++;
      continue;
    }

    const hasHumanCall = contact.calls.some(c => classifyCall(c) === 'HUMAN_REACHED');
    if (hasHumanCall) {
      preview.humanReachedExcluded++;
      continue;
    }

    const hasAssistantEndedCall = contact.calls.some(c => classifyCall(c) === 'ASSISTANT_ENDED');
    if (hasAssistantEndedCall) {
      preview.assistantEndedExcluded++;
      continue;
    }

    const hasAmbiguousCall = contact.calls.some(c => classifyCall(c) === 'UNKNOWN');
    if (hasAmbiguousCall) {
      preview.unknownExcluded++;
      continue;
    }

    if (contact.calls.length === 0) {
      preview.neverAttemptedEligible++;
      preview.totalEligible++;
    } else {
      const latestCall = contact.calls[0];
      const classification = classifyCall(latestCall);
      if (classification === 'VOICEMAIL') {
        preview.voicemailEligible++;
        preview.totalEligible++;
      } else if (classification === 'NO_ANSWER') {
        preview.noAnswerEligible++;
        preview.totalEligible++;
      } else if (classification === 'BUSY') {
        preview.busyEligible++;
        preview.totalEligible++;
      } else if (classification === 'FAILED') {
        preview.failedOrSilenceEligible++;
        preview.totalEligible++;
      }
    }
  }

  return preview;
}

export async function executeRestartUnreached(
  campaignId: string,
  tenantId: string
): Promise<RestartUnreachedPreview> {
  const prisma = getPrismaClient();

  return await prisma.$transaction(async (tx) => {
    // No "archivedAt": AI campaigns have never had one. The column is not on
    // ai_campaigns, the field is not on any model in the Prisma schema, and
    // AICampaignStatus has no ARCHIVED member -- archiving an AI campaign is
    // not a feature that exists. Selecting it made this whole transaction fail
    // with `column "archivedAt" does not exist`, so POST
    // /api/v1/ai-campaigns/:id/restart-unreached returned 400 on every call.
    // The guard below it could never have fired, because nothing ever set it.
    // The id is compared as text, not cast to ::uuid -- see the note at the top
    // of this file. That cast was the second of the two reasons this endpoint
    // could never succeed, hidden behind the archivedAt error above.
    const campaigns = await tx.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT id, status FROM ai_campaigns 
      WHERE id = ${campaignId} AND "tenantId" = ${tenantId}
      FOR UPDATE
    `;
    if (campaigns.length === 0) {
      throw new Error('Campaign not found or unauthorized');
    }
    const campaign = campaigns[0];
    if (campaign.status !== 'PAUSED' && campaign.status !== 'COMPLETED') {
      throw new Error('Campaign must be PAUSED or COMPLETED to restart');
    }

    const contacts = await tx.aICampaignContact.findMany({
      where: { campaignId },
      include: {
        calls: {
          orderBy: { startedAt: 'desc' },
        },
      },
    });

    const { complianceService } = await import('./compliance-service.js');
    const eligibleContactIds: string[] = [];

    const preview: RestartUnreachedPreview = {
      totalContacts: contacts.length,
      humanReachedExcluded: 0,
      assistantEndedExcluded: 0,
      unknownExcluded: 0,
      dncExcluded: 0,
      wrongNumberExcluded: 0,
      activeCallExcluded: 0,
      neverAttemptedEligible: 0,
      noAnswerEligible: 0,
      busyEligible: 0,
      voicemailEligible: 0,
      failedOrSilenceEligible: 0,
      totalEligible: 0,
    };

    for (const contact of contacts) {
      const dncResult = await complianceService.checkDnc(tenantId, contact.phoneNumber, campaignId, tx);
      if (dncResult.blocked || contact.status === 'SKIPPED') {
        preview.dncExcluded++;
        continue;
      }

      const isWrongNumber =
        (contact.metadata && typeof contact.metadata === 'object' && (contact.metadata as { wrongNumber?: unknown }).wrongNumber === true) ||
        contact.calls.some(c => c.outcome && ['wrong-number', 'wrong_number', 'WRONG_NUMBER'].includes(c.outcome));
      if (isWrongNumber) {
        preview.wrongNumberExcluded++;
        continue;
      }

      const hasActiveCall = contact.calls.some(c =>
        ['QUEUED', 'RINGING', 'IN_PROGRESS'].includes(c.status)
      );
      if (hasActiveCall) {
        preview.activeCallExcluded++;
        continue;
      }

      const hasHumanCall = contact.calls.some(c => classifyCall(c) === 'HUMAN_REACHED');
      if (hasHumanCall) {
        preview.humanReachedExcluded++;
        continue;
      }

      const hasAssistantEndedCall = contact.calls.some(c => classifyCall(c) === 'ASSISTANT_ENDED');
      if (hasAssistantEndedCall) {
        preview.assistantEndedExcluded++;
        continue;
      }

      const hasAmbiguousCall = contact.calls.some(c => classifyCall(c) === 'UNKNOWN');
      if (hasAmbiguousCall) {
        preview.unknownExcluded++;
        continue;
      }


      let isEligible = false;
      if (contact.calls.length === 0) {
        preview.neverAttemptedEligible++;
        preview.totalEligible++;
        isEligible = true;
      } else {
        const latestCall = contact.calls[0];
        const classification = classifyCall(latestCall);
        if (classification === 'VOICEMAIL') {
          preview.voicemailEligible++;
          preview.totalEligible++;
          isEligible = true;
        } else if (classification === 'NO_ANSWER') {
          preview.noAnswerEligible++;
          preview.totalEligible++;
          isEligible = true;
        } else if (classification === 'BUSY') {
          preview.busyEligible++;
          preview.totalEligible++;
          isEligible = true;
        } else if (classification === 'FAILED') {
          preview.failedOrSilenceEligible++;
          preview.totalEligible++;
          isEligible = true;
        }
      }

      if (isEligible) {
        eligibleContactIds.push(contact.id);
      }

    }

    if (eligibleContactIds.length > 0) {
      await tx.aICampaignContact.updateMany({
        where: {
          id: { in: eligibleContactIds },
        },
        data: {
          status: 'PENDING',
        },
      });
    }

    await tx.aICampaign.update({
      where: { id: campaignId },
      data: { status: 'READY' },
    });

    return preview;
  }, {
    timeout: 10000
  });
}

