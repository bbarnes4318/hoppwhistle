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
        try {
          const chanCallId = await this.executeApi('uuid_getvar', `${uuid} sip_call_id`);
          if (
            chanCallId && (
              chanCallId === sipCallId ||
              (chanCallId.length >= 10 && sipCallId.startsWith(chanCallId)) ||
              (sipCallId.length >= 10 && chanCallId.startsWith(sipCallId))
            )
          ) {
            return uuid;
          }
        } catch (err) {
          logger.warn({
            msg: 'Failed to check sip_call_id on active channel',
            uuid,
            error: err instanceof Error ? err.stack : String(err)
          });
        }
      }

      return null;
    } catch (err) {
      logger.error({
        msg: 'Error resolving UUID',
        error: err instanceof Error ? err.stack : String(err)
      });
      return null;
    }
  }

  async resolveUuidByCallId(callId: string): Promise<string | null> {
    try {
      const jsonOutput = await this.executeApi('show', 'channels as json');
      let channels: { rows?: Array<{ uuid?: string }> };
      try {
        channels = JSON.parse(jsonOutput) as { rows?: Array<{ uuid?: string }> };
      } catch {
        return null;
      }
      const uuids = (channels.rows || []).map(r => r.uuid).filter((u): u is string => !!u);
      for (const uuid of uuids) {
        try {
          const chanCallId = await this.executeApi('uuid_getvar', `${uuid} hopwhistle_call_id`);
          if (chanCallId === callId) {
            return uuid;
          }
        } catch (err) {
          logger.warn({
            msg: 'Failed to check hopwhistle_call_id on active channel',
            uuid,
            error: err instanceof Error ? err.stack : String(err)
          });
        }
      }
      return null;
    } catch (err) {
      logger.error({
        msg: 'Error resolving UUID by Call ID',
        error: err instanceof Error ? err.stack : String(err)
      });
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
      let realUuid: string | null = await this.resolveUuidByCallId(callId);
      if (!realUuid) {
        realUuid = await this.resolveUuid(callUuid);
      }
      if (!realUuid) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (uuidRegex.test(callUuid)) {
          realUuid = callUuid;
        }
      }

      if (!realUuid) {
        throw new Error(`Missing X-Hopwhistle-Call-Id on FreeSWITCH channel.`);
      }

      const recordingPath = `/recordings/${callId}.wav`;

      logger.info({ msg: 'Starting call recording', uuid: realUuid, callId, recordingPath });

      const isAlreadyRecording = await this.isRecording(realUuid);
      if (isAlreadyRecording) {
        logger.info({ msg: 'Channel is already recording', uuid: realUuid, callId });
        return true;
      }

      await this.executeApi('uuid_record', `${realUuid} start ${recordingPath}`);

      await this.executeApi('uuid_setvar', `${realUuid} hopwhistle_call_id ${callId}`);
      await this.executeApi('uuid_setvar', `${realUuid} hopwhistle_recording_path ${recordingPath}`);

      const uploadCmd = `bg_system /usr/share/freeswitch/scripts/upload-recording.sh ${recordingPath} ${callId}`;
      await this.executeApi('uuid_setvar', `${realUuid} api_hangup_hook "${uploadCmd}"`);

      logger.info({ msg: 'Recording started successfully with hangup hook', uuid: realUuid, callId });

      try {
        const { getPrismaClient } = await import('../lib/prisma.js');
        const prisma = getPrismaClient();
        const call = await prisma.call.findUnique({ where: { id: callId } });
        if (call) {
          const callMetadata = (call.metadata as any) || {};
          const existingRecordingDebug = callMetadata.recordingDebug || {};
          await prisma.call.update({
            where: { id: callId },
            data: {
              metadata: {
                ...callMetadata,
                recordingDebug: {
                  ...existingRecordingDebug,
                  freeswitchRecordingStartedAt: new Date().toISOString(),
                  freeswitchRecordingPath: recordingPath,
                }
              } as any
            }
          });
        }
      } catch (err) {
        logger.error({ msg: 'Failed to update call metadata in startRecording', error: err });
      }

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
      const recordingPath = `/recordings/${callId}.wav`;
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

    // Get all active channels for multi-strategy matching
    let channels: Array<Record<string, string>> = [];
    try {
      const jsonOutput = await this.executeApi('show', 'channels as json');
      const parsed = JSON.parse(jsonOutput) as { rows?: Array<Record<string, string>> };
      channels = parsed.rows || [];
      logger.info({ msg: 'Active FreeSWITCH channels for merge', count: channels.length, channels: channels.map(c => ({ uuid: c.uuid, name: c.name, cid_num: c.cid_num, dest: c.dest, call_uuid: c.call_uuid, callstate: c.callstate })) });
    } catch (err) {
      logger.error({ msg: 'Failed to list channels for merge', error: (err as Error).message });
    }

    // Multi-strategy UUID resolution
    const resolveMulti = async (id: string, label: string): Promise<string | null> => {
      // Strategy 1: sip_call_id match
      let uuid = await this.resolveUuid(id);
      if (uuid) {
        logger.info({ msg: `${label}: resolved via sip_call_id`, id, uuid });
        return uuid;
      }

      // Strategy 2: hopwhistle_call_id match
      uuid = await this.resolveUuidByCallId(id);
      if (uuid) {
        logger.info({ msg: `${label}: resolved via hopwhistle_call_id`, id, uuid });
        return uuid;
      }

      // Strategy 3: direct UUID — id itself is a FS UUID
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(id)) {
        const match = channels.find(c => c.uuid === id);
        if (match) {
          logger.info({ msg: `${label}: id is a direct FS UUID`, id });
          return id;
        }
      }

      // Strategy 4: match by call_uuid field (bridged partner UUID)
      const byCallUuid = channels.find(c => c.call_uuid === id);
      if (byCallUuid?.uuid) {
        logger.info({ msg: `${label}: resolved via call_uuid bridge partner`, id, uuid: byCallUuid.uuid });
        return byCallUuid.uuid;
      }

      // Strategy 5: match by name field (e.g. "sofia/internal/...")
      const byName = channels.find(c => c.name?.includes(id));
      if (byName?.uuid) {
        logger.info({ msg: `${label}: resolved via channel name`, id, uuid: byName.uuid });
        return byName.uuid;
      }

      logger.error({ msg: `${label}: could not resolve UUID`, id, availableUuids: channels.map(c => c.uuid) });
      return null;
    };

    const activeUuid = await resolveMulti(activeSipCallId, 'ACTIVE');
    const heldUuid = await resolveMulti(heldSipCallId, 'HELD');

    if (!activeUuid || !heldUuid) {
      logger.error({ msg: 'Could not resolve UUIDs for merge', activeUuid, heldUuid, activeSipCallId, heldSipCallId });
      throw new Error('Could not find active calls in FreeSWITCH');
    }

    // Use the held UUID as the base for the conference name (held call is guaranteed ACTIVE)
    const conferenceName = `conf_${heldUuid}`;

    // Find B-leg (peer) UUIDs from the channel list.
    // Handles both inbound (agent is child leg) and outbound (agent is parent leg) calls,
    // as well as conference-bridged legs.
    const findPeerLeg = (uuid: string): string | null => {
      const chan = channels.find(c => c.uuid === uuid);
      if (chan) {
        // Strategy 1: If in a conference, find the other member of the conference
        if (chan.dest && chan.dest.startsWith('conference:')) {
          const confPeer = channels.find(c => c.dest === chan.dest && c.uuid !== uuid);
          if (confPeer) {
            logger.info({ msg: 'findPeerLeg: resolved via shared conference destination', uuid, peer: confPeer.uuid, conference: chan.dest });
            return confPeer.uuid;
          }
        }

        // Strategy 2: If this channel is the child leg, its peer is the parent leg (whose uuid matches call_uuid)
        if (chan.call_uuid && chan.uuid !== chan.call_uuid) {
          const parentExists = channels.some(c => c.uuid === chan.call_uuid);
          if (parentExists) return chan.call_uuid;
        }
        
        // Strategy 3: If this channel is the parent leg, its peer is the child leg
        const child = channels.find(c => c.call_uuid === uuid && c.uuid !== uuid);
        if (child) return child.uuid;
      }
      
      // Fallback: search for child leg by call_uuid
      const child = channels.find(c => c.call_uuid === uuid && c.uuid !== uuid);
      return child?.uuid || null;
    };

    const heldBleg = findPeerLeg(heldUuid);
    const activeBleg = findPeerLeg(activeUuid);

    logger.info({
      msg: 'Merge: resolved all legs',
      activeAleg: activeUuid,
      activeBleg,
      heldAleg: heldUuid,
      heldBleg,
      conferenceName,
    });

    if (!heldBleg) {
      logger.error({ msg: 'Could not find B-leg for held call', heldUuid });
      throw new Error('Could not find remote party for held call');
    }

    // Prevent A-legs from hanging up when their bridges break
    for (const uuid of [activeUuid, heldUuid]) {
      try {
        await this.executeApi('uuid_setvar', `${uuid} hangup_after_bridge false`);
        await this.executeApi('uuid_setvar', `${uuid} park_after_bridge true`);
      } catch (err) {
        logger.warn({ msg: 'Failed to set bridge variables', uuid, error: err });
      }
    }

    // Ensure all channels are answered before transferring to conference
    for (const uuid of [heldBleg, activeBleg, activeUuid].filter(Boolean) as string[]) {
      try {
        await this.executeApi('uuid_answer', uuid);
      } catch (err) {
        logger.warn({ msg: 'Failed to answer channel before merge', uuid, error: err });
      }
    }

    // 1. Transfer the HELD B-leg (remote party) directly into the conference
    try {
      await this.executeApi('uuid_transfer', `${heldBleg} conference:${conferenceName} inline`);
      logger.info({ msg: 'Transferred held B-leg to conference', heldBleg });
    } catch (err) {
      logger.error({ msg: 'Failed to transfer held B-leg to conference', error: err });
      throw new Error('Failed to merge held call');
    }

    // 2. Kill the HELD A-leg (agent's first WebRTC session)
    //    We don't need it because the agent will communicate via the active A-leg.
    try {
      await this.executeApi('uuid_kill', heldUuid);
      logger.info({ msg: 'Killed held A-leg to prevent duplicate agent audio', heldUuid });
    } catch (err) {
      logger.warn({ msg: 'Failed to kill held A-leg', error: err });
    }

    // 3. If the active call has a B-leg (it's answered), transfer it into the conference too
    if (activeBleg) {
      try {
        await this.executeApi('uuid_transfer', `${activeBleg} conference:${conferenceName} inline`);
        logger.info({ msg: 'Transferred active B-leg to conference', activeBleg });
      } catch (err) {
        logger.warn({ msg: 'Failed to transfer active B-leg to conference', error: err });
      }
    }

    // 4. Transfer the ACTIVE A-leg (agent's second WebRTC session) into the conference
    try {
      await this.executeApi('uuid_transfer', `${activeUuid} conference:${conferenceName} inline`);
      logger.info({ msg: 'Transferred active A-leg to conference', activeUuid });
    } catch (err) {
      logger.error({ msg: 'Failed to transfer active A-leg to conference', error: err });
      throw new Error('Failed to join conference');
    }

    logger.info({ msg: 'Merge command sequence completed', conferenceName });
  }
}

export const freeswitchService = new FreeSwitchService();
