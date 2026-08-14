/**
 * The one rule that decides whether a lead becomes `CONTACTED`.
 *
 * ── Why one rule, in one place ───────────────────────────────────────────────
 *
 * Before this module the repository had three answers. `autodialer.ts` writes
 * `CONTACTED` before the originate command is sent, so a lead is contacted
 * whether it rings, is busy, is disconnected, or is never dialed at all.
 * `dialer-worker.ts` used to do the same and now routes through
 * `recordHumanContact`, which admits only `ANSWERED_BY_HUMAN`. And a reconciler
 * looking at a hangup record could plausibly have decided that a call which
 * connected was a contact. Three answers to a question that must have one,
 * because `CONTACTED` is the denominator of every conversion figure the business
 * reports and the trigger for downstream compliance timers.
 *
 * ── Why an answer is not enough ──────────────────────────────────────────────
 *
 * `CHANNEL_ANSWER` means a SIP 200 OK arrived. Voicemail sends one. An IVR sends
 * one. A carrier performing answer supervision on an unanswered call sends one.
 * A fax machine sends one. None of those is a person, and a system that counts
 * them as contact will report a contact rate several times its real one and will
 * start compliance clocks against people who were never reached.
 *
 * Contact therefore requires an answer AND evidence the call was joined to the
 * other party for long enough to be a conversation: a bridge to a second leg,
 * held past `MIN_CONNECTED_MS`. That is the strongest signal this repository's
 * event model actually carries — `NormalizedTelephonyEvent` has `answerState`,
 * `otherLegUuid` and event timestamps, and it does not have a voice-activity or
 * human-detection result. The rule is built from what exists, and where the
 * evidence is weaker than the claim, the verdict is `INSUFFICIENT_EVIDENCE`
 * rather than a guess in either direction.
 */

/** Where the signals came from. Determines whether a contact claim is admissible. */
export enum ContactEvidenceSource {
  /** Live telephony events observed on the attempt's channel. */
  TELEPHONY_EVENTS = 'TELEPHONY_EVENTS',
  /** An agent explicitly recorded the outcome in the console. */
  AGENT_DISPOSITION = 'AGENT_DISPOSITION',
  /**
   * After-the-fact reconciliation of an uncertain attempt.
   *
   * NEVER admissible. See `classifyContact`.
   */
  RECONCILIATION = 'RECONCILIATION',
}

export enum ContactVerdict {
  /** A human was reached. The only verdict that may write `CONTACTED`. */
  HUMAN_CONTACT_PROVEN = 'HUMAN_CONTACT_PROVEN',
  /** Positively not a contact — no answer, busy, machine, rejection. */
  NOT_CONTACT = 'NOT_CONTACT',
  /** Something happened, but not enough to claim a person was reached. */
  INSUFFICIENT_EVIDENCE = 'INSUFFICIENT_EVIDENCE',
}

/**
 * Below this, a bridge is a connection artefact rather than a conversation.
 *
 * A bridge that collapses in under three seconds is overwhelmingly an immediate
 * hangup, a failed agent leg, or answer supervision followed by a drop. Three
 * seconds is short enough that no real conversation is excluded and long enough
 * that the common artefacts are.
 */
export const MIN_CONNECTED_MS = 3_000;

export interface ContactSignals {
  source: ContactEvidenceSource;
  /** A CHANNEL_ANSWER was observed on the attempt's own channel. */
  answered: boolean;
  /** A CHANNEL_BRIDGE joined it to a second leg. */
  bridgedToSecondLeg: boolean;
  /** Measured bridge duration. Zero when never bridged. */
  connectedMs: number;
  /** Any machine/voicemail detection the platform produced. */
  machineDetected: boolean;
  /** FreeSWITCH hangup cause, when the channel ended. */
  hangupCause: string | null;
}

export interface ContactClassification {
  verdict: ContactVerdict;
  /** Sanitized. Names signals, never a phone number or a channel variable value. */
  reason: string;
}

/**
 * Hangup causes that positively rule out contact.
 *
 * A allowlist of the unambiguous ones only. `NORMAL_CLEARING` is absent on
 * purpose: it is what a completed conversation and an instant hangup both
 * report, so it proves nothing either way.
 */
const NON_CONTACT_CAUSES: readonly string[] = Object.freeze([
  'USER_BUSY',
  'NO_ANSWER',
  'NO_USER_RESPONSE',
  'CALL_REJECTED',
  'UNALLOCATED_NUMBER',
  'INVALID_NUMBER_FORMAT',
  'NORMAL_UNSPECIFIED',
  'DESTINATION_OUT_OF_ORDER',
  'NETWORK_OUT_OF_ORDER',
  'RECOVERY_ON_TIMER_EXPIRE',
  'ORIGINATOR_CANCEL',
  'NORMAL_TEMPORARY_FAILURE',
  'SUBSCRIBER_ABSENT',
]);

/**
 * Decide whether these signals prove a human was reached.
 *
 * Order:
 *   1. Reconciliation may never prove contact, whatever it carries.
 *   2. Machine detection is decisive against.
 *   3. A decisive hangup cause is decisive against.
 *   4. No answer is decisive against.
 *   5. An answer with no bridge is not enough.
 *   6. A bridge too short to be a conversation is not enough.
 *   7. Otherwise, contact.
 */
export function classifyContact(signals: ContactSignals): ContactClassification {
  if (signals.source === ContactEvidenceSource.RECONCILIATION) {
    // Reconciliation runs after the fact, from records that survived a crash. It
    // can establish that a channel existed and ended; it cannot establish who
    // was on it, and a system that let it try would manufacture contact evidence
    // for exactly the attempts nobody watched.
    return {
      verdict: ContactVerdict.INSUFFICIENT_EVIDENCE,
      reason: 'reconciliation cannot establish human contact; only live telephony events or an agent disposition can',
    };
  }

  if (signals.machineDetected) {
    return {
      verdict: ContactVerdict.NOT_CONTACT,
      reason: 'the platform detected an answering machine',
    };
  }

  if (signals.hangupCause && NON_CONTACT_CAUSES.includes(signals.hangupCause)) {
    return {
      verdict: ContactVerdict.NOT_CONTACT,
      reason: `hangup cause ${signals.hangupCause} rules out contact`,
    };
  }

  if (!signals.answered) {
    return {
      verdict: ContactVerdict.NOT_CONTACT,
      reason: 'the channel never answered',
    };
  }

  if (!signals.bridgedToSecondLeg) {
    // The single most consequential branch. An answer alone is what voicemail,
    // IVRs and answer supervision all produce.
    return {
      verdict: ContactVerdict.INSUFFICIENT_EVIDENCE,
      reason: 'the channel answered but was never bridged; an answer alone is also what voicemail and answer supervision produce',
    };
  }

  if (signals.connectedMs < MIN_CONNECTED_MS) {
    return {
      verdict: ContactVerdict.INSUFFICIENT_EVIDENCE,
      reason: `the bridge lasted under ${MIN_CONNECTED_MS} ms, which is a connection artefact rather than a conversation`,
    };
  }

  return {
    verdict: ContactVerdict.HUMAN_CONTACT_PROVEN,
    reason: `answered and bridged for ${signals.connectedMs} ms`,
  };
}

/** The only predicate any caller may use to justify writing `CONTACTED`. */
export function mayWriteContacted(classification: ContactClassification): boolean {
  return classification.verdict === ContactVerdict.HUMAN_CONTACT_PROVEN;
}
