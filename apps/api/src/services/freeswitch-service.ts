import type { Prisma } from '@prisma/client';
import modesl from 'modesl';

import { logger } from '../lib/logger.js';

const ESL_HOST = process.env.FREESWITCH_HOST || 'freeswitch';
const ESL_PORT = parseInt(process.env.FREESWITCH_ESL_PORT || '8021', 10);
const ESL_PASSWORD = process.env.FREESWITCH_ESL_PASSWORD || 'ClueCon';

/**
 * Where FreeSWITCH POSTs a finished recording.
 *
 * The `localhost` fallback here was the same failure as the carrier ones: this
 * URL is handed to FreeSWITCH, which resolves it in *its own* container, so
 * `localhost:3001` is FreeSWITCH itself and never the API. Recordings would be
 * cut, uploaded to nowhere, and reported as fine.
 *
 * Resolved per call so an unset value fails recording setup rather than API
 * startup.
 */
function recordingCallbackUrl(): string {
  const explicit = process.env.RECORDING_CALLBACK_URL;
  if (explicit) return explicit;

  const publicIp = process.env.PUBLIC_IP;
  if (!publicIp) {
    throw new Error(
      'Neither RECORDING_CALLBACK_URL nor PUBLIC_IP is set — FreeSWITCH has no ' +
        'reachable address to upload recordings to.'
    );
  }

  return `http://${publicIp}:3001/api/v1/recordings/uploaded`;
}

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
          const callMetadata = (call.metadata as Prisma.JsonObject | null) || {};
          const existingRecordingDebug =
            (callMetadata.recordingDebug as Prisma.JsonObject | null | undefined) || {};
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
              },
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
    return recordingCallbackUrl();
  }

  // ============================================================================
  // Call Merge (3-way calling)
  // ============================================================================

  /**
   * Merge the agent's two softphone calls into one three-way conference.
   *
   * Before the merge the agent holds two WebRTC calls on FreeSWITCH, each a
   * bridge of two channels:
   *
   *   held   = agent leg A1 <-> customer   B1   (the original call, on hold)
   *   active = agent leg A2 <-> third party B2  (the call the agent just placed)
   *
   * After it, B1, B2 and A2 sit in one conference and A1 is gone. The order is
   * what keeps the customer on the line:
   *
   *   1. B1 is transferred into the conference on its own, and we wait until it
   *      is actually a member before touching A1. uuid_transfer returns once
   *      the transfer is queued, not done; waiting makes "the customer has left
   *      the bridge before their agent leg is hung up" a guarantee rather than
   *      a matter of timing.
   *   2. A1 is then hung up. The browser receives a BYE for the held session.
   *   3. A2 and B2 are moved together with `-both`, so neither leg of that
   *      bridge sees its partner vanish and hangs up.
   *
   * The active pair joins with the `mintwo` flag: once the room has had two
   * people in it, it ends when it drops below two. So the agent can drop out
   * and leave the customer talking to the third party, but nobody is ever left
   * alone in a conference after everyone else has gone.
   *
   * Channels are found ONLY by the exact SIP Call-ID of the agent's own
   * softphone legs. The previous version also matched a raw channel UUID, a
   * bridge partner's UUID, or any channel whose name *contained* the string it
   * was given -- which let a request name anyone's channel on the switch, from
   * any tenant, and pull it into a conference. A SIP Call-ID is only known to
   * the browser that owns the dialog.
   */
  async mergeCalls(
    activeSipCallId: string,
    heldSipCallId: string
  ): Promise<{ conferenceName: string }> {
    logger.info({ msg: 'Merging calls via FreeSWITCH', activeSipCallId, heldSipCallId });

    if (!activeSipCallId || !heldSipCallId || activeSipCallId === heldSipCallId) {
      throw new MergeCallsError('BAD_REQUEST', 'Two different calls are needed to merge');
    }

    const channels = await this.listChannels();

    const activeAgentLeg = await this.resolveUuid(activeSipCallId);
    const heldAgentLeg = await this.resolveUuid(heldSipCallId);

    if (!activeAgentLeg || !heldAgentLeg) {
      logger.error({
        msg: 'Merge: could not find the agent legs on FreeSWITCH',
        activeSipCallId,
        heldSipCallId,
        activeAgentLeg,
        heldAgentLeg,
      });
      throw new MergeCallsError(
        'CALL_NOT_FOUND',
        !heldAgentLeg
          ? 'The call on hold is no longer connected'
          : 'The new call is no longer connected'
      );
    }

    const customerLeg = findBridgePartner(channels, heldAgentLeg);
    const thirdPartyLeg = findBridgePartner(channels, activeAgentLeg);

    logger.info({
      msg: 'Merge: resolved legs',
      heldAgentLeg,
      customerLeg,
      activeAgentLeg,
      thirdPartyLeg,
    });

    if (!customerLeg) {
      throw new MergeCallsError('CALL_NOT_FOUND', 'The customer on hold has hung up');
    }
    if (!thirdPartyLeg || !isAnswered(channels, thirdPartyLeg)) {
      throw new MergeCallsError('NOT_ANSWERED', 'The person you are adding has not answered yet');
    }

    const conferenceName = `hw3way-${customerLeg}`;
    const destination = (flags?: string) =>
      `conference:${conferenceName}@${CONFERENCE_PROFILE}${flags ? `+flags{${flags}}` : ''}`;

    // 1. The customer goes first, alone, and must have arrived before we touch
    //    the agent leg it is bridged to.
    await this.executeApi('uuid_transfer', `${customerLeg} ${destination()} inline`);
    const joined = await this.waitForConferenceMember(conferenceName, customerLeg);
    if (!joined) {
      logger.error({
        msg: 'Merge: customer never joined the conference',
        customerLeg,
        conferenceName,
      });
      throw new MergeCallsError('MERGE_FAILED', 'The customer could not be moved into the call');
    }

    // 2. The held agent leg is now bridged to nothing. If FreeSWITCH has not
    //    already hung it up, do so; an error here means it already went.
    try {
      await this.executeApi('uuid_kill', heldAgentLeg);
    } catch (err) {
      logger.info({
        msg: 'Merge: held agent leg already gone',
        heldAgentLeg,
        error: (err as Error).message,
      });
    }

    // 3. Agent and third party, together.
    try {
      await this.executeApi(
        'uuid_transfer',
        `${activeAgentLeg} -both ${destination('mintwo|dist-dtmf')} inline`
      );
    } catch (err) {
      // Only reachable if the agent's new call vanished in the moment since we
      // looked it up. The customer is already in the room and their old agent
      // leg is gone, so there is nothing to put back: log it loudly.
      logger.error({
        msg: 'Merge: customer is in the conference but the agent and third party could not join',
        conferenceName,
        activeAgentLeg,
        thirdPartyLeg,
        error: (err as Error).message,
      });
      throw new MergeCallsError('MERGE_FAILED', 'Could not join the three-way call');
    }

    logger.info({ msg: 'Merge command sequence completed', conferenceName });
    return { conferenceName };
  }

  // ============================================================================
  // Supervisor listen-in
  // ============================================================================

  /**
   * The answered call an agent's softphone is on right now, as the UUID of
   * their own leg, or null when they are on none.
   *
   * Found on the switch rather than through the `calls` table, because an
   * inbound call has no row until its CDR lands after hangup -- the one moment
   * nobody wants to listen to it. The match is the agent busy check in
   * `inbound_route.lua` (`agent_channel_count`), which is what decides the same
   * question when routing.
   */
  async findAgentLiveLeg(extension: string): Promise<string | null> {
    const [channels, registrations] = await Promise.all([
      this.listChannels(),
      this.listRegistrations(),
    ]);
    return pickAgentLiveLeg(channels, extension, registrations);
  }

  /**
   * Ring `listenerExtension` and, when it answers, let it hear `targetUuid`'s
   * call: both the agent and the customer, listen-only.
   *
   * `eavesdrop_enable_dtmf=false` is what makes it listen-only. Left on, the
   * listener could press 2 or 3 to whisper to the agent or barge in on the
   * customer -- a different feature with different consent questions, and not
   * the one asked for.
   *
   * The leg carries `X-Hopwhistle-Monitor`, which the web softphone reads to
   * auto-answer it, mute the microphone, and keep it out of screen pop and
   * disposition: it is not a call the manager took.
   *
   * Returns the new leg's UUID. `bgapi` so the API does not hold a request open
   * while a phone rings; the caller has already established that the listener
   * is registered and the target is live.
   */
  async startListenIn(options: {
    listenerExtension: string;
    targetUuid: string;
    agentExtension: string;
    agentName: string;
  }): Promise<string> {
    const { listenerExtension, targetUuid, agentExtension, agentName } = options;
    if (!SAFE_TOKEN.test(listenerExtension) || !SAFE_TOKEN.test(agentExtension)) {
      throw new Error('Refusing to originate to an extension that is not a plain token');
    }
    if (!UUID_PATTERN.test(targetUuid)) {
      throw new Error('Refusing to eavesdrop on a channel id that is not a UUID');
    }

    const registrations = await this.listRegistrations();
    const domain = registrations.find(r => r.extension === listenerExtension)?.domain;
    if (!domain) throw new ListenInError('LISTENER_NOT_REGISTERED');

    let dialString = '';
    try {
      dialString = await this.executeApi(
        'sofia_contact',
        `internal/${listenerExtension}@${domain}`
      );
    } catch {
      dialString = '';
    }
    if (!dialString || dialString.startsWith('error')) {
      dialString = `user/${listenerExtension}@${domain}`;
    }

    const legUuid = (await this.executeApi('create_uuid', '')).trim();
    if (!UUID_PATTERN.test(legUuid)) throw new Error('FreeSWITCH did not return a UUID');

    const vars = [
      `origination_uuid=${legUuid}`,
      `origination_caller_id_name='${displayName(`Listening: ${agentName}`)}'`,
      `origination_caller_id_number=${agentExtension}`,
      `sip_h_X-Hopwhistle-Monitor=${targetUuid}`,
      'eavesdrop_enable_dtmf=false',
      'originate_timeout=30',
      "absolute_codec_string='PCMU,PCMA'",
    ].join(',');

    await this.executeApi('bgapi', `originate {${vars}}${dialString} &eavesdrop(${targetUuid})`);
    return legUuid;
  }

  /** Every registration on the internal profile: extension, domain and contact. */
  private async listRegistrations(): Promise<SipRegistration[]> {
    try {
      const body = await this.executeApi('sofia', `status profile ${INTERNAL_PROFILE} reg`);
      return parseRegistrations(body);
    } catch (err) {
      logger.warn({
        msg: 'Listen-in: could not read the registration table',
        error: (err as Error).message,
      });
      return [];
    }
  }

  private async listChannels(): Promise<FsChannel[]> {
    const jsonOutput = await this.executeApi('show', 'channels as json');
    try {
      const parsed = JSON.parse(jsonOutput) as { rows?: FsChannel[] };
      return parsed.rows || [];
    } catch {
      logger.error({ msg: 'Failed to parse channels JSON', jsonOutput });
      return [];
    }
  }

  /**
   * Poll until `uuid` is listed as a member of `conferenceName`.
   * `conference <name> list` prints one `;`-separated row per member, whose
   * third field is the member's channel UUID.
   */
  private async waitForConferenceMember(
    conferenceName: string,
    uuid: string,
    timeoutMs = MERGE_JOIN_TIMEOUT_MS
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const list = await this.executeApi('conference', `${conferenceName} list`);
        if (list.split('\n').some(row => row.split(';')[2] === uuid)) return true;
      } catch {
        // Not created yet -- the transfer is still in flight.
      }
      if (Date.now() >= deadline) return false;
      await new Promise(resolve => setTimeout(resolve, MERGE_POLL_INTERVAL_MS));
    }
  }
}

