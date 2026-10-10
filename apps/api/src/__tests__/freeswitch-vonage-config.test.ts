import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * The FreeSWITCH side of the Vonage integration, checked as files.
 *
 * There is no FreeSWITCH in CI, so these pin the configuration that a running
 * switch would load: the gateway, the variables it reads, the start-up script
 * that renders them, the dialplan wiring that selects a waterfall per call
 * type, and the inbound entry point a Vonage DID arrives at. The renderer is
 * executed for real, against a scratch copy of the config.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const FS = join(REPO_ROOT, 'apps', 'freeswitch');
const read = (...parts: string[]) => readFileSync(join(FS, ...parts), 'utf8');

describe('the vonage gateway', () => {
  const xml = read('conf', 'sip_profiles', 'external', 'vonage.xml');

  it('is a gateway named vonage, matching the catalog row', () => {
    expect(xml).toMatch(/<gateway name="vonage">/);
  });

  it('terminates without registering, presents caller ID in From, and pings', () => {
    expect(xml).toContain('<param name="register" value="false"/>');
    expect(xml).toContain('<param name="caller-id-in-from" value="true"/>');
    expect(xml).toMatch(/<param name="ping" value="\d+"\/>/);
  });

  it('takes every setting from vars.xml, never inline', () => {
    for (const [param, variable] of [
      ['proxy', 'vonage_sip_proxy'],
      ['realm', 'vonage_sip_realm'],
      ['username', 'vonage_sip_user'],
      ['password', 'vonage_sip_pass'],
    ]) {
      expect(xml).toContain(`<param name="${param}" value="$\${${variable}}"/>`);
    }
    const vars = read('conf', 'vars.xml');
    expect(vars).toContain('data="vonage_sip_proxy=${VONAGE_SIP_PROXY}"');
    expect(vars).toContain('data="vonage_sip_realm=${VONAGE_SIP_REALM}"');
    expect(vars).toContain('data="vonage_sip_user=${VONAGE_SIP_USERNAME}"');
    expect(vars).toContain('data="vonage_sip_pass=${VONAGE_SIP_PASSWORD}"');
  });

  it('is installed by the image and rendered at start-up', () => {
    const dockerfile = readFileSync(join(FS, 'Dockerfile'), 'utf8');
    expect(dockerfile).toContain('COPY apps/freeswitch/conf/sip_profiles/external/');
    expect(dockerfile).toContain('COPY apps/freeswitch/scripts/ /usr/share/freeswitch/scripts/');
    const entrypoint = read('docker-entrypoint.sh');
    expect(entrypoint).toContain('. /usr/share/freeswitch/scripts/vonage-gateway.sh');
    expect(entrypoint).toContain('configure_vonage_gateway');
  });
});

describe('rendering the Vonage trunk at start-up', () => {
  let dir: string;
  const SCRIPT = join(FS, 'scripts', 'vonage-gateway.sh');

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'vonage-gw-'));
    copyFileSync(join(FS, 'conf', 'vars.xml'), join(dir, 'vars.xml'));
    copyFileSync(
      join(FS, 'conf', 'sip_profiles', 'external', 'vonage.xml'),
      join(dir, 'vonage.xml')
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function render(env: Record<string, string>) {
    const result = spawnSync(
      'sh',
      ['-c', `. "${SCRIPT}"; configure_vonage_gateway "${dir}/vars.xml" "${dir}/vonage.xml"`],
      { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...env }, encoding: 'utf8' }
    );
    const vars = readFileSync(join(dir, 'vars.xml'), 'utf8');
    const value = (name: string) => new RegExp(`data="${name}=([^"]*)"`).exec(vars)?.[1];
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      proxy: value('vonage_sip_proxy'),
      realm: value('vonage_sip_realm'),
      user: value('vonage_sip_user'),
      pass: value('vonage_sip_pass'),
      loaded: existsSync(join(dir, 'vonage.xml')),
    };
  }

  it('defaults to the shared Vonage endpoint as an IP-authorised trunk', () => {
    const r = render({});
    expect(r).toMatchObject({
      status: 0,
      proxy: 'sip.nexmo.com',
      realm: 'sip.nexmo.com',
      user: '',
      pass: '',
      loaded: true,
    });
    expect(r.output).toContain('auth=ip-authorised');
  });

  it('uses a configured proxy, and a separate realm when given', () => {
    expect(render({ VONAGE_SIP_PROXY: 'sip-us.nexmo.com' })).toMatchObject({
      proxy: 'sip-us.nexmo.com',
      realm: 'sip-us.nexmo.com',
    });
    copyFileSync(join(FS, 'conf', 'vars.xml'), join(dir, 'vars.xml'));
    expect(
      render({ VONAGE_SIP_PROXY: 'sip-eu.nexmo.com', VONAGE_SIP_REALM: 'nexmo.com' })
    ).toMatchObject({
      realm: 'nexmo.com',
    });
  });

  it('renders a credential pair, escaped for sed and for XML, and never prints it', () => {
    const r = render({ VONAGE_SIP_USERNAME: 'abc123key', VONAGE_SIP_PASSWORD: 'p&ss|w"rd<x>\\y' });
    expect(r.user).toBe('abc123key');
    expect(r.pass).toBe('p&amp;ss|w&quot;rd&lt;x&gt;\\y');
    expect(r.output).toContain('auth=credentials');
    expect(r.output).not.toContain('abc123key');
    expect(r.output).not.toContain('p&ss');
    expect(r.loaded).toBe(true);
  });

  it.each([
    [{ VONAGE_SIP_USERNAME: 'abc123key' }, 'VONAGE_SIP_PASSWORD is not'],
    [{ VONAGE_SIP_PASSWORD: 's3cret-value' }, 'VONAGE_SIP_USERNAME is not'],
  ])('refuses half a credential pair, leaving the gateway unloaded (%o)', (env, message) => {
    const r = render(env);
    expect(r.status).toBe(0); // FreeSWITCH still starts; other carriers still dial.
    expect(r.output).toContain(message);
    expect(r.output).not.toContain('abc123key');
    expect(r.output).not.toContain('s3cret-value');
    expect(r.loaded).toBe(false);
    expect(r.user).toBe('');
    expect(r.pass).toBe('');
  });

  it('refuses a proxy that is not a host', () => {
    const r = render({ VONAGE_SIP_PROXY: 'sip:sip.nexmo.com' });
    expect(r.output).toContain('VONAGE_SIP_PROXY is not a host');
    expect(r.loaded).toBe(false);
  });

  it('restores the gateway once the environment is fixed', () => {
    render({ VONAGE_SIP_USERNAME: 'abc123key' });
    copyFileSync(join(FS, 'conf', 'vars.xml'), join(dir, 'vars.xml'));
    expect(render({}).loaded).toBe(true);
  });
});

