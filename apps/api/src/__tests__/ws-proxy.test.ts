import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:tls';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The /ws proxy, which fails in the one way nobody notices.
 *
 * A wrong /ws proxy does not take the platform down. Agents sign in, the
 * dashboard lists them as available, and their softphones never send a
 * REGISTER -- so every call routed to them dies with USER_NOT_REGISTERED while
 * every screen says the platform is healthy. That is why docs/DEPLOY.md checks
 * /ws before the softphone test, and why the checks below exist:
 *
 * 1. The committed agents.netenroll.com server block must proxy /ws exactly the
 *    way the hopwhistle one does. The two hosts share one FreeSWITCH.
 * 2. scripts/check-ws-proxy.mjs must actually fail on a bad handshake. A check
 *    that cannot fail is worse than no check, because the runbook trusts it.
 * 3. The softphone's derived WSS URL must land on the new host, and the
 *    NEXT_PUBLIC_SIP_WS_URL override must not be pinned to the old one.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const NEW_HOST = 'agents.netenroll.com';

const AGENTS_VHOST = join(REPO_ROOT, 'infra', 'nginx', NEW_HOST);
const HOPWHISTLE_VHOST = join(REPO_ROOT, 'infra', 'nginx', 'hopwhistle');
const CHECKER = join(REPO_ROOT, 'scripts', 'check-ws-proxy.mjs');

/**
 * Returns the directives inside every `location /ws` block in `config`,
 * normalised: comments dropped, whitespace collapsed. Comparing directives
 * rather than text lets the two files keep their own explanatory comments while
 * still proving the proxying itself is identical.
 */
function wsDirectives(config: string): string[][] {
  const blocks: string[][] = [];
  const lines = config.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*location\s+\/ws\s*\{/.test(lines[i])) continue;
    const directives: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].replace(/#.*$/, '').trim();
      if (line === '}') break;
      if (line) directives.push(line.replace(/\s+/g, ' '));
    }
    blocks.push(directives);
  }
  return blocks;
}

describe('the committed agents.netenroll.com /ws proxy', () => {
  const agents = readFileSync(AGENTS_VHOST, 'utf8');
  const hopwhistle = readFileSync(HOPWHISTLE_VHOST, 'utf8');

  it('exists exactly once in the TLS server block', () => {
    const blocks = wsDirectives(agents);
    expect(blocks, 'agents.netenroll.com must proxy /ws or no softphone registers').toHaveLength(1);
  });

  it('proxies to the FreeSWITCH ws binding on 127.0.0.1:8083', () => {
    expect(wsDirectives(agents)[0]).toContain('proxy_pass http://127.0.0.1:8083;');
  });

  it.each([
    [
      'proxy_set_header Upgrade $http_upgrade;',
      'nginx never performs the handshake; the socket 400s',
    ],
    [
      'proxy_set_header Connection "upgrade";',
      'nginx never performs the handshake; the socket 400s',
    ],
    [
      'proxy_set_header Sec-WebSocket-Protocol sip;',
      'FreeSWITCH drops the socket after the handshake',
    ],
  ])('sets %s', (directive, consequence) => {
    expect(wsDirectives(agents)[0], `missing it means: ${consequence}`).toContain(directive);
  });

  it('keeps `Host $host` as it is', () => {
    // Not `$proxy_host` and not a literal. The note in `location /` explains
    // what rewriting it breaks for Next.js server actions; here it is simply
    // what the hopwhistle block has always sent.
    expect(wsDirectives(agents)[0]).toContain('proxy_set_header Host $host;');
  });

  it('is directive-for-directive identical to the hopwhistle block', () => {
    // The two hosts share one FreeSWITCH, so a difference between them is a
    // difference in behaviour for the same backend -- and it would show up only
    // on whichever host the drifting block belongs to.
    const hopwhistleTls = wsDirectives(hopwhistle).at(-1);
    expect(wsDirectives(agents)[0]).toEqual(hopwhistleTls);
  });
});