/** The conference profile in apps/freeswitch/conf/autoload_configs/conference.conf.xml. */
const CONFERENCE_PROFILE = 'hopwhistle-3way';
const MERGE_JOIN_TIMEOUT_MS = 5000;
const MERGE_POLL_INTERVAL_MS = 150;

export type FsChannel = Record<string, string | undefined>;

/** The sofia profile softphones register to. */
const INTERNAL_PROFILE = process.env.FREESWITCH_INTERNAL_PROFILE || 'internal';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_TOKEN = /^[A-Za-z0-9_.-]+$/;

/** Channel states a hanging-up leg passes through; mirrors CHANNEL_TEARDOWN_STATES. */
const TEARDOWN_STATES = new Set(['CS_HANGUP', 'CS_REPORTING', 'CS_DESTROY']);

/**
 * A caller-ID display name safe to put inside single quotes in an originate
 * string: no quotes, braces, commas or anything else FreeSWITCH would parse.
 */
function displayName(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9 .:_-]/g, '')
      .slice(0, 60)
      .trim() || 'Listening'
  );
}

export interface SipRegistration {
  extension: string;
  domain: string | null;
  /** `user@host[:port]` from the Contact URI, as it appears in channel names. */
  contactUserHost: string | null;
}

/**
 * The registrations in a `sofia status profile <p> reg` dump, one per block.
 * Each block opens with `Call-ID:`; `User:` names the extension and domain and
 * `Contact:` the URI FreeSWITCH dials, whose `user@host` is what an outbound
 * leg to that softphone is named after.
 */
