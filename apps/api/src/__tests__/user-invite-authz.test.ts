import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `POST /api/v1/users/invite` creates a user and grants it whatever role the
 * request body names, ADMIN included. For a long time it never checked who was
 * asking: any authenticated caller -- a self-serve signup holding READONLY, a
 * buyer, an agent -- could mint a second account with full administrative
 * access. Nobody had exploited it only because an unrelated bug (`hash is not a
 * function`, from destructuring a CommonJS import) made every call 500. That is
 * a jammed door, not a locked one.
 *
 * This reads the source rather than booting the route: routes/index.ts is a
 * five-thousand-line module that registers the whole surface and cannot be
 * instantiated in a unit test. The same approach is used by
 * admin-role-drift.test.ts, for the same reason. It is deliberately narrow --
 * it asserts the gate exists and runs before the write, which is exactly the
 * property that was missing.
 */

const ROUTES_FILE = join(__dirname, '..', 'routes', 'index.ts');

/** The invite handler's body: from its route registration to the next one. */
function inviteHandlerSource(): string {
  const source = readFileSync(ROUTES_FILE, 'utf8');
  const start = source.indexOf("'/api/v1/users/invite'");
  expect(start, 'the invite route should still exist').toBeGreaterThan(-1);

  const next = source.indexOf('fastify.', source.indexOf('{', start));
  const end = next === -1 ? source.length : next;
  return source.slice(start, end);
}

describe('POST /api/v1/users/invite is gated on admin', () => {
  it('refuses callers who are not admin or owner', () => {
    const handler = inviteHandlerSource();

    expect(handler).toContain('isAdminOrOwner');
    expect(handler).toContain('403');
  });

  it('checks the caller before creating the user', () => {
    const handler = inviteHandlerSource();

    const gate = handler.indexOf('isAdminOrOwner');
    const create = handler.indexOf('prisma.user.create');

    expect(gate, 'the admin gate should be present').toBeGreaterThan(-1);
    expect(create, 'the handler should still create the user').toBeGreaterThan(-1);
    expect(gate, 'the admin gate must run before the user is created, not after').toBeLessThan(
      create
    );
  });

  it('lets only an owner grant the OWNER role', () => {
    const handler = inviteHandlerSource();

    // An ADMIN inviting an OWNER is the same escalation one step further up.
    expect(handler).toMatch(/requestedRole === 'OWNER'/);
    expect(handler).toMatch(/includes\('OWNER'\)/);
  });

  it('does not destructure bcryptjs, whose functions hang off .default', () => {
    const handler = inviteHandlerSource();

    // `const { hash } = await import('bcryptjs')` yields undefined and made
    // every call to this endpoint 500. Keeping the endpoint working matters:
    // an invite path nobody can use pushes people back to self-serve signup.
    expect(handler).not.toMatch(/const\s*\{\s*hash\s*\}\s*=\s*await\s+import\('bcryptjs'\)/);
  });
});
