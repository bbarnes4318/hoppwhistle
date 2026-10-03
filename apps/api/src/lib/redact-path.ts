/**
 * Strip bearer-style tokens out of a request path before it is logged.
 *
 * The agreement signing and download links carry their token in the path
 * (`/api/v1/public/agreements/sign/<token>/...`), so the request URL is a
 * credential. It is redacted wherever a URL is written down: the request
 * logger and AuditLog `resource`.
 */
export function redactSensitivePath(url: string): string;
export function redactSensitivePath(url: string | undefined): string | undefined;
export function redactSensitivePath(url: string | undefined): string | undefined {
  if (!url) return url;
  return url.replace(/\/(sign|download)\/[^/?#]+/g, '/$1/[redacted]');
}
