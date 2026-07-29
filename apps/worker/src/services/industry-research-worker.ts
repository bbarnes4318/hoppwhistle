import { PrismaClient } from '@prisma/client';

import { logger } from '../lib/logger.js';

import { ResearchOrchestrator } from './industry-research/orchestrator.js';
import { getRedisClient } from './redis.js';

const GROUP = 'industry-research-group';
const CONSUMER = 'industry-research-worker';
const RUN_REQUESTED_EVENT = 'industry_research.run.requested';

interface RunRequestedEvent {
  event: string;
  tenantId: string;
  data: { runId?: string };
}

/**
 * Consumes `industry_research.run.requested` events from the shared Redis stream
 * and drives the multi-provider research pipeline to completion. Resumable and
 * idempotent: re-processing a run only executes stages that are still pending.
 */
export class IndustryResearchWorker {
  private isRunning = false;
  private prisma = new PrismaClient();
  private orchestrator = new ResearchOrchestrator(this.prisma);

  async start(): Promise<void> {
    const redis = getRedisClient();
    try {
      await redis.xgroup('CREATE', 'events:stream', GROUP, '0', 'MKSTREAM');
      logger.info({ msg: 'Created industry-research consumer group' });
    } catch (err: unknown) {
      if (err instanceof Error && !err.message.includes('BUSYGROUP')) {
        logger.warn({ msg: 'Failed to create industry-research consumer group', err });
      }
    }

    this.isRunning = true;
    logger.info({ msg: 'Industry Research Worker started' });
    void this.consume();
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    try {
      await this.prisma.$disconnect();
    } catch {
      // ignore
    }
  }

  private async consume(): Promise<void> {
    const redis = getRedisClient();
    while (this.isRunning) {
      let messages;
      try {
        messages = await redis.xreadgroup(
          'GROUP',
          GROUP,
          CONSUMER,
          'COUNT',
          '5',
          'BLOCK',
          '2000',
          'STREAMS',
          'events:stream',
          '>'
        );
      } catch (err) {
        logger.error({ msg: 'industry-research xreadgroup failed', err });
        await sleep(2000);
        continue;
      }

      if (!messages?.length) continue;
      const [, streamMessages] = messages[0] as [string, [string, string[]][]];

      for (const [messageId, fields] of streamMessages) {
        try {
          const fieldMap: Record<string, string> = {};
          for (let i = 0; i < fields.length; i += 2) fieldMap[fields[i]] = fields[i + 1];
          const payload = JSON.parse(fieldMap.payload || '{}') as RunRequestedEvent;

          if (payload.event !== RUN_REQUESTED_EVENT || !payload.data?.runId) {
            await redis.xack('events:stream', GROUP, messageId);
            continue;
          }

          logger.info({ msg: 'Processing research run', runId: payload.data.runId });
          await this.orchestrator.processRun(payload.data.runId);
        } catch (err) {
          logger.error({ msg: 'industry-research message failed', err });
        } finally {
          await redis.xack('events:stream', GROUP, messageId);
        }
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