describe('scripts/check-ws-proxy.mjs fails loudly', () => {
  /**
   * A self-signed cert for `localhost`, generated per-run rather than committed
   * so nothing in the repo ships a private key.
   */
  const certDir = mkdtempSync(join(tmpdir(), 'ws-proxy-'));
  const certPath = join(certDir, 'cert.pem');
  const keyPath = join(certDir, 'key.pem');

  /** How the fake upstream should answer the next handshake. */
  let respond: (key: string) => string;
  let server: Server;
  let port: number;

  const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
  const accept = (key: string) =>
    createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');

  /** A correct 101, as nginx+FreeSWITCH answer it. */
  const goodResponse = (key: string) =>
    [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: upgrade',
      `Sec-WebSocket-Accept: ${accept(key)}`,
      'Sec-WebSocket-Protocol: sip',
      '',
      '',
    ].join('\r\n');

  beforeAll(async () => {
    execFileSync(
      'openssl',
      // prettier-ignore
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
        '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost',
        '-keyout', keyPath, '-out', certPath,
      ],
      { stdio: 'ignore' }
    );

    server = createServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, socket => {
      socket.once('data', chunk => {
        const request = chunk.toString();
        const key = /sec-websocket-key:\s*(\S+)/i.exec(request)?.[1] ?? '';
        socket.end(respond(key));
      });
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as { port: number }).port;
  });

  afterAll(() => server?.close());

  /**
   * Runs the checker against the fake upstream and returns status + output.
   *
   * Asynchronous on purpose. execFileSync would block this worker's event loop,
   * and the fake server is listening on it -- the connection would never be
   * accepted and every case would fail as a timeout, whatever the server was
   * about to answer.
   */
  const execFileAsync = promisify(execFile);

  async function run(): Promise<{ status: number; output: string }> {
    try {
      const { stdout } = await execFileAsync(
        process.execPath,
        [CHECKER, `wss://localhost:${port}/ws`],
        {
          encoding: 'utf8',
          // Trust the throwaway cert for this process only.
          env: { ...process.env, NODE_EXTRA_CA_CERTS: certPath },
        }
      );
      return { status: 0, output: stdout };
    } catch (error) {
      const failure = error as { code?: number; stdout?: string; stderr?: string };
      return {
        status: failure.code ?? 1,
        output: `${failure.stdout ?? ''}${failure.stderr ?? ''}`,
      };
    }
  }

  it('exists and is executable by node', () => {
    expect(existsSync(CHECKER)).toBe(true);
  });

  it('passes on a correct handshake', async () => {
    respond = goodResponse;
    const result = await run();
    expect(result.output).toContain('ok');
    expect(result.status).toBe(0);
  });

  it('fails on a 400 — Upgrade/Connection not forwarded', async () => {
    respond = () => 'HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n';
    const result = await run();
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/Upgrade\/Connection/);
  });

  it('fails on a 200 of HTML — the request fell through to the web app', async () => {
    // The failure the runbook's old `curl | head -5` could not catch: five
    // plausible lines of output and an exit status of 0.
    respond = () =>
      'HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<!DOCTYPE html>';
    const result = await run();
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/fell through to the web app/);
  });

  it('fails on a 101 whose Sec-WebSocket-Accept does not match the key', async () => {
    respond = () =>
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: upgrade',
        'Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=',
        'Sec-WebSocket-Protocol: sip',
        '',
        '',
      ].join('\r\n');
    const result = await run();
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/Sec-WebSocket-Accept/);
  });

  it('fails on a 101 that did not negotiate `sip`', async () => {
    // The quietest failure of all: a healthy-looking 101 whose socket
    // FreeSWITCH closes immediately, leaving every agent shown as available.
    respond = (key: string) =>
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: upgrade',
        `Sec-WebSocket-Accept: ${accept(key)}`,
        '',
        '',
      ].join('\r\n');
    const result = await run();
    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/subprotocol/);
  });

  it('defaults to the new host when given no argument', () => {
    // The runbook runs it bare, so the default is the host actually checked at
    // cutover. Pinned by value: a default naming any other host would pass
    // against a server nobody is cutting over to.
    const source = readFileSync(CHECKER, 'utf8');
    expect(source).toContain(`const DEFAULT_TARGET = 'wss://${NEW_HOST}/ws';`);
  });
});

describe('the softphone signalling URL on the new host', () => {
  const phoneProvider = join(
    REPO_ROOT,
    'apps',
    'web',
    'src',
    'components',
    'phone',
    'phone-provider.tsx'
  );

  it('derives wss://<current host>/ws, so the new host yields the checked URL', () => {
    const source = readFileSync(phoneProvider, 'utf8');
    expect(source).toContain('const wsHost = window.location.hostname;');
    expect(source).toContain('sipWsUrl = `wss://${wsHost}/ws`;');
    // Which means: served from agents.netenroll.com the softphone dials
    // wss://agents.netenroll.com/ws -- exactly what check-ws-proxy.mjs probes.
  });

  it('is overridden only by NEXT_PUBLIC_SIP_WS_URL', () => {
    const source = readFileSync(phoneProvider, 'utf8');
    expect(source).toContain('if (process.env.NEXT_PUBLIC_SIP_WS_URL) {');
  });

  it('has no NEXT_PUBLIC_SIP_WS_URL pinned in any compose file or build arg', () => {
    // Next.js inlines NEXT_PUBLIC_* at build time, so an override set here
    // would silently outrank window.location.hostname in the shipped bundle and
    // send every softphone on the new host back to the old one.
    const dockerDir = join(REPO_ROOT, 'infra', 'docker');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (
          /\.(ya?ml|example|template|env)$/.test(entry) ||
          entry.startsWith('Dockerfile')
        ) {
          if (readFileSync(path, 'utf8').includes('NEXT_PUBLIC_SIP_WS_URL')) {
            offenders.push(relative(REPO_ROOT, path).split(sep).join('/'));
          }
        }
      }
    };
    walk(dockerDir);

    const webDockerfile = join(REPO_ROOT, 'apps', 'web', 'Dockerfile');
    if (readFileSync(webDockerfile, 'utf8').includes('NEXT_PUBLIC_SIP_WS_URL')) {
      offenders.push('apps/web/Dockerfile');
    }

    expect(
      offenders,
      `NEXT_PUBLIC_SIP_WS_URL is set in: ${offenders.join(', ')}. The softphone must ` +
        "derive its URL from the browser's hostname during the two-host transition, " +
        'so that each host reaches its own /ws.'
    ).toEqual([]);
  });
});