describe('outbound dialplan wiring', () => {
  const dialplan = read('conf', 'dialplan', 'default.xml');

  it('reads the route type the browser sends as X-Hopwhistle-Route-Type', () => {
    expect(dialplan).toContain('hopwhistle_route_type=${sip_h_X-Hopwhistle-Route-Type}');
    expect(dialplan).toContain('hopwhistle_route_type=${sip_h_x-hopwhistle-route-type}');
  });

  it('asks the API for that call type, with the authenticated call id and a correlation id', () => {
    expect(dialplan).toMatch(
      /carrier-route\?type=\$\{hopwhistle_route_type\}&amp;dest=\$1&amp;cid=\$\{clean_caller_id\}.*&amp;call_id=\$\{hopwhistle_call_id\}&amp;corr=\$\{uuid\}/
    );
  });

  it('walks the waterfall leg by leg and reports a total failure', () => {
    expect(dialplan).toContain('<anti-action application="set" data="continue_on_fail=true"/>');
    expect(dialplan).toContain('<anti-action application="bridge" data="${carrier_bridge}"/>');
    expect(dialplan).toMatch(
      /carrier-result\?chain=\$\{url_encode\(\$\{carrier_bridge\}\)\}.*corr=\$\{uuid\}/
    );
  });

  it('records and uploads every outbound call regardless of carrier', () => {
    expect(dialplan).toContain(
      '<action application="record_session" data="/recordings/${hopwhistle_call_id}.wav"/>'
    );
    expect(dialplan).toContain(
      'api_hangup_hook=bg_system /usr/share/freeswitch/scripts/upload-recording.sh'
    );
    expect(dialplan).toContain('nolocal:dtmf_type=rfc2833');
  });

  it('routes the Dograh BYOC path through the DOGRAH_AI waterfall', () => {
    const dograh = read('conf', 'dialplan', 'vapi_outbound.xml');
    expect(dograh).toMatch(/carrier-route\?type=DOGRAH_AI&amp;.*corr=\$\{uuid\}/);
  });
});

describe('inbound entry point for a Vonage DID', () => {
  const publicXml = read('conf', 'dialplan', 'public.xml');
  const match =
    /<extension name="inbound-dynamic-route">\s*<condition field="destination_number" expression="([^"]+)">/.exec(
      publicXml
    );

  it('hands every NANP spelling of the called number to inbound_route.lua', () => {
    expect(match).not.toBeNull();
    const pattern = new RegExp(match![1]);
    for (const did of ['14155550100', '+14155550100', '4155550100']) {
      expect(pattern.test(did), did).toBe(true);
    }
    expect(publicXml).toContain('<action application="lua" data="inbound_route.lua"/>');
  });

  it('normalizes 10-digit, 11-digit and +1 forms the same way in the Lua', () => {
    const lua = read('scripts', 'inbound_route.lua');
    expect(lua).toContain('did_normalized = "+1" .. did_normalized');
    expect(lua).toContain('did_normalized = "+" .. did_normalized');
  });
});

describe('carrier_leg_result.lua', () => {
  const lua = read('scripts', 'carrier_leg_result.lua');

  it('reports to the carrier-result endpoint as one leg', () => {
    expect(lua).toContain('/api/v1/freeswitch/carrier-result?');
    expect(lua).toContain('{ "mode", "leg" }');
    // Answered legs report at answer (execute_on_answer passes "answer").
    expect(lua).toContain('argv[1] == "answer"');
    expect(lua).toContain('"bgapi"');
  });

  it('reads its own channel through env rather than ${} expansion', () => {
    expect(lua).toContain('env:getHeader("variable_" .. name)');
    expect(lua).not.toMatch(/"\$\{/);
  });

  it('never logs the internal key', () => {
    const logLines = lua.split('\n').filter(l => /log\(/.test(l));
    expect(logLines.some(l => /INTERNAL_KEY|url\b/.test(l))).toBe(false);
  });

  it('skips callee outcomes rather than posting them', () => {
    for (const cause of ['USER_BUSY', 'NO_ANSWER', 'ORIGINATOR_CANCEL']) {
      expect(lua).toContain(`cause == "${cause}"`);
    }
  });
});
