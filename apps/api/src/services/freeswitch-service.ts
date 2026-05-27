import modesl from 'modesl';

import { logger } from '../lib/logger.js';

const ESL_HOST = process.env.FREESWITCH_HOST || 'freeswitch';
const ESL_PORT = parseInt(process.env.FREESWITCH_ESL_PORT || '8021', 10);
const ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon';

// Recording callback URL - FreeSWITCH will POST here when recording completes
const RECORDING_CALLBACK_URL =
  process.env.RECORDING_CALLBACK_URL ||
  `http://${process.env.PUBLIC_IP || 'localhost'}:3001/api/v1/recordings/uploaded`;

export class FreeSwitchService {
  /**
   * Execute a FreeSWITCH API command via ESL
   */
  async executeApi(command: string, args: string): Promise<string> {
    return new Promise((resolve, reject) => {
      try {
        const conn = new modesl.Connection(ESL_HOST, ESL_PORT, ESL_PASSWORD);
        conn.on('esl::ready', () => {
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

      let channels: { rows?: Array<{ uuid?: string }> };
      try {
        channels = JSON.parse(jsonOutput) as { rows?: Array<{ uuid?: string }> };
      } catch {
        logger.error({ msg: 'Failed to parse channels JSON', jsonOutput });
        return null;
      }

      // Navigate the JSON structure (rows array)
      const rows = channels.rows || [];

      // Iterate through active channels to find the one matching the SIP Call-ID
      const uuids: string[] = rows
        .map((r: { uuid?: string }) => r.uuid)
        .filter((u): u is string => typeof u === 'string');

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

  // ============================================================================
  // Call Recording Controls
  // ============================================================================

  /**
   * Start recording a call via FreeSWITCH uuid_record.
   *
   * Recording is ALWAYS initiated server-side by the media server.
   * The recording file is stored temporarily on the FS instance, then
   * the upload-on-complete hook pushes it to the API for S3 ingestion.
   *
   * @param callUuid - The FreeSWITCH channel UUID (or SIP Call-ID to resolve)
   * @param callId   - The Hopwhistle Call.id for naming the recording file
   * @returns true if recording started successfully
   */
  async startRecording(callUuid: string, callId: string): Promise<boolean> {
    try {
      // Build the recording file path.
      // FreeSWITCH records to /tmp/recordings/ (configured in freeswitch.xml)
      // The callId is used in the filename so the upload callback can map it back.
      const recordingPath = `/tmp/recordings/${callId}.wav`;

      logger.info({ msg: 'Starting call recording', callUuid, callId, recordingPath });

      // uuid_record <uuid> start <path> [<limit_seconds>]
      await this.executeApi('uuid_record', `${callUuid} start ${recordingPath}`);

      // Set channel variables for tracking
      await this.executeApi('uuid_setvar', `${callUuid} hopwhistle_call_id ${callId}`);
      await this.executeApi('uuid_setvar', `${callUuid} hopwhistle_recording_path ${recordingPath}`);

      // Register hangup hook to upload the recording file
      const uploadCmd = `system /usr/share/freeswitch/scripts/upload-recording.sh ${recordingPath} ${callId}`;
      await this.executeApi('uuid_setvar', `${callUuid} api_hangup_hook "${uploadCmd}"`);

      logger.info({ msg: 'Recording started successfully with hangup hook', callUuid, callId });
      return true;
    } catch (err) {
      logger.error({ msg: 'Failed to start recording', callUuid, callId, error: err });
      return false;
    }
  }

  /**
   * Stop recording a call via FreeSWITCH uuid_record stop.
   *
   * This is called automatically on hangup via the dialplan hangup_hook,
   * but can also be called explicitly for manual stop.
   *
   * @param callUuid - The FreeSWITCH channel UUID
   * @param callId   - The Hopwhistle Call.id
   */
  async stopRecording(callUuid: string, callId: string): Promise<void> {
    try {
      const recordingPath = `/tmp/recordings/${callId}.wav`;
      logger.info({ msg: 'Stopping call recording', callUuid, callId });

      // uuid_record <uuid> stop <path>
      await this.executeApi('uuid_record', `${callUuid} stop ${recordingPath}`);

      logger.info({ msg: 'Recording stopped', callUuid, callId });
    } catch (err) {
      // Non-fatal: recording may have already stopped (e.g., call ended)
      logger.warn({ msg: 'Could not stop recording (may already be stopped)', callUuid, callId, error: err });
    }
  }

  /**
   * Check if a channel is currently being recorded.
   */
  async isRecording(callUuid: string): Promise<boolean> {
    try {
      const result = await this.executeApi('uuid_getvar', `${callUuid} record_file_name`);
      return !!result && !result.startsWith('-ERR');
    } catch {
      return false;
    }
  }

  /**
   * Get the recording callback URL for FreeSWITCH to notify on completion.
   * This URL is used in the dialplan/hangup_hook to POST the recording file.
   */
  getRecordingCallbackUrl(): string {
    return RECORDING_CALLBACK_URL;
  }

  // ============================================================================
  // Call Merge (3-way calling)
  // ============================================================================

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
      logger.error({ msg: 'Could not resolve UUIDs', activeUuid, heldUuid });
      throw new Error('Could not find active calls in FreeSWITCH');
    }

    // Use the active UUID as the base for the conference name
    const conferenceName = `conf_${activeUuid}`;

    // 1. Transfer the HELD call's remote leg (B-leg) into the conference
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
