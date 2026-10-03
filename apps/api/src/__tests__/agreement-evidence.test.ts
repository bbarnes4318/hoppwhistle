import type { AgreementEvent } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { clientIpFrom, isTrustedProxyAddress } from '../lib/client-ip.js';
import { redactSensitivePath } from '../lib/redact-path.js';
import { normaliseName, parseSignaturePng } from '../routes/agreements.js';
import { renderDocuments } from '../services/agreements/documents.js';
import { eventHash, GENESIS_HASH, verifyEvents } from '../services/agreements/events.js';
import {
  assertExecutedMatchesSent,
  renderExecutedHtml,
  stripFragments,
  stripMarkers,
} from '../services/agreements/executed.js';
import { canonicalJson, maskEmail } from '../services/agreements/format.js';
import type { FrozenTerms } from '../services/agreements/terms.js';
import {
  digestsEqual,
  hashOtp,
  hashToken,
  mintToken,
  newReference,
} from '../services/agreements/tokens.js';

import { testPng as png } from './helpers/png.js';

describe('client IP behind nginx', () => {
  it('believes X-Real-IP from a loopback socket', () => {
    expect(clientIpFrom('127.0.0.1', '203.0.113.9')).toBe('203.0.113.9');
    expect(clientIpFrom('::1', '203.0.113.9')).toBe('203.0.113.9');
    expect(clientIpFrom('::ffff:127.0.0.1', '203.0.113.9')).toBe('203.0.113.9');
  });

  it('believes X-Real-IP from a private or Docker-bridge socket, first value only', () => {
    expect(clientIpFrom('172.17.0.1', '198.51.100.4, 10.0.0.1')).toBe('198.51.100.4');
    expect(clientIpFrom('10.1.2.3', ['198.51.100.5'])).toBe('198.51.100.5');
    expect(clientIpFrom('192.168.1.1', '2001:db8::1')).toBe('2001:db8::1');
  });

  it('ignores the header from a public socket', () => {
    expect(clientIpFrom('203.0.113.50', '1.2.3.4')).toBe('203.0.113.50');
  });

  it('falls back to the socket on a garbage header', () => {
    expect(clientIpFrom('127.0.0.1', 'not-an-ip')).toBe('127.0.0.1');
    expect(clientIpFrom('127.0.0.1', '<script>')).toBe('127.0.0.1');
    expect(clientIpFrom('127.0.0.1', undefined)).toBe('127.0.0.1');
  });

  it('knows which sockets are ours', () => {
    expect(isTrustedProxyAddress('172.31.255.255')).toBe(true);
    expect(isTrustedProxyAddress('172.32.0.1')).toBe(false);
    expect(isTrustedProxyAddress('8.8.8.8')).toBe(false);
  });
});

describe('token redaction', () => {
  it('removes signing and download tokens from logged paths', () => {
    expect(redactSensitivePath('/api/v1/public/agreements/sign/abcDEF_123-x/documents')).toBe(
      '/api/v1/public/agreements/sign/[redacted]/documents'
    );
    expect(redactSensitivePath('/api/v1/public/agreements/download/tok/doc.pdf?x=1')).toBe(
      '/api/v1/public/agreements/download/[redacted]/doc.pdf?x=1'
    );
    expect(redactSensitivePath('/api/v1/platform/agreements/123')).toBe(
      '/api/v1/platform/agreements/123'
    );
  });
});

describe('tokens', () => {
  it('stores only a SHA-256 of a 32-byte token', () => {
    const { token, hash } = mintToken();
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toBe(hashToken(token));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('references avoid 0, O, 1 and I', () => {
    for (let i = 0; i < 200; i += 1) expect(newReference()).toMatch(/^NE-[A-HJ-NP-Z2-9]{8}$/);
  });

  it('binds a code hash to its envelope and compares in constant time', () => {
    expect(hashOtp('a', '123456')).not.toBe(hashOtp('b', '123456'));
    expect(digestsEqual(hashOtp('a', '123456'), hashOtp('a', '123456'))).toBe(true);
    expect(digestsEqual(hashOtp('a', '123456'), hashOtp('a', '123457'))).toBe(false);
  });

  it('masks the signer email', () => {
    expect(maskEmail('jimmy@netenroll.com')).toBe('j***@netenroll.com');
  });
});

describe('canonical JSON', () => {
  it('sorts keys recursively, no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}'
    );
  });
});

