/**
 * Fronter Bot Service
 *
 * Handles outbound socket connections from FreeSWITCH when calls are answered.
 * Implements the "Cold Call" flow:
 *   1. Answer detected -> Play intro audio
 *   2. Wait for DTMF input
 *   3. Press 1 -> Transfer to agent/queue
 *   4. Press 9 or timeout -> Hangup, mark lead as NOT_INTERESTED
 */
import * as net from 'net';
import modesl from 'modesl';
const { Connection: ESLConnection } = modesl;

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';

const SOCKET_LISTEN_PORT = parseInt(process.env.FRONTER_SOCKET_PORT || '8021', 10);
const SOCKET_LISTEN_HOST = process.env.FRONTER_SOCKET_HOST || '0.0.0.0';
const DTMF_TIMEOUT_MS = parseInt(process.env.FRONTER_DTMF_TIMEOUT_MS || '10000', 10);
const DEFAULT_INTRO_AUDIO = process.env.FRONTER_INTRO_AUDIO || 'ivr/ivr-welcome.wav';
const TRANSFER_DESTINATION = process.env.FRONTER_TRANSFER_DEST || 'queue-default';

export class FronterBotService {
  private server: net.Server | null = null;
  private prisma = getPrismaClient();
  private isRunning = false;

  /**
   * Start the outbound socket server that FreeSWITCH will connect to.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn({ msg: 'FronterBotService already running' });
      return;
    }

    this.server = net.createServer(socket => {
      this.handleConnection(socket);
    });

    return new Promise((resolve, reject) => {
      this.server!.on('error', err => {
        logger.error({ msg: 'FronterBotService socket server error', error: err });
        reject(err);
      });

      this.server!.listen(SOCKET_LISTEN_PORT, SOCKET_LISTEN_HOST, () => {
        this.isRunning = true;
        logger.info({
          msg: 'FronterBotService socket server started',
          host: SOCKET_LISTEN_HOST,
          port: SOCKET_LISTEN_PORT,
        });
        resolve();
      });
    });
  }

  /**
   * Stop the socket server.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.server) {
      return new Promise(resolve => {
        this.server!.close(() => {
          logger.info({ msg: 'FronterBotService socket server stopped' });
          resolve();
        });
      });
    }
  }

  /**
   * Handle an incoming socket connection from FreeSWITCH.
   */
  private handleConnection(socket: net.Socket): void {
    logger.info({ msg: 'Incoming FreeSWITCH socket connection' });

    const conn = new ESLConnection(socket);

    conn.on('esl::ready', () => {
      this.handleCall(conn).catch(err => {
        logger.error({ msg: 'Error handling call', error: err });
        try {
          conn.execute('hangup', 'NORMAL_CLEARING');
        } catch {
          // Ignore
        }
      });
    });

    conn.on('error', (err: Error) => {
      logger.error({ msg: 'ESL connection error', error: err.message });
    });

    conn.on('esl::end', () => {
      logger.info({ msg: 'ESL connection ended' });
    });
  }

