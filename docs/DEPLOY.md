# Deploying

Two ways, same script underneath. Both run `scripts/deploy-netenroll.sh`, which
is the thing that gets the ordering right.

## From GitHub (Actions → Deploy → Run workflow)

Pick a ref, leave **dry run** ticked for the first run to see the plan, untick
it to deploy. One deploy runs at a time and a running one is never cancelled —
a half-applied migration is worse than a queued job.

### Setup, once

The workflow SSHes from a GitHub runner to the production box. That needs a
keypair, and the two halves go in *opposite* places — this is the part that is
easy to get backwards:

| Half | Where | Why |
| --- | --- | --- |
| **Public** (`.pub`) | `~/.ssh/authorized_keys` **on the production host** | so the host accepts the connection |
| **Private** | GitHub → Settings → Secrets and variables → **Actions** → `DEPLOY_SSH_KEY` | so the runner can make it |

A GitHub **deploy key** is not this. Deploy keys grant access *to the
repository*; they have nothing to do with reaching your server.

**Secrets** (Settings → Secrets and variables → Actions → Secrets):

| Name | Value |
| --- | --- |
| `DEPLOY_SSH_KEY` | the **private** key, whole file including the BEGIN/END lines |
| `DEPLOY_HOST` | the production host or IP |
| `DEPLOY_USER` | the SSH user that owns the checkout |
| `DEPLOY_KNOWN_HOSTS` | *optional but recommended* — output of `ssh-keyscan -H <host>`, captured once from a machine you trust. Without it the workflow accepts whatever answers on that address. |

**Variables** (same page → Variables):

| Name | Value |
| --- | --- |
| `PLATFORM_ADMIN_EMAILS` | comma-separated NetEnroll staff addresses. Without it only `joel.vasquez@outlook.com` is provisioned. |
| `DEPLOY_PATH` | only if the checkout is not at `/opt/hopwhistle` |

Generate the keypair on a machine you trust, never in CI:

```bash
ssh-keygen -t ed25519 -C 'deploy-hoppwhistle' -f ~/.ssh/deploy-hoppwhistle
ssh-copy-id -i ~/.ssh/deploy-hoppwhistle.pub <user>@<host>   # public half → host
cat ~/.ssh/deploy-hoppwhistle                                # private half → DEPLOY_SSH_KEY
ssh-keyscan -H <host>                                        # → DEPLOY_KNOWN_HOSTS
```

## From the box

```bash
cd /opt/hopwhistle
git checkout main && git pull
PLATFORM_ADMIN_EMAILS=<your-address> ./scripts/deploy-netenroll.sh --dry-run
PLATFORM_ADMIN_EMAILS=<your-address> ./scripts/deploy-netenroll.sh
```

## What the script does, and why the order matters

1. **Preflight** — refuses a dirty tree, a checkout missing any required
   migration, or a missing `.env` / `apps/api/.env`.
2. **Migrations** — `prisma migrate deploy` then `db:constraints`.
   `scripts/deploy.sh` does *not* do this, and the code cannot run without it:
   every authenticated request reads `platform_admins`.
3. **Platform admins** — `platform:admins --sync`, *before* the new code ships,
   against the still-running old application. **It refuses to continue if that
   would leave zero platform admins**, which would make the dialer console, the
   quota routes and the `/admin/api/v1` console unreachable for everyone
   including whoever ran the deploy.
4. **Deploy** — hands off to `scripts/deploy.sh --build api web`, which keeps
   all its own guards (compose-file check, secret preflight, in-container secret
   postflight, postgres volume identity).
5. **Postflight** — `/health`.

## Live from the first deploy of this change

- **Self-serve signup requires an invitation.** `POST /api/auth/register`
  refuses without an activation token — the fix for strangers landing inside a
  paying agency. Issue invitations with `POST /api/v1/auth/activation-grants`
  as an OWNER or ADMIN of the agency being joined.
- **`auditLog()` raises instead of swallowing.** If the audit table becomes
  unwritable, operations that audit fail rather than proceed unrecorded.

See `docs/TENANT_ISOLATION_AUDIT.md` and `docs/PLATFORM_ADMIN.md`.
