#!/usr/bin/env node
/**
 * Performs a real WebSocket handshake against the /ws proxy and fails loudly.
 *
 * Why this exists as a script rather than a curl one-liner.
 *
 * The runbook used to check /ws with `curl -i -N ... | head -5` and ask the
 * operator to read the output. That check cannot fail: curl exits 0 on a 400,
 * on a 200 of the web app's HTML, and on a 101 that is missing the subprotocol
 * -- and `head` closing the pipe masks curl's status anyway. The one failure it
 * is meant to catch is the one nobody notices, because the wrong answer still
 * prints five plausible-looking lines.
 *
 * That matters more here than for a normal endpoint. A broken /ws proxy does
 * not take the app down. Agents sign in, the dashboard lists them as available,
 * and their softphones simply never send a REGISTER -- so every call routed to
 * them dies with USER_NOT_REGISTERED while every screen says the platform is
 * healthy. This is why the runbook checks /ws BEFORE the softphone test.
 *
 * So the handshake is done properly and the exit status is the answer:
 *
 *   node scripts/check-ws-proxy.mjs
 *   node scripts/check-ws-proxy.mjs wss://agents.netenroll.com/ws
 *
 * Exit 0 only when all five conditions hold. Any other outcome exits 1 with a
 * line naming which one failed and what it usually means.
 */

import { createHash, randomBytes } from 'node:crypto';
import { connect } from 'node:tls';

/** RFC 6455 section 1.3. The server appends this to the key and SHA-1s it. */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const DEFAULT_TARGET = 'wss://agents.netenroll.com/ws';

/** FreeSWITCH drops a socket that did not negotiate this subprotocol. */
const REQUIRED_SUBPROTOCOL = 'sip';

const TIMEOUT_MS = Number(process.env.WS_CHECK_TIMEOUT_MS || '10000');

/** `wss://host/ws` and `https://host/ws` both mean the same thing here. */
function parseTarget(raw) {
  const url = new URL(raw);
  if (!['wss:', 'https:'].includes(url.protocol)) {
    throw new Error(`${raw}: expected a wss:// or https:// URL, got ${url.protocol}//`);
  }
  return {
    host: url.hostname,
    port: Number(url.port || 443),
    path: url.pathname || '/',
  };
}

/** Sends the upgrade request over TLS and resolves with the raw response head. */
function handshake({ host, port, path }, key) {
  return new Promise((resolve, reject) => {
    // servername sets SNI: without it a host sharing an IP with other vhosts is
    // served the wrong certificate and the wrong server block.
    const socket = connect({ host, port, servername: host }, () => {
      socket.write(
        [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}`,
          'Connection: Upgrade',
          'Upgrade: websocket',
          'Sec-WebSocket-Version: 13',
          `Sec-WebSocket-Key: ${key}`,
          `Sec-WebSocket-Protocol: ${REQUIRED_SUBPROTOCOL}`,
          '',
          '',
        ].join('\r\n')
      );
    });

    socket.setTimeout(TIMEOUT_MS, () => {
      socket.destroy();
      reject(new Error(`no response within ${TIMEOUT_MS}ms`));
    });

    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1');
      // The response head ends at the first blank line. A 101 is followed by
      // binary frames, so stop reading rather than waiting for the socket to
      // end -- on a successful upgrade it never does.
      const end = buffer.indexOf('\r\n\r\n');
      if (end !== -1) {
        socket.destroy();
        resolve(buffer.slice(0, end));
      }
    });

    socket.on('error', reject);
    socket.on('end', () => resolve(buffer));
  });
}

/** Splits a raw response head into its status line and a lowercased header map. */
function parseResponse(head) {
  const [statusLine, ...headerLines] = head.split('\r\n');
  const status = Number(statusLine.split(' ')[1]);
  const headers = {};
  for (const line of headerLines) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { statusLine, status, headers };
}

function fail(message, detail) {
  console.error(`FAIL  ${message}`);
  if (detail) console.error(`      ${detail}`);
  process.exit(1);
}

async function main() {
  const raw = process.argv[2] || DEFAULT_TARGET;
  const target = parseTarget(raw);
  const key = randomBytes(16).toString('base64');

  let head;
  try {
    head = await handshake(target, key);
  } catch (error) {
    fail(
      `could not complete a request to ${raw}`,
      `${error.message}. DNS, TLS or nginx is down -- this is not a /ws problem yet.`
    );
    return;
  }

  const { statusLine, status, headers } = parseResponse(head);

  // 1. The upgrade was accepted at all.
  if (status !== 101) {
    const diagnosis =
      status === 400
        ? 'nginx is not forwarding Upgrade/Connection to 127.0.0.1:8083.'
        : status === 404
          ? 'no `location /ws` block matched -- check the server_name and the path.'
          : /text\/html/.test(headers['content-type'] || '')
            ? 'the request fell through to the web app on :3000, so the ' +
              '`location /ws` block is missing or misspelled.'
            : 'expected the proxy to upgrade the connection.';
    fail(`${raw} did not upgrade: ${statusLine.trim()}`, diagnosis);
    return;
  }

  // 2/3. The upgrade headers came back.
  if ((headers['upgrade'] || '').toLowerCase() !== 'websocket') {
    fail(`${raw}: 101 without \`Upgrade: websocket\``, `got ${headers['upgrade'] || '(absent)'}`);
    return;
  }
  if (!/upgrade/i.test(headers['connection'] || '')) {
    fail(`${raw}: 101 without \`Connection: upgrade\``, `got ${headers['connection'] || '(absent)'}`);
    return;
  }

  // 4. The accept token proves a real WebSocket server answered, not something
  //    echoing a 101. It is derived from the key we just generated, so it
  //    cannot be replayed or hardcoded.
  const expected = createHash('sha1').update(key + WS_GUID).digest('base64');
  if (headers['sec-websocket-accept'] !== expected) {
    fail(
      `${raw}: Sec-WebSocket-Accept does not match the key we sent`,
      `expected ${expected}, got ${headers['sec-websocket-accept'] || '(absent)'}. ` +
        'Something answered 101 that is not the FreeSWITCH ws binding.'
    );
    return;
  }

  // 5. The subprotocol. A 101 without it looks healthy and still fails every
  //    registration, because FreeSWITCH closes the socket immediately after.
  if (headers['sec-websocket-protocol'] !== REQUIRED_SUBPROTOCOL) {
    fail(
      `${raw}: handshake did not negotiate the \`${REQUIRED_SUBPROTOCOL}\` subprotocol`,
      `got ${headers['sec-websocket-protocol'] || '(absent)'}. Add ` +
        '`proxy_set_header Sec-WebSocket-Protocol sip;` to the /ws block. ' +
        'FreeSWITCH drops the socket after the handshake without it, so every ' +
        'agent shows as available and no call to them connects.'
    );
    return;
  }

  console.log(`ok  ${raw} completed a WebSocket handshake and negotiated \`sip\``);
}

main().catch(error => fail(error.message));
