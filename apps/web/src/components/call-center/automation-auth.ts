/**
 * Auth helpers for the carrier automation endpoints.
 *
 * The automation API requires authentication (JWT, API key, or demo tenant).
 * These mirror the header behavior of lib/api.ts for plain fetch calls, and
 * provide a query-string variant for EventSource/SSE connections (which
 * cannot send custom headers).
 */

export function getAutomationAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window === 'undefined') return headers;

  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const demoTenantId = localStorage.getItem('demoTenantId');
  if (localStorage.getItem('demoMode') === 'true' && demoTenantId) {
    headers['X-Demo-Tenant-Id'] = demoTenantId;
  }

  return headers;
}

export function getAutomationAuthQuery(): string {
  if (typeof window === 'undefined') return '';

  const params = new URLSearchParams();
  const token = localStorage.getItem('token');
  if (token) {
    params.set('token', token);
  }

  const demoTenantId = localStorage.getItem('demoTenantId');
  if (localStorage.getItem('demoMode') === 'true' && demoTenantId) {
    params.set('demoTenantId', demoTenantId);
  }

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}
