/**
 * The read-only guarantee for a role preview.
 *
 * ── Why this is a hook and not a set of guards ───────────────────────────────
 *
 * A platform operator previewing an agency as OWNER or AGENT is looking at
 * somebody else's agency with somebody else's eyes. Nothing they do while in
 * that state should change anything: not a disposition, not an application, not
 * a bank mandate. The operator's own judgement is not the control -- they are
 * there precisely because they are unsure what the role can do.
 *
 * The only way to promise that is to refuse by DEFAULT. A per-route guard is a
 * promise about the routes somebody remembered, and this surface has several
 * hundred handlers across thirty-odd plugins, with more added every phase. One
 * forgotten `preHandler` is a preview that writes.
 *
 * So: one hook, registered once in `buildServer()` ahead of every route, that
 * refuses every non-GET request while `request.user.isReadOnlyPreview` is set.
 * A route added tomorrow is covered without its author knowing this exists.
 *
 * ── The three exemptions ─────────────────────────────────────────────────────
 *
 * Refusing literally everything traps the operator: the controls that end the
 * preview are themselves writes. So three endpoints stay open, and they are the
 * three ways out and nothing else:
 *
 *   DELETE /api/v1/platform/acting-tenant          leave the agency
 *   POST   /api/v1/platform/acting-tenant/preview  change or clear the preview
 *   POST   /api/auth/logout                        leave entirely
 *
 * None of them touches agency data. `POST /api/v1/platform/acting-tenant` is
 * deliberately NOT on the list: entering a different agency while previewing a
 * role is a state nobody asked for, and the operator can leave the preview in
 * one click first.
 *
 * ── Where it runs, and the second call site ──────────────────────────────────
 *
 * The hook is `onRequest`, registered immediately after `registerApiV1Auth()`.
 * Hooks in a phase run in registration order, so by the time this one runs the
 * /api/v1 principal is already built -- and refusing at `onRequest` means a
 * preview upload is rejected before its body is read.
 *
 * Routes outside /api/v1 authenticate through `middleware/auth.ts`'s
 * `authenticate` preHandler instead, which runs AFTER every instance-level
 * hook, so at `onRequest` time those requests have no principal yet. Rather
 * than give each of them a guard, `authenticateJWT` calls `enforceReadOnlyPreview`
 * itself the moment it finishes building the principal. That is still one
 * implementation and still not per-route: the shared authenticator enforces it
 * for everything it authenticates.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/** Methods that cannot change anything, and are therefore always allowed. */
const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export const PREVIEW_READ_ONLY = {
  code: 'PREVIEW_READ_ONLY',
  message:
    'This session is a read-only role preview. Leave the preview to make changes in this agency.',
} as const;

/**
 * The three ways out of a preview, by method and path.
 *
 * Matched on the pathname only -- a query string never makes one of these a
 * different endpoint -- and exactly, so `/api/v1/platform/acting-tenant/preview`
 * being exempt does not quietly exempt anything nested beneath it.
 */
const EXEMPT: ReadonlyArray<{ method: string; path: string }> = [
  { method: 'DELETE', path: '/api/v1/platform/acting-tenant' },
  { method: 'POST', path: '/api/v1/platform/acting-tenant/preview' },
  { method: 'POST', path: '/api/auth/logout' },
];

function pathnameOf(url: string): string {
  const queryStart = url.indexOf('?');
  return queryStart === -1 ? url : url.slice(0, queryStart);
}

function isExempt(request: FastifyRequest): boolean {
  const path = pathnameOf(request.url);
  return EXEMPT.some(entry => entry.method === request.method && entry.path === path);
}

/**
 * Refuse this request if it would write during a read-only preview.
 *
 * Returns true when it has replied, so a caller that is part of an
 * authentication chain can stop rather than carry on building a principal for a
 * request that is already answered.
 */
export function enforceReadOnlyPreview(request: FastifyRequest, reply: FastifyReply): boolean {
  const principal = request.user as { isReadOnlyPreview?: boolean } | undefined;

  if (principal?.isReadOnlyPreview !== true) return false;
  if (SAFE_METHODS.includes(request.method)) return false;
  if (isExempt(request)) return false;

  void reply.code(403).send({ error: PREVIEW_READ_ONLY });
  return true;
}

/**
 * Register the read-only hook. Called once, from `buildServer()`, before any
 * route plugin. Tests that build a bare instance must register it too -- see
 * `__tests__/role-preview.test.ts`.
 */
export function registerReadOnlyPreview(server: FastifyInstance): void {
  server.addHook('onRequest', async (request, reply) => {
    await Promise.resolve();
    enforceReadOnlyPreview(request, reply);
  });
}
