#!/usr/bin/env tsx
/**
 * Legacy CPaaS Migration Tool
 *
 * Migrates legacy voice data (CSV/JSON) from older platforms into SignalWire-powered platform.
 *
 * Usage:
 *   pnpm exec migrate --input ./legacy.csv --dry-run
 *   pnpm exec migrate --input ./legacy.csv --commit
 *   pnpm exec migrate --input ./exports/ --commit --tenant-id <tenant-id>
 */

import 'dotenv-flow/config';
import { createHash } from 'crypto';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

import { parse } from 'csv-parse/sync';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { SignalWireAdapter } from '../services/provisioning/adapters/signalwire-adapter.js';

interface ImportOptions {
  input: string;
  commit: boolean;
  tenantId?: string;
  validateSignalWire: boolean;
}

interface ImportStats {
  numbers: {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    duplicates: number;
    errors: string[];
  };
  campaigns: {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    errors: string[];
  };
  calls: {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    duplicates: number;
    errors: string[];
  };
  recordings: {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    unreachable: number;
    errors: string[];
  };
}

interface NumberRow {
  number: string;
  status?: string;
  tenant_id?: string;
  campaign_id?: string;
  purchase_date?: string;
  release_date?: string;
  tags?: string;
}

interface CampaignRow {
  campaign_id: string;
  name: string;
  tenant_id?: string;
  description?: string;
}

interface CallRow {
  call_id: string;
  from: string;
  to: string;
  direction: string;
  status: string;
  duration?: string | number;
  timestamp: string;
  cost?: string | number;
  campaign_id?: string;
}

interface RecordingRow {
  call_id: string;
  recording_url: string;
  duration?: string | number;
  created_at: string;
}

/**
 * Normalize phone number to E.164 format
 */
function normalizePhoneNumber(number: string): string {
  // Remove all non-digit characters
  const digits = number.replace(/\D/g, '');

  // If it's 10 digits, assume US number
  if (digits.length === 10) {
    return `+1${digits}`;
  }

  // If it's 11 digits and starts with 1, it's already US
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }

  // If it already starts with +, return as-is
  if (number.startsWith('+')) {
    return number;
  }

  // Otherwise, try to parse
  return number;
}

/**
 * Generate import hash for deduplication
 */
function generateImportHash(data: Record<string, unknown>): string {
  const str = JSON.stringify(data, Object.keys(data).sort());
  return createHash('sha256').update(str).digest('hex');
}

/**
 * Parse CSV file
 */
function parseCSV(filePath: string): Record<string, unknown>[] {
  const content = readFileSync(filePath, 'utf-8');
  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
  return records;
}

/**
 * Parse JSON file
 */