  /**
   * Main call handling logic - the "Fronter" flow.
   */
  private async handleCall(conn: ESLConnection): Promise<void> {
    // Get channel variables set during originate
    const leadId = await this.getChannelVar(conn, 'hopwhistle_lead_id');
    const campaignId = await this.getChannelVar(conn, 'hopwhistle_campaign_id');
    const tenantId = await this.getChannelVar(conn, 'hopwhistle_tenant_id');
    const callUUID = await this.getChannelVar(conn, 'Unique-ID');

    logger.info({
      msg: 'Handling call',
      leadId,
      campaignId,
      tenantId,
      callUUID,
    });

    // Update lead status to IN_CALL
    if (leadId) {
      await this.updateLeadStatus(leadId, 'IN_CALL');
    }

    try {
      // Step 1: Answer the call (if not already answered)
      await this.execute(conn, 'answer');

      // Small pause before playing audio
      await this.execute(conn, 'sleep', '500');

      // Step 2: Get intro audio from campaign or use default
      const introAudio = (await this.getCampaignIntroAudio(campaignId)) || DEFAULT_INTRO_AUDIO;

      // Play the intro audio
      logger.info({ msg: 'Playing intro audio', file: introAudio });
      await this.execute(conn, 'playback', introAudio);

      // Step 3: Wait for DTMF input
      logger.info({ msg: 'Waiting for DTMF', timeout: DTMF_TIMEOUT_MS });
      const dtmfDigit = await this.waitForDTMF(conn, DTMF_TIMEOUT_MS);

      logger.info({ msg: 'DTMF received', digit: dtmfDigit });

      // Step 4: Branch based on input
      if (dtmfDigit === '1') {
        // Transfer to agent/queue
        logger.info({ msg: 'Transferring call', destination: TRANSFER_DESTINATION });

        // Update lead status to TRANSFERRED
        if (leadId) {
          await this.updateLeadStatus(leadId, 'TRANSFERRED');
        }

        // Bridge to transfer destination
        await this.execute(conn, 'transfer', `${TRANSFER_DESTINATION} XML default`);
      } else {
        // Hangup - either '9' pressed or timeout (null) or other digit
        const reason =
          dtmfDigit === '9' ? 'NOT_INTERESTED' : dtmfDigit === null ? 'NO_RESPONSE' : 'OTHER';
        logger.info({ msg: 'Hanging up call', reason, digit: dtmfDigit });

        // Update lead status
        if (leadId) {
          await this.updateLeadStatus(leadId, reason);
        }

        await this.execute(conn, 'hangup', 'NORMAL_CLEARING');
      }
    } catch (error) {
      logger.error({ msg: 'Error in call flow', error });

      // Mark lead as FAILED
      if (leadId) {
        await this.updateLeadStatus(leadId, 'FAILED');
      }

      try {
        await this.execute(conn, 'hangup', 'NORMAL_CLEARING');
      } catch {
        // Ignore hangup errors
      }
    }
  }

  /**
   * Execute a FreeSWITCH application.
   */
  private execute(conn: ESLConnection, app: string, args = ''): Promise<void> {
    return new Promise((resolve, reject) => {
      conn.execute(app, args, (res: { body?: string }) => {
        if (res.body?.includes('-ERR')) {
          reject(new Error(`${app} failed: ${res.body}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Get a channel variable value.
   */
  private getChannelVar(conn: ESLConnection, varName: string): Promise<string | null> {
    return new Promise(resolve => {
      conn.api(
        'uuid_getvar',
        `${conn.getInfo()?.getHeader('Unique-ID')} ${varName}`,
        (res: { body?: string }) => {
          const value = res.body?.trim();
          if (value && !value.startsWith('-ERR')) {
            resolve(value);
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  /**
   * Wait for a DTMF digit with timeout.
   */
  private waitForDTMF(conn: ESLConnection, timeoutMs: number): Promise<string | null> {
    return new Promise(resolve => {
      let resolved = false;

      // Set up DTMF event listener
      const dtmfHandler = (event: { getHeader: (name: string) => string | undefined }) => {
        if (resolved) return;
        const digit = event.getHeader('DTMF-Digit');
        if (digit) {
          resolved = true;
          conn.removeListener('esl::event::DTMF::*', dtmfHandler);
          resolve(digit);
        }
      };

      conn.on('esl::event::DTMF::*', dtmfHandler);

      // Subscribe to DTMF events
      conn.subscribe('DTMF');

      // Timeout handler
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          conn.removeListener('esl::event::DTMF::*', dtmfHandler);
          resolve(null);
        }
      }, timeoutMs);
    });
  }

  /**
   * Get intro audio file from campaign configuration.
   */
  private async getCampaignIntroAudio(campaignId: string | null): Promise<string | null> {
    if (!campaignId) return null;

    try {
      const campaign = await this.prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { metadata: true },
      });

      // Look for introAudio in campaign metadata
      const metadata = campaign?.metadata as Record<string, unknown> | null;
      return (metadata?.introAudio as string) || null;
    } catch {
      return null;
    }
  }

  /**
   * Update lead status in database.
   */
  private async updateLeadStatus(leadId: string, status: string): Promise<void> {
    try {
      await this.prisma.lead.update({
        where: { id: leadId },
        data: { status },
      });
    } catch (error) {
      logger.error({ msg: 'Failed to update lead status', leadId, status, error });
    }
  }
}

// Singleton instance
export const fronterBotService = new FronterBotService();
