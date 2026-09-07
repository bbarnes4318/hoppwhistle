/**
 * No code path may guess this host's public IP.
 *
 * Two places used to read `process.env.PUBLIC_IP || '3.214.60.13'`. That address
 * is the AWS host this platform ran on before the Hetzner migration, and the
 * fallback is worse than having no value:
 *
 *   - `vapi-carrier-service.ts` registered a Vapi BYO SIP trunk pointing at it,
 *     so inbound Vapi calls went to a machine we no longer run.
 *   - `signalwire-webhooks.ts` bridged live inbound callers to it — and a
 *     released elastic IP is reassigned to whichever AWS tenant asks next, so
 *     the calls did not fail, they went to a stranger.
 *
 * Neither failed loudly, because a default never does. The migration doc
 * (HETZNER_MIGRATION_FROM_AWS.md) names the old IP as decommissioned, which is
 * exactly the kind of fact a hard-coded fallback outlives.
 *
 * This test reads the shipped source rather than calling anything, because the
 * defect is textual and can reappear in any file: someone adding a third caller
 * that "just needs a sensible default" reintroduces it without touching either
 * function below.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { freeswitchHost } from '../services/vapi-carrier-service.js';

const SRC_DIR = join(__dirname, '..');

/** Hosts this platform has run on and no longer controls. */
const DECOMMISSIONED_HOSTS = ['3.214.60.13', '45.32.213.201'];

/**
 * Source with comments removed.
 *
 * The files below explain this history in prose, and that prose names the old
 * IP on purpose — a fallback removed without a record of why invites its own
 * reinstatement. What must not come back is the address used as a *value*, so
 * the scan reads code only.
 *
 * `//` is only treated as a comment when it is not preceded by `:`, so the
 * scheme in a `https://` literal does not swallow the rest of its line.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
      found.push(...sourceFiles(full));
      continue;
    }

    if (entry.name.endsWith('.ts')) found.push(full);
  }

  return found;
}

describe('PUBLIC_IP has no hard-coded fallback', () => {
  it('names no decommissioned host anywhere in apps/api/src', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC_DIR)) {
      const contents = stripComments(readFileSync(file, 'utf-8'));
      for (const host of DECOMMISSIONED_HOSTS) {
        if (contents.includes(host)) {
          offenders.push(`${file.replace(SRC_DIR, 'src')} → ${host}`);
        }
      }
    }

    expect(offenders, 'a decommissioned host is hard-coded in shipped source').toEqual([]);
  });
});

describe('freeswitchHost', () => {
  const original = process.env.PUBLIC_IP;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.PUBLIC_IP;
    } else {
      process.env.PUBLIC_IP = original;
    }
  });

  it('returns the configured public IP', () => {
    process.env.PUBLIC_IP = '178.156.223.97';
    expect(freeswitchHost()).toBe('178.156.223.97');
  });

  it('throws rather than guessing when PUBLIC_IP is unset', () => {
    // The whole point: pointing a carrier trunk at an address nobody chose is
    // not a degraded mode, it is a wrong answer that looks like a working one.
    delete process.env.PUBLIC_IP;
    expect(() => freeswitchHost()).toThrow(/PUBLIC_IP is not set/);
  });

  it('throws on an empty PUBLIC_IP, which is how an unset compose var arrives', () => {
    process.env.PUBLIC_IP = '';
    expect(() => freeswitchHost()).toThrow(/PUBLIC_IP is not set/);
  });
});
