import type { Prisma } from '@prisma/client';
import modesl from 'modesl';

import { logger } from '../lib/logger.js';

/** Narrow a Prisma Json column to a plain object so it can be safely spread. */
function asJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

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
            chanCallId &&
            (chanCallId === sipCallId ||
              (chanCallId.length >= 10 && sipCallId.startsWith(chanCallId)) ||
              (sipCallId.length >= 10 && chanCallId.startsWith(sipCallId)))
          ) {
            return uuid;
          }
        } catch (err) {
          logger.warn({
            msg: 'Failed to check sip_call_id on active channel',
            uuid,
            error: err instanceof Error ? err.stack : String(err),
          });
        }
      }

      return null;
    } catch (err) {
      logger.error({
        msg: 'Error resolving UUID',
        error: err instanceof Error ? err.stack : String(err),
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
            error: err instanceof Error ? err.stack : String(err),
          });
        }
      }
      return null;
    } catch (err) {
      logger.error({
        msg: 'Error resolving UUID by Call ID',
        error: err instanceof Error ? err.stack : String(err),
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
      await this.executeApi(
        'uuid_setvar',
        `${realUuid} hopwhistle_recording_path ${recordingPath}`
      );

      const uploadCmd = `bg_system /usr/share/freeswitch/scripts/upload-recording.sh ${recordingPath} ${callId}`;
      await this.executeApi('uuid_setvar', `${realUuid} api_hangup_hook "${uploadCmd}"`);

      logger.info({
        msg: 'Recording started successfully with hangup hook',
        uuid: realUuid,
        callId,
      });

      try {
        const { getPrismaClient } = await import('../lib/prisma.js');
        const prisma = getPrismaClient();
        const call = await prisma.call.findUnique({ where: { id: callId } });
        if (call) {
          const callMetadata = asJsonObject(call.metadata);
          const existingRecordingDebug = asJsonObject(callMetadata.recordingDebug);
          await prisma.call.update({
            where: { id: callId },
            data: {
              metadata: {
                ...callMetadata,
                recordingDebug: {
                  ...existingRecordingDebug,
                  freeswitchRecordingStartedAt: new Date().toISOString(),
                  freeswitchRecordingPath: recordingPath,
                },
              } as Prisma.InputJsonObject,
            },
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
      logger.warn({
        msg: 'Could not stop recording (may already be stopped)',
        callUuid,
        callId,
        error: err,
      });
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
      logger.info({
        msg: 'Active FreeSWITCH channels for merge',
        count: channels.length,
        channels: channels.map(c => ({
          uuid: c.uuid,
          name: c.name,
          cid_num: c.cid_num,
          dest: c.dest,
          call_uuid: c.call_uuid,
          callstate: c.callstate,
        })),
      });
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
        logger.info({
          msg: `${label}: resolved via call_uuid bridge partner`,
          id,
          uuid: byCallUuid.uuid,
        });
        return byCallUuid.uuid;
      }

      // Strategy 5: match by name field (e.g. "sofia/internal/...")
      const byName = channels.find(c => c.name?.includes(id));
      if (byName?.uuid) {
        logger.info({ msg: `${label}: resolved via channel name`, id, uuid: byName.uuid });
        return byName.uuid;
      }

      logger.error({
        msg: `${label}: could not resolve UUID`,
        id,
        availableUuids: channels.map(c => c.uuid),
      });
      return null;
    };

    const activeUuid = await resolveMulti(activeSipCallId, 'ACTIVE');
    const heldUuid = await resolveMulti(heldSipCallId, 'HELD');

    if (!activeUuid || !heldUuid) {
      logger.error({
        msg: 'Could not resolve UUIDs for merge',
        activeUuid,
        heldUuid,
        activeSipCallId,
        heldSipCallId,
      });
      throw new MergeError('MERGE_CALL_NOT_FOUND', 'Could not find both calls in FreeSWITCH.');
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
            logger.info({
              msg: 'findPeerLeg: resolved via shared conference destination',
              uuid,
              peer: confPeer.uuid,
              conference: chan.dest,
            });
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
      throw new MergeError(
        'MERGE_NO_REMOTE_PARTY',
        'Could not find the remote party for the held call.'
      );
    }

    if (!activeBleg) {
      logger.error({ msg: 'Could not find B-leg for active call', activeUuid });
      throw new MergeError(
        'MERGE_NO_REMOTE_PARTY',
        'Could not find the remote party for the active call.'
      );
    }

    // ------------------------------------------------------------------
    // Precondition: every leg must actually be answered.
    //
    // Merging a leg that is still in EARLY (ringing) state tears the call
    // down — uuid_transfer on an unanswered outbound leg hangs it up. Bail
    // out here, BEFORE we touch any channel, so a premature merge is a
    // no-op the caller can retry rather than a destroyed call.
    // ------------------------------------------------------------------
    const ANSWERED_STATES = new Set(['ACTIVE', 'HELD']);
    const legs: Array<{ uuid: string; label: string }> = [
      { uuid: activeUuid, label: 'active A-leg' },
      { uuid: activeBleg, label: 'active B-leg' },
      { uuid: heldUuid, label: 'held A-leg' },
      { uuid: heldBleg, label: 'held B-leg' },
    ];

    const unanswered = legs.filter(leg => {
      const chan = channels.find(c => c.uuid === leg.uuid);
      // If the channel is missing from the snapshot we let it through —
      // resolution already proved it exists, and the snapshot may be stale.
      return chan?.callstate ? !ANSWERED_STATES.has(chan.callstate) : false;
    });

    if (unanswered.length > 0) {
      logger.warn({
        msg: 'Merge rejected: not all legs are answered',
        unanswered: unanswered.map(l => ({
          ...l,
          callstate: channels.find(c => c.uuid === l.uuid)?.callstate,
        })),
      });
      throw new MergeError(
        'MERGE_NOT_ANSWERED',
        'Both calls must be answered before they can be merged.'
      );
    }

    // ------------------------------------------------------------------
    // Detach every leg from its bridge WITHOUT hanging it up.
    //
    // This must be applied to all four legs, not just the agent A-legs.
    // Transferring a B-leg into the conference breaks its bridge, and any
    // leg left with the default post-bridge behaviour hangs up on the spot
    // — which is what killed both calls previously.
    // ------------------------------------------------------------------
    for (const leg of legs) {
      try {
        await this.executeApi('uuid_setvar', `${leg.uuid} hangup_after_bridge false`);
        await this.executeApi('uuid_setvar', `${leg.uuid} park_after_bridge true`);
      } catch (err) {
        logger.warn({
          msg: 'Failed to set post-bridge variables',
          uuid: leg.uuid,
          label: leg.label,
          error: (err as Error).message,
        });
      }
    }

    // Transfer order matters: populate the conference with both remote
    // parties and the surviving agent leg first, and only tear down the
    // redundant agent leg once the conference is known to be up.
    const transferToConference = async (uuid: string, label: string): Promise<void> => {
      await this.executeApi('uuid_transfer', `${uuid} conference:${conferenceName} inline`);
      logger.info({ msg: 'Transferred leg to conference', uuid, label, conferenceName });
    };

    try {
      // 1. Both remote parties join the conference.
      await transferToConference(heldBleg, 'held B-leg');
      await transferToConference(activeBleg, 'active B-leg');

      // 2. The agent joins on the active A-leg (the session the browser
      //    keeps open and renders as the conference).
      await transferToConference(activeUuid, 'active A-leg');
    } catch (err) {
      logger.error({
        msg: 'Failed to build conference',
        conferenceName,
        error: (err as Error).message,
      });
      throw new MergeError('MERGE_FAILED', 'Failed to build the conference.');
    }

    // 3. Only now drop the held A-leg — the agent's first WebRTC session.
    //    Its remote party is already in the conference, and the agent is
    //    present via the active A-leg, so this leg is pure duplicate audio.
    try {
      await this.executeApi('uuid_kill', heldUuid);
      logger.info({ msg: 'Killed redundant held A-leg', heldUuid });
    } catch (err) {
      logger.warn({ msg: 'Failed to kill held A-leg', error: (err as Error).message });
    }

    // Confirm the conference actually came up rather than reporting success
    // on a sequence of commands that silently did nothing.
    try {
      const members = await this.executeApi('conference', `${conferenceName} list`);
      logger.info({ msg: 'Conference membership after merge', conferenceName, members });
    } catch (err) {
      logger.warn({
        msg: 'Could not read conference membership after merge',
        conferenceName,
        error: (err as Error).message,
      });
    }

    logger.info({ msg: 'Merge completed', conferenceName });
  }
}

/**
 * Merge failure with a machine-readable code so the API layer can tell the
 * softphone whether the merge is retryable (e.g. the call was still ringing)
 * or genuinely broken.
 */
export class MergeError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'MergeError';
  }
}

export const freeswitchService = new FreeSwitchService();
