/**
 * The one rule that decides `CONTACTED`.
 *
 * Phase 6 of the round: each negative case is here because it is a case some
 * part of this repository has, at some point, counted as a contact.
 */

import { describe, expect, it } from 'vitest';

import {
  classifyContact,
  ContactEvidenceSource,
  ContactVerdict,
  mayWriteContacted,
  MIN_CONNECTED_MS,
  type ContactSignals,
} from '../contact-evidence.js';
import { AttemptOutcome, provesHumanContact } from '../lead-reservation.js';

function signals(overrides: Partial<ContactSignals> = {}): ContactSignals {
  return {
    source: ContactEvidenceSource.TELEPHONY_EVENTS,
    answered: false,
    bridgedToSecondLeg: false,
    connectedMs: 0,
    machineDetected: false,
    hangupCause: null,
    ...overrides,
  };
}

const CONTACT = signals({
  answered: true,
  bridgedToSecondLeg: true,
  connectedMs: MIN_CONNECTED_MS + 1,
});

describe('what is not contact', () => {
  it('a reservation is not contact', () => {
    // `autodialer.ts` writes CONTACTED before the command is even sent.
    expect(mayWriteContacted(classifyContact(signals()))).toBe(false);
  });

  it('ringing is not contact', () => {
    const result = classifyContact(signals({ answered: false }));
    expect(result.verdict).toBe(ContactVerdict.NOT_CONTACT);
  });

  it('no answer is not contact', () => {
    expect(
      classifyContact(signals({ hangupCause: 'NO_ANSWER' })).verdict
    ).toBe(ContactVerdict.NOT_CONTACT);
  });

  it('busy is not contact', () => {
    expect(classifyContact(signals({ hangupCause: 'USER_BUSY' })).verdict).toBe(
      ContactVerdict.NOT_CONTACT
    );
  });

  it('a technical rejection is not contact', () => {
    for (const cause of ['CALL_REJECTED', 'UNALLOCATED_NUMBER', 'NETWORK_OUT_OF_ORDER']) {
      expect(classifyContact(signals({ hangupCause: cause })).verdict).toBe(
        ContactVerdict.NOT_CONTACT
      );
    }
  });

  it('an answering machine is not contact', () => {
    expect(mayWriteContacted(classifyContact({ ...CONTACT, machineDetected: true }))).toBe(false);
  });

  it('an answer without a bridge is not enough', () => {
    // The most consequential branch. Voicemail, IVRs and carrier answer
    // supervision all produce a 200 OK.
    const result = classifyContact(signals({ answered: true, bridgedToSecondLeg: false }));
    expect(result.verdict).toBe(ContactVerdict.INSUFFICIENT_EVIDENCE);
    expect(mayWriteContacted(result)).toBe(false);
    expect(result.reason).toContain('voicemail');
  });

  it('a bridge too short to be a conversation is not enough', () => {
    const result = classifyContact({ ...CONTACT, connectedMs: MIN_CONNECTED_MS - 1 });
    expect(result.verdict).toBe(ContactVerdict.INSUFFICIENT_EVIDENCE);
    expect(mayWriteContacted(result)).toBe(false);
  });

  it('a machine beats an otherwise perfect contact', () => {
    // Ordering: detection is decisive even when everything else says contact.
    expect(classifyContact({ ...CONTACT, machineDetected: true }).verdict).toBe(
      ContactVerdict.NOT_CONTACT
    );
  });
});

describe('what is contact', () => {
  it('answered, bridged and held is contact', () => {
    const result = classifyContact(CONTACT);
    expect(result.verdict).toBe(ContactVerdict.HUMAN_CONTACT_PROVEN);
    expect(mayWriteContacted(result)).toBe(true);
  });

  it('exactly at the threshold is contact', () => {
    expect(
      classifyContact({ ...CONTACT, connectedMs: MIN_CONNECTED_MS }).verdict
    ).toBe(ContactVerdict.HUMAN_CONTACT_PROVEN);
  });

  it('NORMAL_CLEARING does not veto it', () => {
    // It is what a completed conversation and an instant hangup both report, so
    // it must prove nothing either way.
    expect(
      mayWriteContacted(classifyContact({ ...CONTACT, hangupCause: 'NORMAL_CLEARING' }))
    ).toBe(true);
  });

  it('an agent disposition may prove it', () => {
    expect(
      mayWriteContacted(
        classifyContact({ ...CONTACT, source: ContactEvidenceSource.AGENT_DISPOSITION })
      )
    ).toBe(true);
  });
});

describe('reconciliation cannot fabricate contact evidence', () => {
  it('is refused whatever it carries', () => {
    // Even handed a perfect signal set, after-the-fact reconciliation cannot
    // establish who was on the call — only that a channel existed and ended.
    const result = classifyContact({ ...CONTACT, source: ContactEvidenceSource.RECONCILIATION });
    expect(result.verdict).toBe(ContactVerdict.INSUFFICIENT_EVIDENCE);
    expect(mayWriteContacted(result)).toBe(false);
  });

  it('is refused before every other rule, so no branch can slip past it', () => {
    for (const overrides of [
      { machineDetected: true },
      { hangupCause: 'USER_BUSY' },
      { answered: false },
      { bridgedToSecondLeg: false },
      { connectedMs: 999_999 },
    ]) {
      const result = classifyContact({
        ...CONTACT,
        ...overrides,
        source: ContactEvidenceSource.RECONCILIATION,
      });
      expect(mayWriteContacted(result)).toBe(false);
      expect(result.reason).toContain('reconciliation cannot establish human contact');
    }
  });
});

describe('the rule agrees with the attempt outcome it feeds', () => {
  it('only ANSWERED_BY_HUMAN proves contact on the outcome side', () => {
    for (const outcome of Object.values(AttemptOutcome)) {
      expect(provesHumanContact(outcome)).toBe(outcome === AttemptOutcome.ANSWERED_BY_HUMAN);
    }
  });

  it('duplicate classification of the same signals is stable', () => {
    // Idempotence at the rule level: the same evidence twice is the same
    // verdict, so a redelivered event cannot rewrite a disposition.
    const first = classifyContact(CONTACT);
    const second = classifyContact(CONTACT);
    expect(second).toEqual(first);
  });
});
