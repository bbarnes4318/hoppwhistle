import modesl from 'modesl';

import { logger } from '../lib/logger.js';

const ESL_HOST = process.env.FREESWITCH_HOST || 'freeswitch';
const ESL_PORT = parseInt(process.env.FREESWITCH_ESL_PORT || '8021', 10);
const ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon';

export class FreeSwitchService {
  /**
   * Execute a FreeSWITCH API command via ESL
   */
  async executeApi(command: string, args: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const conn = new modesl.Connection(ESL_HOST, ESL_PORT, ESL_PASSWORD, () => {
          conn.api(command, args, (res: { body?: string }) => {
            conn.disconnect();
            const body = res.body || '';
            if (body.startsWith('-ERR')) {
              reject(new Error(`FreeSWITCH command failed: ${body}`));
            } else {
              resolve(body.trim());
            }
          });
        });

        conn.on('error', (err: Error) => {
          logger.error({ msg: 'FreeSWITCH ESL connection error', error: err.message });
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Resolve FreeSWITCH UUID from SIP Call-ID
   * This is necessary because uuid_transfer requires the internal FS UUID
   */
  async resolveUuid(sipCallId: string): Promise<string | null> {
    try {
      // Get all active channels in JSON format
      const jsonOutput = await this.executeApi('show', 'channels as json');

      let channels;
      try {
        channels = JSON.parse(jsonOutput);
      } catch {
        logger.error({ msg: 'Failed to parse channels JSON', jsonOutput });
        return null;
      }

      // Navigate the JSON structure (rows array)
      const rows = channels.rows || [];

      // Find the row where sip_call_id matches (or call_uuid if they happen to match)
      // Note: sip_call_id is typically a variable, but show channels exposes it?
      // Actually, 'show channels' gives 'uuid', 'cid_num', 'dest', etc.
      // It might NOT give sip_call_id in the default view.
      // However, we can filter by the user's presence or other metadata if needed.
      // BETTER APPROACH: 'show channels' output typically includes 'call_uuid'.
      // If we cannot find it, we might need 'uuid_find' if available, but it's not standard.

      // Let's try to match on something we know.
      // If sipCallId == uuid (unlikely), we are good.
      // But sip.js generates a random string.

      // Search logic: check specific variables if possible?
      // Since we can't efficiently query by variable, we'll iterate and check.
      // This is O(N) but N (active channels) is usually small.

      for (const row of rows) {
        // Check if this row seems to be ours
        // We'll trust the caller to provide a valid SIP Call-ID
        // We can check 'cid_num' or 'dest' if we had it, but we only have callId.
        // Critical: 'show channels' MIGHT NOT include sip_call_id.
        // We might need to inspect variables for each channel? That's too slow (N api calls).
        // Let's assume for a moment that we can match on 'uuid' if we are lucky,
        // OR that we need a better way.
        // Alternative: The frontend can send the Call-ID.
        // In FreeSWITCH, the variable 'sip_call_id' holds this value.
        // There is no direct reverse lookup.
      }

      // Hack: Use 'eval' to find the uuid?
      // 'eval ${uuid_dump <uuid>}' -- no.

      // REVISIT: For 3-way calling, we need the UUIDs.
      // If we cannot reliably find them, this fails.

      // Workaround: We will iterate all channels and check their 'sip_call_id' variable
      // IF there are few channels (<100), this is acceptable using 'uuid_getvar' in parallel?
      // Or 'show channels' detailed view?

      // Let's try to pass the Call-ID as a filter? No.

      // Let's implement the slow but sure way:
      // 1. Get all UUIDs.
      // 2. Fetch 'sip_call_id' for each.
      // 3. Match.

      const uuids = rows.map((r: any) => r.uuid);

      for (const uuid of uuids) {
        const chanCallId = await this.executeApi('uuid_getvar', `${uuid} sip_call_id`);
        if (chanCallId === sipCallId) {
          return uuid;
        }
      }

      return null;
    } catch (err) {
      logger.error({ msg: 'Error resolving UUID', error: err });
      return null;
    }
  }

  /**
   * Merge two calls into a conference
   * Supports the 3-Way Calling flow by bridging two agent sessions
   */
  async mergeCalls(activeSipCallId: string, heldSipCallId: string): Promise<void> {
    logger.info({ msg: 'Merging calls via FreeSWITCH', activeSipCallId, heldSipCallId });

    // Resolve SIP Call-IDs to FreeSWITCH UUIDs
    const activeUuid = await this.resolveUuid(activeSipCallId);
    const heldUuid = await this.resolveUuid(heldSipCallId);

    if (!activeUuid || !heldUuid) {
      // Note: checking unique matches
      logger.error({ msg: 'Could not resolve UUIDs', activeUuid, heldUuid });
      throw new Error('Could not find active calls in FreeSWITCH');
    }

    // Use the active UUID as the base for the conference name
    const conferenceName = `conf_${activeUuid}`;

    // 1. Transfer the HELD call's remote leg (B-leg) into the conference
    // We target the heldUuid directly with -bleg
    try {
      await this.executeApi(
        'uuid_transfer',
        `${heldUuid} -bleg conference:${conferenceName} inline`
      );
    } catch (err) {
      logger.error({ msg: 'Failed to transfer held call to conference', error: err });
      throw new Error('Failed to merge held call');
    }

    // 2. Transfer the ACTIVE call's remote leg (B-leg) into the conference
    try {
      await this.executeApi(
        'uuid_transfer',
        `${activeUuid} -bleg conference:${conferenceName} inline`
      );
    } catch (err) {
      logger.error({ msg: 'Failed to transfer active call remote leg to conference', error: err });
    }

    // 3. Transfer the AGENT (Active call A-leg) into the conference
    try {
      await this.executeApi('uuid_transfer', `${activeUuid} conference:${conferenceName} inline`);
    } catch (err) {
      logger.error({ msg: 'Failed to transfer agent to conference', error: err });
      throw new Error('Failed to join conference');
    }

    // 4. Hangup the HELD agent leg (A-leg)
    try {
      await this.executeApi('uuid_kill', heldUuid);
    } catch (err) {
      logger.warn({ msg: 'Failed to kill held agent leg', error: err });
    }

    logger.info({ msg: 'Merge command sequence completed' });
  }
}

export const freeswitchService = new FreeSwitchService();
