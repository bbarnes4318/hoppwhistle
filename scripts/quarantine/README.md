# Quarantine — do not run anything in this directory

The two files here were run against the production database by hand. Between
them they produce, exactly, the incident recorded in
`docs/AGENT_AUTHORIZATION_AUDIT.md`: an ordinary agent who could see everything
a Company Admin could, and then could see only a Dashboard.

They are kept rather than deleted because they are evidence — `authz-report.sh`
looks for the rows they write, and reading them is how you recognise those rows.
Nothing in the repository executes them, and nothing should.

## `seed-admin-roles.sql` — grants ADMIN to every account on the platform

```sql
INSERT INTO user_roles (id, "userId", "roleId", "createdAt")
SELECT 'ur-' || u.id, u.id, 'role-admin', NOW()
FROM users u
WHERE NOT EXISTS (...);
```

`FROM users u` with no `WHERE tenantId = …` and no account list. Every row in
`users`, across every agency, becomes a Company Admin — and re-running it does
the same to every account created since. It also writes literal ids
(`ur-<userId>`, `role-admin`), where the application writes uuids, which is what
makes its rows identifiable after the fact.

## `demote-user.sql` — removes ADMIN and leaves the account with no role

```sql
DELETE FROM user_roles WHERE "userId" = (...) AND "roleId" = 'role-admin';
```

A delete with no matching insert. The account is left holding nothing, which the
sidebar renders as a one-item Dashboard — indistinguishable, to the person using
it, from a broken session. A demotion has to assign the replacement role in the
same transaction or it is not a demotion, it is a lockout.

## What to use instead

```
scripts/authz-report.sh          # read-only. Who holds what, and how they got it.
```

Run it first, build an explicit account-by-account mapping from its output, and
apply the repair one named account at a time. "All users" is never a shortcut
for role repair: it is how the first half of this incident happened.
