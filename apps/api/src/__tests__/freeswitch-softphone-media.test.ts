import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Browsers reach the internal profile through nginx, so FreeSWITCH sees the
 * Docker gateway as their address. If that counts as "local network", the SDP
 * offers the container IP instead of ext-rtp-ip, no browser can send audio to
 * it, and every softphone call is silent in both directions.
 */
const CONF = join(__dirname, '..', '..', '..', 'freeswitch', 'conf');

describe('the softphone profile advertises the public media address', () => {
  const internal = readFileSync(join(CONF, 'sip_profiles', 'internal.xml'), 'utf8');
  const acl = readFileSync(join(CONF, 'autoload_configs', 'acl.conf.xml'), 'utf8');

  it('treats only loopback as the local network', () => {
    const value = /<param name="local-network-acl" value="([^"]+)"\s*\/>/.exec(internal)?.[1];
    expect(value).toBe('loopback_only');
  });

  it('defines that list as loopback and nothing else', () => {
    const list = /<list name="loopback_only" default="deny">([\s\S]*?)<\/list>/.exec(acl)?.[1] ?? '';
    const allowed = [...list.matchAll(/cidr="([^"]+)"/g)].map(m => m[1]);
    expect(allowed).toEqual(['127.0.0.0/8']);
  });
});
