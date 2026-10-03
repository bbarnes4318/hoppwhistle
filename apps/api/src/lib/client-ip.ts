/**
 * The client's IP address, for evidence rows.
 *
 * Production runs behind nginx (`infra/nginx/agents.netenroll.com`), which
 * sets `X-Real-IP $remote_addr`, and Fastify has no `trustProxy` -- so
 * `request.ip` is nginx, or the Docker bridge, for every request. The header
 * is believed only when the socket itself is a proxy we run: loopback, a
 * private (RFC 1918) address or the Docker bridge. From anywhere else the
 * header is the caller's to forge, and the socket address is used.
 */

import { isIP } from 'net';

import type { FastifyRequest } from 'fastify';

function stripMapped(address: string): string {
  return address.startsWith('::ffff:') ? address.slice(7) : address;
}

/** Loopback, RFC 1918, link-local Docker bridges and IPv6 ULA. */
export function isTrustedProxyAddress(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const address = stripMapped(raw.trim());
  if (address === '::1') return true;
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower.startsWith('fc') || lower.startsWith('fd');
  }
  return false;
}

export function clientIpFrom(
  socketAddress: string | undefined | null,
  realIpHeader: string | string[] | undefined
): string | null {
  const socket = socketAddress ? stripMapped(socketAddress) : null;
  if (isTrustedProxyAddress(socket)) {
    const header = Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader;
    const first = header?.split(',')[0]?.trim();
    if (first && isIP(stripMapped(first)) !== 0) return stripMapped(first);
  }
  return socket;
}

export function clientIp(request: FastifyRequest): string | null {
  return clientIpFrom(request.socket?.remoteAddress ?? request.ip, request.headers['x-real-ip']);
}

/** The user agent, bounded so a hostile header cannot bloat a row. */
export function clientUserAgent(request: FastifyRequest): string | null {
  const ua = request.headers['user-agent'];
  return ua ? ua.slice(0, 512) : null;
}