export function parseRegistrations(body: string): SipRegistration[] {
  const out: SipRegistration[] = [];
  let current: SipRegistration | null = null;

  for (const line of body.split('\n')) {
    if (/^\s*Call-ID:/.test(line)) {
      if (current?.extension) out.push(current);
      current = { extension: '', domain: null, contactUserHost: null };
      continue;
    }
    if (!current) continue;
    const user = /^\s*User:\s*(\S+)/.exec(line);
    if (user) {
      const [ext, domain] = user[1].split('@');
      current.extension = ext.trim();
      current.domain = domain?.trim() || null;
      continue;
    }
    const contact = /^\s*Contact:.*?sips?:([^;>\s]+)/.exec(line);
    if (contact) current.contactUserHost = contact[1];
  }
  if (current?.extension) out.push(current);
  return out;
}

/**
 * The agent's own leg of the call they are on, from `show channels` rows.
 *
 * A channel is the agent's when it is named for their extension
 * (`sofia/internal/1001@...`), named for one of their registered contacts (the
 * leg FreeSWITCH originated to a WebRTC softphone carries the contact's random
 * user part, not the extension), or is an inbound leg from the softphone whose
 * caller-ID number is the extension. The same three tests as
 * `agent_channel_count` in inbound_route.lua.
 *
 * Only an answered call counts -- ACTIVE first, then HELD -- and of those the
 * newest, so an agent on two calls is listened to on the one they are talking
 * on.
 */