describe('the event chain', () => {
  function chain(n: number): AgreementEvent[] {
    const events: AgreementEvent[] = [];
    let prev = GENESIS_HASH;
    for (let seq = 1; seq <= n; seq += 1) {
      const row = {
        envelopeId: 'env-1',
        seq,
        type: 'LINK_OPENED' as const,
        occurredAt: new Date(Date.UTC(2026, 9, 3, 12, 0, seq)),
        actorType: 'SIGNER' as const,
        actorUserId: null,
        actorEmail: null,
        ipAddress: '203.0.113.9',
        userAgent: 'test',
        detail: { n: seq },
      };
      const hash = eventHash(prev, row);
      events.push({ id: `e${seq}`, ...row, prevHash: prev, hash } as AgreementEvent);
      prev = hash;
    }
    return events;
  }

  it('verifies an intact chain', () => {
    expect(verifyEvents(chain(10))).toMatchObject({ ok: true, count: 10 });
  });

  it('reports the first broken seq when a row is altered', () => {
    const events = chain(10);
    events[5] = { ...events[5], ipAddress: '198.51.100.1' };
    expect(verifyEvents(events)).toEqual({ ok: false, brokenSeq: 6, count: 10 });
  });

  it('reports a removed row', () => {
    const events = chain(10);
    events.splice(3, 1);
    expect(verifyEvents(events)).toMatchObject({ ok: false, brokenSeq: 5 });
  });
});

const TERMS: FrozenTerms = {
  agency: {
    legalName: 'Summit Ridge LLC',
    stateEntityType: 'Colorado / LLC',
    noticeAddress: '1 Main',
    principalName: 'Dana Whitfield',
    principalTitle: 'Member',
    noticeEmail: 'dana@x.test',
    noticePhone: '3035550142',
    billingEmail: 'dana@x.test',
    billingPhone: '3035550142',
  },
  effectiveDate: '2026-10-03',
  msaEffectiveDate: '2026-10-03',
  netenroll: { noticeAddress: '2800 N 6th Street', noticeEmail: 'support@pvnvoice.com' },
};

describe('executed document: the as-sent text plus signature fragments, nothing else', () => {
  const [msa] = renderDocuments(TERMS, ['MSA'], {
    mode: 'send',
    reference: 'NE-TEST2345',
    netenrollSignatoryName: 'James Kelly',
    netenrollSignatoryTitle: 'Managing Partner',
    netenrollSignedDate: '2026-10-03',
  });
  const signature = {
    method: 'TYPED' as const,
    typedName: 'Dana Whitfield',
    printedName: 'Dana Whitfield',
    title: 'Member',
    signedDate: '2026-10-04',
  };

  it('fills the markers and passes the equality check', () => {
    const executed = renderExecutedHtml(msa.html, signature);
    expect(executed).not.toContain('<!--SIG:');
    expect(stripFragments(executed)).toBe(stripMarkers(msa.html));
    expect(executed).toContain('Dana Whitfield');
    expect(executed).toContain('10/4/2026');
  });

  it('throws when a marker is missing', () => {
    const broken = msa.html.replace('<!--SIG:AGENCY_TITLE-->', '');
    expect(() => renderExecutedHtml(broken, signature)).toThrow(/AGENCY_TITLE/);
  });

  it('throws when the body was altered', () => {
    const executed = renderExecutedHtml(msa.html, signature);
    const altered = executed.replace('thirty (30) Business Days', 'sixty (60) Business Days');
    expect(() => assertExecutedMatchesSent(msa.html, altered)).toThrow(/does not match/);
  });

  it('throws when an extra marker is present', () => {
    const doubled = msa.html.replace('<!--SIG:AGENCY-->', '<!--SIG:AGENCY--><!--SIG:AGENCY-->');
    expect(() => renderExecutedHtml(doubled, signature)).toThrow(/exactly one/);
  });

  it('escapes a hostile typed name', () => {
    const executed = renderExecutedHtml(msa.html, {
      ...signature,
      typedName: '<img src=x onerror=1>',
    });
    expect(executed).not.toContain('<img src=x');
  });
});

describe('drawn signature validation', () => {
  it('accepts a PNG within 1200×400 as base64 or a data URI', () => {
    const ok = png(600, 200);
    expect(Buffer.isBuffer(parseSignaturePng(ok.toString('base64')))).toBe(true);
    expect(
      Buffer.isBuffer(parseSignaturePng(`data:image/png;base64,${ok.toString('base64')}`))
    ).toBe(true);
  });

  it('refuses oversize dimensions, non-PNG bytes and garbage', () => {
    expect(parseSignaturePng(png(1201, 100).toString('base64'))).toMatch(/1200 × 400/);
    expect(parseSignaturePng(png(100, 401).toString('base64'))).toMatch(/1200 × 400/);
    expect(
      parseSignaturePng(Buffer.from('GIF89a-not-a-png-at-all-padding-xx').toString('base64'))
    ).toMatch(/not a valid PNG/);
    expect(parseSignaturePng('!!!')).toMatch(/not a valid PNG/);
  });

  it('refuses more than 200 KB', () => {
    const big = Buffer.concat([png(10, 10), Buffer.alloc(210 * 1024)]);
    expect(parseSignaturePng(big.toString('base64'))).toMatch(/200 KB/);
  });
});

describe('typed name match', () => {
  it('ignores case and extra spaces', () => {
    expect(normaliseName('  dana   WHITFIELD ')).toBe(normaliseName('Dana Whitfield'));
    expect(normaliseName('Dana Whitfeld')).not.toBe(normaliseName('Dana Whitfield'));
  });
});
