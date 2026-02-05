/**
 * AI Campaign Service
 *
 * Orchestrates AI outbound calling campaigns using Vapi under the hood.
 * IMPORTANT: Vapi branding is NEVER exposed in the UI - this is internal only.
 */

import type { Prisma } from '@prisma/client';

import { getPrismaClient } from '../lib/prisma.js';

// Vapi API configuration - exported for use by call initiation (TBD)
export const VapiConfig = {
  apiUrl: 'https://api.vapi.ai',
  apiKey: process.env.VAPI_API_KEY || '',
  assistantId: process.env.VAPI_ASSISTANT_ID || '',
  phoneNumberId: process.env.VAPI_PHONE_NUMBER_ID || '',
};

// Billing configuration
const MINIMUM_WALLET_BALANCE = 5.0;
const COST_MARGIN_MULTIPLIER = 1.2;

// Type definitions (inline to work around Prisma monorepo issues)
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
  assistantName: string;
  voiceId: string;
  firstMessage: string;
  systemPrompt: string | null;
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

interface CreateCampaignInput {
  tenantId: string;
  name: string;
  description?: string;
  assistantName?: string;
  voiceId?: string;
  firstMessage?: string;
  systemPrompt?: string;
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
// Campaign CRUD
// ============================================================================

export async function createCampaign(input: CreateCampaignInput): Promise<AICampaign> {
  const prisma = getPrismaClient();

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

  // Use raw query to create since TypeScript doesn't see the model
  const result = await prisma.$queryRaw<AICampaign[]>`
    INSERT INTO ai_campaigns (
      id, tenant_id, name, description, status, assistant_name, voice_id,
      first_message, system_prompt, phone_number_id, max_concurrent,
      calls_per_minute, schedule_enabled, schedule_start, schedule_end,
      timezone, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), ${input.tenantId}, ${input.name}, ${input.description ?? null},
      'DRAFT', ${input.assistantName ?? 'AI Agent'}, ${input.voiceId ?? 'alloy'},
      ${input.firstMessage ?? 'Hello, this is your AI assistant calling.'},
      ${input.systemPrompt ?? null}, ${input.phoneNumberId},
      ${input.maxConcurrent ?? 1}, ${input.callsPerMinute ?? 10},
      ${input.scheduleEnabled ?? false}, ${input.scheduleStart ?? null},
      ${input.scheduleEnd ?? null}, ${input.timezone ?? 'America/New_York'},
      NOW(), NOW()
    )
    RETURNING *
  `;

  return result[0];
}

export async function getCampaign(
  campaignId: string,
  tenantId: string
): Promise<AICampaign | null> {
  const prisma = getPrismaClient();

  const result = await prisma.$queryRaw<AICampaign[]>`
    SELECT * FROM ai_campaigns
    WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}
    LIMIT 1
  `;

  return result[0] ?? null;
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
      WHERE tenant_id = ${tenantId}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM ai_campaigns WHERE tenant_id = ${tenantId}
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
  const prisma = getPrismaClient();

  // Check if campaign exists
  const existing = await getCampaign(campaignId, tenantId);
  if (!existing) {
    throw new Error('Campaign not found');
  }

  // Build dynamic update - simplified for readability
  const result = await prisma.$queryRaw<AICampaign[]>`
    UPDATE ai_campaigns SET
      name = COALESCE(${updates.name ?? null}, name),
      description = COALESCE(${updates.description ?? null}, description),
      assistant_name = COALESCE(${updates.assistantName ?? null}, assistant_name),
      voice_id = COALESCE(${updates.voiceId ?? null}, voice_id),
      first_message = COALESCE(${updates.firstMessage ?? null}, first_message),
      system_prompt = COALESCE(${updates.systemPrompt ?? null}, system_prompt),
      max_concurrent = COALESCE(${updates.maxConcurrent ?? null}, max_concurrent),
      calls_per_minute = COALESCE(${updates.callsPerMinute ?? null}, calls_per_minute),
      updated_at = NOW()
    WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}
    RETURNING *
  `;

  return result[0];
}

export async function deleteCampaign(campaignId: string, tenantId: string): Promise<void> {
  const prisma = getPrismaClient();

  const campaign = await getCampaign(campaignId, tenantId);
  if (!campaign) {
    throw new Error('Campaign not found');
  }

  if (campaign.status === 'RUNNING') {
    throw new Error('Cannot delete a running campaign. Pause it first.');
  }

  await prisma.$executeRaw`
    DELETE FROM ai_campaigns WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}
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

  // Verify campaign exists
  const campaignCheck = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM ai_campaigns WHERE id = ${input.campaignId}::uuid
  `;

  if (Number(campaignCheck[0].count) === 0) {
    throw new Error('Campaign not found');
  }

  const results = { imported: 0, skipped: 0, errors: [] as string[] };

  for (const contact of input.contacts) {
    const normalized = normalizePhoneNumber(contact.phoneNumber);
    if (!normalized) {
      results.skipped++;
      results.errors.push(`Invalid phone number: ${contact.phoneNumber}`);
      continue;
    }

    try {
      await prisma.$executeRaw`
        INSERT INTO ai_campaign_contacts (
          id, campaign_id, phone_number, first_name, last_name, metadata, status, created_at
        ) VALUES (
          gen_random_uuid(), ${input.campaignId}::uuid, ${normalized},
          ${contact.firstName ?? null}, ${contact.lastName ?? null},
          ${JSON.stringify(contact.metadata ?? {})}::jsonb, 'PENDING', NOW()
        )
        ON CONFLICT DO NOTHING
      `;
      results.imported++;
    } catch {
      results.skipped++;
    }
  }

  // Update campaign status if we added contacts
  if (results.imported > 0) {
    await prisma.$executeRaw`
      UPDATE ai_campaigns SET status = 'READY', updated_at = NOW()
      WHERE id = ${input.campaignId}::uuid AND status = 'DRAFT'
    `;
  }

  return results;
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

  const [contacts, countResult] = await Promise.all([
    status
      ? prisma.$queryRaw<AICampaignContact[]>`
          SELECT * FROM ai_campaign_contacts
          WHERE campaign_id = ${campaignId}::uuid AND status = ${status}
          ORDER BY created_at ASC
          LIMIT ${limit} OFFSET ${offset}
        `
      : prisma.$queryRaw<AICampaignContact[]>`
          SELECT * FROM ai_campaign_contacts
          WHERE campaign_id = ${campaignId}::uuid
          ORDER BY created_at ASC
          LIMIT ${limit} OFFSET ${offset}
        `,
    status
      ? prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM ai_campaign_contacts
          WHERE campaign_id = ${campaignId}::uuid AND status = ${status}
        `
      : prisma.$queryRaw<[{ count: bigint }]>`
          SELECT COUNT(*) as count FROM ai_campaign_contacts
          WHERE campaign_id = ${campaignId}::uuid
        `,
  ]);

  const total = Number(countResult[0].count);

  return {
    data: contacts,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
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
    WHERE campaign_id = ${campaignId}::uuid AND status = 'PENDING'
  `;

  if (Number(pendingCheck[0].count) === 0) {
    throw new Error('No pending contacts to call');
  }

  const hasBalance = await checkWalletBalance(tenantId);
  if (!hasBalance) throw new Error('Insufficient wallet balance. Please add funds.');

  const result = await prisma.$queryRaw<AICampaign[]>`
    UPDATE ai_campaigns SET status = 'RUNNING', updated_at = NOW()
    WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}
    RETURNING *
  `;

  return result[0];
}

export async function pauseCampaign(campaignId: string, tenantId: string): Promise<AICampaign> {
  const prisma = getPrismaClient();

  const campaign = await getCampaign(campaignId, tenantId);
  if (!campaign) throw new Error('Campaign not found');

  const result = await prisma.$queryRaw<AICampaign[]>`
    UPDATE ai_campaigns SET status = 'PAUSED', updated_at = NOW()
    WHERE id = ${campaignId}::uuid AND tenant_id = ${tenantId}
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
        WHERE id = ${callRecordId}::uuid
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
    Array<{ contact_id: string; campaign_id: string; tenant_id: string }>
  >`
    SELECT c.contact_id, c.campaign_id, camp.tenant_id
    FROM ai_campaign_calls c
    JOIN ai_campaigns camp ON c.campaign_id = camp.id
    WHERE c.id = ${callRecordId}::uuid
  `;

  if (callRecords.length === 0) return;

  const callRecord = callRecords[0];
  const vapiCost = call.cost ?? 0;
  const billableAmount = vapiCost * COST_MARGIN_MULTIPLIER;

  // Update call record
  await prisma.$executeRaw`
    UPDATE ai_campaign_calls SET
      status = ${status},
      outcome = ${call.endedReason ?? null},
      duration = ${call.duration ?? null},
      recording_url = ${call.recordingUrl ?? null},
      transcript = ${call.transcript ?? null},
      analysis = ${JSON.stringify(call.analysis ?? {})}::jsonb,
      extraction = ${JSON.stringify(extractKeyData(call.analysis))}::jsonb,
      cost = ${vapiCost},
      billable = ${billableAmount},
      ended_at = NOW()
    WHERE id = ${callRecordId}::uuid
  `;

  // Update contact status
  const contactStatus: ContactStatus =
    status === 'COMPLETED' ? 'COMPLETED' : status === 'NO_ANSWER' ? 'NO_ANSWER' : 'FAILED';

  await prisma.$executeRaw`
    UPDATE ai_campaign_contacts SET status = ${contactStatus}
    WHERE id = ${callRecord.contact_id}::uuid
  `;

  // Deduct from wallet
  await deductFromWallet(callRecord.tenant_id, billableAmount, callRecordId);
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
  if (!budget) return true;
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

  const budget = await prisma.tenantBudget.findUnique({ where: { tenantId } });
  if (budget) {
    const remaining = Number(budget.monthlyBudget ?? 0) - Number(budget.currentMonthSpend ?? 0);
    if (remaining < MINIMUM_WALLET_BALANCE) {
      // Auto-pause all running campaigns for this tenant
      await prisma.$executeRaw`
        UPDATE ai_campaigns SET status = 'PAUSED', updated_at = NOW()
        WHERE tenant_id = ${tenantId} AND status = 'RUNNING'
      `;
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

  // Get contact stats
  const contactStats = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT status, COUNT(*) as count
    FROM ai_campaign_contacts
    WHERE campaign_id = ${campaignId}::uuid
    GROUP BY status
  `;

  // Get call stats
  const callStats = await prisma.$queryRaw<Array<{ status: string; count: bigint }>>`
    SELECT status, COUNT(*) as count
    FROM ai_campaign_calls
    WHERE campaign_id = ${campaignId}::uuid
    GROUP BY status
  `;

  // Get cost/duration stats
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
    WHERE campaign_id = ${campaignId}::uuid
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
      WHERE campaign_id = ${campaignId}::uuid
      ORDER BY started_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
    prisma.$queryRaw<[{ count: bigint }]>`
      SELECT COUNT(*) as count FROM ai_campaign_calls
      WHERE campaign_id = ${campaignId}::uuid
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