export function pickAgentLiveLeg(
  channels: FsChannel[],
  extension: string,
  registrations: SipRegistration[]
): string | null {
  const contactPrefixes = registrations
    .filter(r => r.extension === extension && r.contactUserHost)
    .map(r => `sofia/internal/${r.contactUserHost}`);
  const extPrefix = `sofia/internal/${extension}@`;

  const mine = channels.filter(c => {
    if (!c.uuid || TEARDOWN_STATES.has(c.state ?? '')) return false;
    if (c.callstate !== 'ACTIVE' && c.callstate !== 'HELD') return false;
    // A leg that is itself somebody listening in is not a call to listen to.
    if ((c.application ?? '') === 'eavesdrop') return false;
    const name = c.name ?? '';
    if (name.startsWith(extPrefix)) return true;
    if (contactPrefixes.some(prefix => name.startsWith(prefix))) return true;
    return (
      name.startsWith('sofia/internal/') && c.direction === 'inbound' && c.cid_num === extension
    );
  });

  mine.sort((a, b) => {
    const rank = (c: FsChannel) => (c.callstate === 'ACTIVE' ? 0 : 1);
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    return Number(b.created_epoch ?? 0) - Number(a.created_epoch ?? 0);
  });

  return mine[0]?.uuid ?? null;
}

export type ListenInErrorCode = 'LISTENER_NOT_REGISTERED';

export class ListenInError extends Error {
  constructor(readonly code: ListenInErrorCode) {
    super(code);
    this.name = 'ListenInError';
  }
}

export type MergeCallsErrorCode =
  | 'BAD_REQUEST'
  | 'CALL_NOT_FOUND'
  | 'NOT_ANSWERED'
  | 'MERGE_FAILED';

export class MergeCallsError extends Error {
  constructor(
    readonly code: MergeCallsErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'MergeCallsError';
  }
}

/**
 * The channel bridged to `uuid`. `show channels` reports a bridge on both legs:
 * the originating leg's `uuid` is the shared `call_uuid`, and the other leg
 * carries that same `call_uuid`. Covers both an outbound call (agent leg
 * originated it) and an inbound one (agent leg is the originated child).
 */
function findBridgePartner(channels: FsChannel[], uuid: string): string | null {
  const self = channels.find(c => c.uuid === uuid);
  if (!self) return null;
  const callUuid = self.call_uuid;
  if (!callUuid) return null;
  const partner = channels.find(
    c => c.uuid !== uuid && (c.uuid === callUuid || c.call_uuid === callUuid)
  );
  return partner?.uuid ?? null;
}

function isAnswered(channels: FsChannel[], uuid: string): boolean {
  const chan = channels.find(c => c.uuid === uuid);
  return chan?.callstate === 'ACTIVE' || chan?.callstate === 'HELD';
}

export const freeswitchService = new FreeSwitchService();