function parseJSON(filePath: string): Record<string, unknown>[] {
  const content = readFileSync(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Load data from file or directory
 */
function loadData(inputPath: string): Map<string, Record<string, unknown>[]> {
  const data = new Map<string, Record<string, unknown>[]>();
  const stats = statSync(inputPath);

  if (stats.isFile()) {
    const ext = extname(inputPath).toLowerCase();
    const fileName = inputPath.split(/[/\\]/).pop() || '';

    if (fileName.includes('number')) {
      data.set('numbers', ext === '.csv' ? parseCSV(inputPath) : parseJSON(inputPath));
    } else if (fileName.includes('campaign')) {
      data.set('campaigns', ext === '.csv' ? parseCSV(inputPath) : parseJSON(inputPath));
    } else if (fileName.includes('call')) {
      data.set('calls', ext === '.csv' ? parseCSV(inputPath) : parseJSON(inputPath));
    } else if (fileName.includes('recording')) {
      data.set('recordings', ext === '.csv' ? parseCSV(inputPath) : parseJSON(inputPath));
    } else {
      // Try to infer from content
      const records = ext === '.csv' ? parseCSV(inputPath) : parseJSON(inputPath);
      if (records.length > 0) {
        const firstRecord = records[0];
        if ('number' in firstRecord) {
          data.set('numbers', records);
        } else if ('campaign_id' in firstRecord) {
          data.set('campaigns', records);
        } else if ('call_id' in firstRecord) {
          data.set('calls', records);
        } else if ('recording_url' in firstRecord) {
          data.set('recordings', records);
        }
      }
    }
  } else if (stats.isDirectory()) {
    const files = readdirSync(inputPath);
    for (const file of files) {
      const filePath = join(inputPath, file);
      const ext = extname(file).toLowerCase();
      if (ext === '.csv' || ext === '.json') {
        const fileData = ext === '.csv' ? parseCSV(filePath) : parseJSON(filePath);
        if (file.includes('number')) {
          data.set('numbers', fileData);
        } else if (file.includes('campaign')) {
          data.set('campaigns', fileData);
        } else if (file.includes('call')) {
          data.set('calls', fileData);
        } else if (file.includes('recording')) {
          data.set('recordings', fileData);
        }
      }
    }
  }

  return data;
}

/**
 * Validate recording URL is reachable
 */
async function validateRecordingUrl(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Verify number exists in SignalWire
 */
async function verifySignalWireNumber(
  adapter: SignalWireAdapter,
  number: string
): Promise<boolean> {
  try {
    // List numbers and check if this one exists
    const numbers = await adapter.listNumbers();
    return numbers.some(n => n.number === number);
  } catch (error) {
    logger.warn({ msg: 'Failed to verify SignalWire number', number, error });
    return false;
  }
}

/**
 * Map status string to PhoneNumberStatus enum
 */
function mapPhoneNumberStatus(status?: string): 'ACTIVE' | 'INACTIVE' | 'PORTING' | 'SUSPENDED' {
  const statusLower = (status || '').toLowerCase();
  if (statusLower.includes('active') || statusLower === 'assigned') {
    return 'ACTIVE';
  }
  if (statusLower.includes('inactive') || statusLower === 'released') {
    return 'INACTIVE';
  }
  if (statusLower.includes('port')) {
    return 'PORTING';
  }
  if (statusLower.includes('suspend')) {
    return 'SUSPENDED';
  }
  return 'ACTIVE'; // Default
}

/**
 * Map status string to CallStatus enum
 */
function mapCallStatus(
  status: string
):
  | 'INITIATED'
  | 'RINGING'
  | 'ANSWERED'
  | 'COMPLETED'
  | 'FAILED'
  | 'BUSY'
  | 'NO_ANSWER'
  | 'CANCELLED' {
  const statusLower = status.toLowerCase();
  if (statusLower.includes('initiated') || statusLower.includes('ringing')) {
    return 'RINGING';
  }
  if (statusLower.includes('answered') || statusLower.includes('completed')) {
    return 'COMPLETED';
  }
  if (statusLower.includes('failed')) {
    return 'FAILED';
  }
  if (statusLower.includes('busy')) {
    return 'BUSY';
  }
  if (statusLower.includes('no_answer') || statusLower.includes('no answer')) {
    return 'NO_ANSWER';
  }
  if (statusLower.includes('cancelled') || statusLower.includes('canceled')) {
    return 'CANCELLED';
  }
  return 'COMPLETED'; // Default
}

/**
 * Map direction string to CallDirection enum
 */
function mapCallDirection(direction: string): 'INBOUND' | 'OUTBOUND' {
  const dirLower = direction.toLowerCase();
  return dirLower.includes('inbound') || dirLower.includes('in') ? 'INBOUND' : 'OUTBOUND';
}

/**
 * Import numbers
 */
async function importNumbers(
  rows: NumberRow[],
  tenantId: string,
  stats: ImportStats,
  commit: boolean,
  validateSignalWire: boolean,
  signalWireAdapter?: SignalWireAdapter
): Promise<void> {
  const prisma = getPrismaClient();

  for (const row of rows) {
    try {
      const normalizedNumber = normalizePhoneNumber(row.number);
      const importHash = generateImportHash({ number: normalizedNumber, tenantId });

      // Check for duplicates
      const existing = await prisma.phoneNumber.findFirst({
        where: {
          OR: [{ tenantId, number: normalizedNumber }, { importHash }],
        },
      });

      if (existing) {
        stats.numbers.duplicates++;
        if (commit) {
          // Update existing number
          await prisma.phoneNumber.update({
            where: { id: existing.id },
            data: {
              campaignId: row.campaign_id || existing.campaignId,
              status: mapPhoneNumberStatus(row.status),
              importSource: 'legacy',
              importHash,
              metadata: {
                ...((existing.metadata || {}) as Record<string, unknown>),
                tags: row.tags?.split(',').map(t => t.trim()) || [],
                migratedAt: new Date().toISOString(),
              },
            },
          });
          stats.numbers.updated++;
        } else {
          stats.numbers.skipped++;
        }
        continue;
      }

      // Validate SignalWire if enabled
      if (validateSignalWire && signalWireAdapter) {
        const exists = await verifySignalWireNumber(signalWireAdapter, normalizedNumber);
        if (!exists) {
          stats.numbers.errors.push(`Number ${normalizedNumber} not found in SignalWire`);
          logger.warn({ msg: 'Number not found in SignalWire', number: normalizedNumber });
          continue;
        }
      }

      if (commit) {
        await prisma.phoneNumber.create({
          data: {
            tenantId,
            number: normalizedNumber,
            campaignId: row.campaign_id || null,
            provider: 'signalwire',
            status: mapPhoneNumberStatus(row.status),
            purchasedAt: row.purchase_date ? new Date(row.purchase_date) : new Date(),
            releasedAt: row.release_date ? new Date(row.release_date) : null,
            importSource: 'legacy',
            importHash,
            capabilities: { voice: true },
            metadata: {
              tags: row.tags?.split(',').map(t => t.trim()) || [],
              migratedAt: new Date().toISOString(),
            },
          },
        });
        stats.numbers.imported++;
      } else {
        stats.numbers.imported++;
      }
    } catch (error) {
      stats.numbers.errors.push(
        `Error importing ${row.number}: ${error instanceof Error ? error.message : String(error)}`
      );
      logger.error({ msg: 'Error importing number', row, error });
    }
  }
}

/**
 * Import campaigns
 */
async function importCampaigns(
  rows: CampaignRow[],
  tenantId: string,
  stats: ImportStats,
  commit: boolean
): Promise<Map<string, string>> {
  const prisma = getPrismaClient();
  const campaignMap = new Map<string, string>(); // external_id -> internal_id

  // Get or create a default publisher for migrated campaigns
  let defaultPublisher = await prisma.publisher.findFirst({
    where: { tenantId, code: 'MIGRATED' },
  });

  if (!defaultPublisher && commit) {
    defaultPublisher = await prisma.publisher.create({
      data: {
        tenantId,
        name: 'Migrated Campaigns',
        code: 'MIGRATED',
        status: 'ACTIVE',
        metadata: { migrated: true },
      },
    });
  }

  if (!defaultPublisher) {
    stats.campaigns.errors.push('Could not create default publisher');
    return campaignMap;
  }

  for (const row of rows) {
    try {
      const existing = await prisma.campaign.findFirst({
        where: {
          tenantId,
          metadata: {
            path: ['legacy_campaign_id'],
            equals: row.campaign_id,
          },
        },
      });

      if (existing) {
        campaignMap.set(row.campaign_id, existing.id);
        if (commit) {
          await prisma.campaign.update({
            where: { id: existing.id },
            data: {
              name: row.name,
              metadata: {
                ...((existing.metadata || {}) as Record<string, unknown>),
                legacy_campaign_id: row.campaign_id,
                description: row.description,
                migratedAt: new Date().toISOString(),
              },
            },
          });
          stats.campaigns.updated++;
        } else {
          stats.campaigns.skipped++;
        }
        continue;
      }

      if (commit) {
        const campaign = await prisma.campaign.create({
          data: {
            tenantId,
            publisherId: defaultPublisher.id,
            name: row.name,
            status: 'ACTIVE',
            metadata: {
              legacy_campaign_id: row.campaign_id,
              description: row.description,
              migratedAt: new Date().toISOString(),
            },
          },
        });
        campaignMap.set(row.campaign_id, campaign.id);
        stats.campaigns.imported++;
      } else {
        campaignMap.set(row.campaign_id, `mock-${row.campaign_id}`);
        stats.campaigns.imported++;
      }
    } catch (error) {
      stats.campaigns.errors.push(
        `Error importing campaign ${row.campaign_id}: ${error instanceof Error ? error.message : String(error)}`
      );
      logger.error({ msg: 'Error importing campaign', row, error });
    }
  }

  return campaignMap;
}

/**
 * Import calls
 */
async function importCalls(
  rows: CallRow[],
  tenantId: string,
  campaignMap: Map<string, string>,
  stats: ImportStats,
  commit: boolean
): Promise<Map<string, string>> {
  const prisma = getPrismaClient();
  const callMap = new Map<string, string>(); // external_id -> internal_id

  for (const row of rows) {
    try {
      const importHash = generateImportHash({
        call_id: row.call_id,
        tenantId,
        timestamp: row.timestamp,
      });

      // Check for duplicates - using externalId or importHash
      const existingByExternalId = await prisma.call.findFirst({
        where: { externalId: row.call_id },
      });
      const existingByHash = importHash
        ? await prisma.call.findFirst({
            where: { importHash },
          })
        : null;
      const existing = existingByExternalId || existingByHash;

      if (existing) {
        callMap.set(row.call_id, existing.id);
        stats.calls.duplicates++;
        if (commit) {
          await prisma.call.update({
            where: { id: existing.id },
            data: {
              campaignId: row.campaign_id ? campaignMap.get(row.campaign_id) || null : null,
              importHash,
              metadata: {
                ...((existing.metadata || {}) as Record<string, unknown>),
                migratedAt: new Date().toISOString(),
              },
            },
          });
          stats.calls.updated++;
        } else {
          stats.calls.skipped++;
        }
        continue;
      }

      const duration =
        typeof row.duration === 'string' ? parseInt(row.duration, 10) : row.duration || 0;
      const cost = typeof row.cost === 'string' ? parseFloat(row.cost) : row.cost || null;

      const timestamp = new Date(row.timestamp);
      const callSid = `CA${createHash('md5').update(`${row.call_id}-${tenantId}`).digest('hex').substring(0, 32)}`;

      if (commit) {
        const call = await prisma.call.create({
          data: {
            tenantId,
            campaignId: row.campaign_id ? campaignMap.get(row.campaign_id) || null : null,
            toNumber: normalizePhoneNumber(row.to),
            callSid,
            externalId: row.call_id,
            status: mapCallStatus(row.status),
            direction: mapCallDirection(row.direction),
            duration: duration > 0 ? duration : null,
            cost: cost !== null && cost > 0 ? cost : null,
            createdAt: timestamp,
            startedAt: timestamp,
            answeredAt: row.status.toLowerCase().includes('answered') ? timestamp : null,
            endedAt: duration > 0 ? new Date(timestamp.getTime() + duration * 1000) : null,
            importHash,
            metadata: {
              migratedAt: new Date().toISOString(),
              legacyCallId: row.call_id,
            },
          },
        });
        callMap.set(row.call_id, call.id);
        stats.calls.imported++;
      } else {
        callMap.set(row.call_id, `mock-${row.call_id}`);
        stats.calls.imported++;
      }
    } catch (error) {
      stats.calls.errors.push(
        `Error importing call ${row.call_id}: ${error instanceof Error ? error.message : String(error)}`
      );
      logger.error({ msg: 'Error importing call', row, error });
    }
  }

  return callMap;
}

/**
 * Import recordings
 */
async function importRecordings(
  rows: RecordingRow[],
  _tenantId: string,
  callMap: Map<string, string>,
  stats: ImportStats,
  commit: boolean
): Promise<void> {
  const prisma = getPrismaClient();

  for (const row of rows) {
    try {
      const callId = callMap.get(row.call_id);
      if (!callId) {
        stats.recordings.errors.push(`Call ${row.call_id} not found for recording`);
        continue;
      }

      // Validate URL is reachable
      const urlValid = await validateRecordingUrl(row.recording_url);
      if (!urlValid) {
        stats.recordings.unreachable++;
        stats.recordings.errors.push(`Recording URL unreachable: ${row.recording_url}`);
        continue;
      }

      const importHash = generateImportHash({
        call_id: row.call_id,
        url: row.recording_url,
      });

      // Check for duplicates
      const existing = importHash
        ? await prisma.recording.findFirst({
            where: { importHash },
          })
        : null;

      if (existing) {
        stats.recordings.skipped++;
        if (commit) {
          await prisma.recording.update({
            where: { id: existing.id },
            data: {
              importHash,
              metadata: {
                ...((existing.metadata || {}) as Record<string, unknown>),
                migratedAt: new Date().toISOString(),
              },
            },
          });
          stats.recordings.updated++;
        }
        continue;
      }

      const duration =
        typeof row.duration === 'string' ? parseInt(row.duration, 10) : row.duration || null;

      if (commit) {
        await prisma.recording.create({
          data: {
            callId,
            url: row.recording_url,
            duration,
            format: 'wav',
            status: 'COMPLETED',
            importHash,
            metadata: {
              migratedAt: new Date().toISOString(),
              legacyUrl: row.recording_url,
            },
          },
        });
        stats.recordings.imported++;
      } else {
        stats.recordings.imported++;
      }
    } catch (error) {
      stats.recordings.errors.push(
        `Error importing recording for call ${row.call_id}: ${error instanceof Error ? error.message : String(error)}`
      );
      logger.error({ msg: 'Error importing recording', row, error });
    }
  }
}

/**
 * Main migration function
 */
async function migrate(options: ImportOptions) {
  console.log(`\n🔄 Starting migration${options.commit ? ' (COMMIT MODE)' : ' (DRY RUN)'}\n`);

  const stats: ImportStats = {
    numbers: { total: 0, imported: 0, updated: 0, skipped: 0, duplicates: 0, errors: [] },
    campaigns: { total: 0, imported: 0, updated: 0, skipped: 0, errors: [] },
    calls: { total: 0, imported: 0, updated: 0, skipped: 0, duplicates: 0, errors: [] },
    recordings: { total: 0, imported: 0, updated: 0, skipped: 0, unreachable: 0, errors: [] },
  };

  // Load data
  console.log('📂 Loading data from:', options.input);
  const data = loadData(options.input);

  // Get tenant ID
  const prisma = getPrismaClient();
  let tenantId = options.tenantId;

  if (!tenantId) {
    // Try to get from first number row
    const numbers = data.get('numbers') as NumberRow[] | undefined;
    if (numbers && numbers.length > 0 && numbers[0].tenant_id) {
      tenantId = numbers[0].tenant_id;
    } else {
      // Use demo tenant or create default
      const demo = await prisma.tenant.findUnique({ where: { slug: 'demo' } });
      if (demo) {
        tenantId = demo.id;
      } else {
        throw new Error('Tenant ID required. Use --tenant-id or ensure data includes tenant_id');
      }
    }
  }

  console.log(`📋 Using tenant: ${tenantId}\n`);

  // Initialize SignalWire adapter if validation enabled
  let signalWireAdapter: SignalWireAdapter | undefined;
  if (options.validateSignalWire) {
    try {
      signalWireAdapter = new SignalWireAdapter();
      if (!signalWireAdapter.isConfigured()) {
        console.log('⚠️  SignalWire not configured, skipping validation\n');
        options.validateSignalWire = false;
      }
    } catch (error) {
      console.log(
        '⚠️  SignalWire validation disabled:',
        error instanceof Error ? error.message : String(error)
      );
      options.validateSignalWire = false;
    }
  }

  // Import campaigns first (needed for calls)
  let campaignMap = new Map<string, string>();
  if (data.has('campaigns')) {
    const campaigns = data.get('campaigns') as unknown as CampaignRow[];
    stats.campaigns.total = campaigns.length;
    console.log(`📢 Importing ${campaigns.length} campaigns...`);
    campaignMap = await importCampaigns(campaigns, tenantId, stats, options.commit);
    console.log(
      `   ✅ Imported: ${stats.campaigns.imported}, Updated: ${stats.campaigns.updated}, Skipped: ${stats.campaigns.skipped}`
    );
  }

  // Import numbers
  if (data.has('numbers')) {
    const numbers = data.get('numbers') as unknown as NumberRow[];
    stats.numbers.total = numbers.length;
    console.log(`\n📞 Importing ${numbers.length} phone numbers...`);
    await importNumbers(
      numbers,
      tenantId,
      stats,
      options.commit,
      options.validateSignalWire,
      signalWireAdapter
    );
    console.log(
      `   ✅ Imported: ${stats.numbers.imported}, Updated: ${stats.numbers.updated}, Skipped: ${stats.numbers.skipped}, Duplicates: ${stats.numbers.duplicates}`
    );
  }

  // Import calls
  let callMap = new Map<string, string>();
  if (data.has('calls')) {
    const calls = data.get('calls') as unknown as CallRow[];
    stats.calls.total = calls.length;
    console.log(`\n📞 Importing ${calls.length} calls...`);
    if (!campaignMap.size && data.has('campaigns')) {
      const campaigns = data.get('campaigns') as unknown as CampaignRow[];
      campaignMap = await importCampaigns(campaigns, tenantId, stats, options.commit);
    }
    callMap = await importCalls(calls, tenantId, campaignMap, stats, options.commit);
    console.log(
      `   ✅ Imported: ${stats.calls.imported}, Updated: ${stats.calls.updated}, Skipped: ${stats.calls.skipped}, Duplicates: ${stats.calls.duplicates}`
    );
  }

  // Import recordings
  if (data.has('recordings')) {
    const recordings = data.get('recordings') as unknown as RecordingRow[];
    stats.recordings.total = recordings.length;
    console.log(`\n🎙️  Importing ${recordings.length} recordings...`);
    if (!callMap.size) {
      if (!campaignMap.size && data.has('campaigns')) {
        const campaigns = data.get('campaigns') as unknown as CampaignRow[];
        campaignMap = await importCampaigns(campaigns, tenantId, stats, options.commit);
      }
      if (data.has('calls')) {
        const calls = data.get('calls') as unknown as CallRow[];
        callMap = await importCalls(calls, tenantId, campaignMap, stats, options.commit);
      }
    }
    await importRecordings(recordings, tenantId, callMap, stats, options.commit);
    console.log(
      `   ✅ Imported: ${stats.recordings.imported}, Updated: ${stats.recordings.updated}, Skipped: ${stats.recordings.skipped}, Unreachable: ${stats.recordings.unreachable}`
    );
  }

  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Summary');
  console.log('='.repeat(60));
  console.log(`\n📞 Phone Numbers:`);
  console.log(`   Total: ${stats.numbers.total}`);
  console.log(`   ✅ Ready to import: ${stats.numbers.imported}`);
  console.log(`   🔄 Would update: ${stats.numbers.updated}`);
  console.log(`   ⚠️  Duplicates skipped: ${stats.numbers.duplicates}`);
  console.log(`   ❌ Errors: ${stats.numbers.errors.length}`);

  console.log(`\n📢 Campaigns:`);
  console.log(`   Total: ${stats.campaigns.total}`);
  console.log(`   ✅ Ready to import: ${stats.campaigns.imported}`);
  console.log(`   🔄 Would update: ${stats.campaigns.updated}`);
  console.log(`   ❌ Errors: ${stats.campaigns.errors.length}`);

  console.log(`\n📞 Calls:`);
  console.log(`   Total: ${stats.calls.total}`);
  console.log(`   ✅ Ready to import: ${stats.calls.imported}`);
  console.log(`   🔄 Would update: ${stats.calls.updated}`);
  console.log(`   ⚠️  Duplicates skipped: ${stats.calls.duplicates}`);
  console.log(`   ❌ Errors: ${stats.calls.errors.length}`);

  console.log(`\n🎙️  Recordings:`);
  console.log(`   Total: ${stats.recordings.total}`);
  console.log(`   ✅ Ready to import: ${stats.recordings.imported}`);
  console.log(`   🔄 Would update: ${stats.recordings.updated}`);
  console.log(`   ⚠️  Unreachable URLs: ${stats.recordings.unreachable}`);
  console.log(`   ❌ Errors: ${stats.recordings.errors.length}`);

  if (
    stats.numbers.errors.length > 0 ||
    stats.campaigns.errors.length > 0 ||
    stats.calls.errors.length > 0 ||
    stats.recordings.errors.length > 0
  ) {
    console.log('\n❌ Errors:');
    [
      ...stats.numbers.errors,
      ...stats.campaigns.errors,
      ...stats.calls.errors,
      ...stats.recordings.errors,
    ].forEach(err => console.log(`   - ${err}`));
  }

  if (!options.commit) {
    console.log('\n💡 This was a DRY RUN. Use --commit to actually import data.');
  } else {
    console.log('\n✅ Migration completed!');
  }
  console.log('');
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: Partial<ImportOptions> = {
  commit: false,
  validateSignalWire: true,
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--input' && args[i + 1]) {
    options.input = args[i + 1];
    i++;
  } else if (arg === '--commit') {
    options.commit = true;
  } else if (arg === '--dry-run') {
    options.commit = false;
  } else if (arg === '--tenant-id' && args[i + 1]) {
    options.tenantId = args[i + 1];
    i++;
  } else if (arg === '--no-validate') {
    options.validateSignalWire = false;
  }
}

if (!options.input) {
  console.error(
    'Usage: tsx src/cli/migrate.ts --input <file-or-directory> [--commit] [--tenant-id <id>] [--no-validate]'
  );
  console.error('\nOptions:');
  console.error('  --input <path>        CSV or JSON file, or directory containing CSV/JSON files');
  console.error('  --commit              Actually import data (default: dry-run)');
  console.error('  --dry-run             Preview changes without importing (default)');
  console.error('  --tenant-id <id>      Tenant ID to import into (optional)');
  console.error('  --no-validate         Skip SignalWire number validation');
  process.exit(1);
}

migrate(options as ImportOptions)
  .then(() => {
    process.exit(0);
  })
  .catch(error => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  });
