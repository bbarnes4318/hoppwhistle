# Deploying

Production is one Hetzner host: **178.156.223.97**, checkout at `/opt/hopwhistle`,
compose file `infra/docker/docker-compose.dev.yml`, deployed with
`scripts/deploy.sh --build api web`.

Every step below has a verification command, the output that command produces
when the step worked, and how to reverse it. "Check that it works" is not a
verification step. If a step's command does not produce its stated output, stop
and reverse it — do not carry on and hope the next step covers it.

Run everything from `/opt/hopwhistle` on the production host unless a step says
otherwise.

---

## Before you start

### Migrations are applied by hand, through psql

This database has **no `_prisma_migrations` table** and has never been managed by
`prisma migrate`. Every migration to date was applied by piping its
`migration.sql` into psql. Nothing in the deploy path may invoke the Prisma CLI:
`prisma migrate deploy` reads the absent history as "nothing applied", tries to
replay all fourteen migrations against a schema where those objects already
exist, and dies partway through with the schema half-changed.
`pnpm --filter @hopwhistle/api db:migrate:deploy` is wired to refuse and explain;
`docs/MIGRATION_DIVERGENCE.md` has the measurements.

To apply one migration:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f apps/api/prisma/migrations/<name>/migration.sql
```

**Verify** — the table the migration adds now exists, and the Prisma history
table still does not:

```bash
psql "$DATABASE_URL" -tAc \
  "SELECT to_regclass('public._prisma_migrations') IS NULL"
```

**Expected output:** `t`

If that prints `f`, something ran the Prisma CLI against production. Stop and
work out what before deploying anything.

### NEXT_PUBLIC_* is welded in at build time

`NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` are inlined by Next.js when the
web image is **built**. Setting them on the running container does nothing; the
browser was handed whatever was baked in. A rebuild that does not carry the
current values reverts every browser to the old host with no error anywhere.

Two guards now make that a failed build rather than a silent regression —
`scripts/assert-public-host.mjs` runs inside `apps/web/Dockerfile` before
`next build` (checking the values) and after it (checking the emitted bundle).
The defaults live in `infra/docker/docker-compose.dev.yml`.

---

## Part 1 — Ordinary deploy

### Step 1.1 — Confirm the checkout is what you think it is

```bash
cd /opt/hopwhistle
git fetch origin main && git checkout main && git pull
git status --porcelain | wc -l
```

**Expected output:** `0`

A dirty tree means someone edited production in place. Find out what before
building over it.

**Reversal:** `git stash` if the local edits matter, `git checkout -- .` if they
do not.

### Step 1.2 — Record the image you are replacing

```bash
docker inspect --format '{{.Image}}' hopwhistle-web-dev | tee /tmp/web-image-before
docker inspect --format '{{.Image}}' hopwhistle-api-dev | tee /tmp/api-image-before
```

**Expected output:** two `sha256:...` digests.

This is the only rollback target you get; the compose file does not tag builds.
Do not skip it.

**Reversal:** n/a — this step changes nothing.

### Step 1.3 — Build and deploy

```bash
scripts/deploy.sh --build api web
```

**Expected output:** ends with, in order:

```
preflight ok: all required secrets present in .env
postflight ok: all required secrets present in hopwhistle-api-dev
postflight ok: database on docker_postgres_data
deploy complete
```

`scripts/deploy.sh` refuses the base `docker-compose.yml` (its port maps collide
with the dev file on 9000 and 9002) and refuses `--remove-orphans` (it would
destroy `hopwhistle-dialer-v2`). Do not work around either refusal.

**Reversal:**

```bash
docker compose --env-file .env -f infra/docker/docker-compose.dev.yml stop web api
docker tag "$(cat /tmp/web-image-before)" hopwhistle-web-rollback
docker run -d --name hopwhistle-web-dev --network docker_hopwhistle-network \
  -p 3000:3000 "$(cat /tmp/web-image-before)"
```

— or, faster and usually correct: `git checkout <previous-sha>` and re-run
Step 1.3.

### Step 1.4 — Confirm the API is up

```bash
curl -s http://127.0.0.1:3001/health
```

**Expected output:**

```json
{"status":"ok","service":"hopwhistle-api","version":"1.0.0","uptime":...,"timestamp":"..."}
```

**Reversal:** Step 1.3's reversal.

---

## Part 2 — The agents.netenroll.com cutover

DNS, the certificate, the nginx server block and ports 80/443 are already done
on the box. What follows is the code side.

### Step 2.1 — Put the nginx server block under version control on the box

The repository is now the source of truth for both server blocks:
`infra/nginx/agents.netenroll.com` and `infra/nginx/hopwhistle`.

```bash
sudo cp infra/nginx/agents.netenroll.com /etc/nginx/sites-available/agents.netenroll.com
sudo cp infra/nginx/hopwhistle           /etc/nginx/sites-available/hopwhistle
sudo ln -sfn /etc/nginx/sites-available/agents.netenroll.com \
             /etc/nginx/sites-enabled/agents.netenroll.com
sudo nginx -t
```

**Expected output:**

```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

Then reload:

```bash
sudo systemctl reload nginx && systemctl is-active nginx
```

**Expected output:** `active`

**Reversal:**

```bash
sudo cp /etc/nginx/sites-available/hopwhistle.bak /etc/nginx/sites-available/hopwhistle
sudo rm -f /etc/nginx/sites-enabled/agents.netenroll.com
sudo nginx -t && sudo systemctl reload nginx
```

(Take that `.bak` yourself before the `cp` above. `sudo cp
/etc/nginx/sites-available/hopwhistle{,.bak}`.)

### Step 2.2 — Rebuild with the new NEXT_PUBLIC_* values

The compose defaults already carry them, so a plain rebuild is enough. Passing
them explicitly costs nothing and makes the shell history say what was built:

```bash
NEXT_PUBLIC_API_URL=https://agents.netenroll.com \
NEXT_PUBLIC_WS_URL=wss://agents.netenroll.com \
  scripts/deploy.sh --build api web
```

**Expected output:** the four lines from Step 1.3, and — from inside the image
build — these, which are the guards:

```
assert-public-host: NEXT_PUBLIC_API_URL=https://agents.netenroll.com ok
assert-public-host: NEXT_PUBLIC_WS_URL=wss://agents.netenroll.com ok
assert-public-host: 2544 built files scanned, no retired host
assert-public-host: in the bundle: NEXT_PUBLIC_API_URL
assert-public-host: NEXT_PUBLIC_WS_URL is not in the bundle -- expected, nothing the app renders reads it (see REQUIRE_PRESENT)
```

The last line is normal, not a warning to chase. See Step 2.3.

A build pointed at the old host stops here instead, with `BUILD REFUSED`.

**Reversal:** Step 1.3's reversal.

### Step 2.3 — Verify the built image, not the variables

This is the step that actually matters, and the one people skip. That the
variables were set proves nothing: the question is whether the bytes reached the
bundle. Ask the image.

```bash
docker exec hopwhistle-web-dev sh -c \
  "grep -rl 'https://agents.netenroll.com' /app/apps/web/.next | wc -l"
```

**Expected output:** a number in the low tens — it was `45` on the build this
runbook was written against, and anything above zero is the assertion. Zero
means the value never reached the bundle. Do not cut over.

Grep for the **API** URL here, not the WebSocket one. `wss://agents.netenroll.com`
is legitimately absent: the only file reading `NEXT_PUBLIC_WS_URL` is
`apps/web/src/components/dashboard/live-stats.tsx`, which nothing imports, so
Next.js never bundles it. The softphone builds its own signalling URL from
`window.location.hostname`. Checking for it would fail a correct deploy.

Now the negative, which is the one that catches a silent revert:

```bash
docker exec hopwhistle-web-dev sh -c \
  "grep -rl 'hopwhistle.com' /app/apps/web/.next | wc -l"
```

**Expected output:** `0`

Any non-zero count means the image you just built still serves the old host to
somebody. Find it with `grep -rn 'hopwhistle.com' apps/web/src docs/legal` and
rebuild — `docs/legal/*.md` counts, because the routes under
`apps/web/src/app/legal` render those files into pages at build time.

Run this against the running container, not the builder. `.next/cache` in a
build tree is webpack's incremental cache and holds strings from previous
builds; it is not copied into the runtime image, and grepping it will show you
a retired host that no browser can receive.

**Reversal:** Step 1.3's reversal.

### Step 2.4 — Verify the root redirect

```bash
curl -sS -o /dev/null -D - https://agents.netenroll.com/ | head -3
```

**Expected output:**

```
HTTP/1.1 302 Found
Server: nginx/...
Location: /login
```

And that `/login` itself is served rather than redirected again:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://agents.netenroll.com/login
```

**Expected output:** `200`

**Reversal:** remove the `location = /` block from
`/etc/nginx/sites-available/agents.netenroll.com`, `nginx -t`, reload.

### Step 2.5 — Verify the WebSocket proxy before touching a softphone

Every agent's softphone builds its signalling URL from the hostname in the
address bar, so on this host it dials `wss://agents.netenroll.com/ws`. If that
proxy is wrong, registration fails and the dashboard still shows the agent as
available — the worst possible failure, because nothing looks broken until a
call is routed to them.

```bash
curl -sS -i -N \
  -H 'Connection: Upgrade' \
  -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Protocol: sip' \
  https://agents.netenroll.com/ws | head -5
```

**Expected output:**

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
Sec-WebSocket-Protocol: sip
```

A `400` means the Upgrade/Connection headers are not being forwarded. A `200`
with HTML means the request fell through to the web app — the `/ws` location is
missing or misspelled. A `101` **without** the `Sec-WebSocket-Protocol: sip`
line means the subprotocol header is not being set and FreeSWITCH will drop the
socket after the handshake.

**Reversal:** restore the previous
`/etc/nginx/sites-available/agents.netenroll.com`, `nginx -t`, reload.

### Step 2.6 — End-to-end softphone check on the new host

Do this with a real agent extension and a real inbound call. Three assertions:
the agent registers, the call arrives, and audio flows both ways.

**(a) The agent registers.** Have the agent sign in at
`https://agents.netenroll.com/login` and open the softphone. Then, on the box:

```bash
docker exec hopwhistle-freeswitch-dev fs_cli -x 'sofia status profile internal reg' \
  | grep -A2 "User:.*<ext>"
```

**Expected output:** a registration whose `Contact:` is a `ws`/`wss` transport,
e.g.

```
User:           1001@<sip-realm>
Contact:        "1001" <sip:1001@<ip>:<port>;transport=ws;...>
Status:         Registered(UDP-NAT)(unknown) EXP(...)
```

The realm in `User:` is the **existing** SIP realm and must not have changed —
see Step 2.7.

**(b) The call arrives.** Dial the campaign's inbound number. While it is
ringing:

```bash
docker exec hopwhistle-freeswitch-dev fs_cli -x 'show calls count'
```

**Expected output:** `1 total.`

**(c) Audio flows both ways.** Answer, talk in both directions for ten seconds,
and while the call is still up:

```bash
UUID=$(docker exec hopwhistle-freeswitch-dev fs_cli -x 'show channels' \
  | awk -F, 'NR==2 {print $1}')
docker exec hopwhistle-freeswitch-dev fs_cli -x "uuid_dump $UUID" \
  | grep -E 'rtp_audio_(in|out)_media_packet_count'
```

**Expected output:** both counters present and non-zero, and both larger on a
second run a few seconds later:

```
variable_rtp_audio_in_media_packet_count: 412
variable_rtp_audio_out_media_packet_count: 408
```

`in` at zero is one-way audio toward the agent (usually RTP not reaching the
host). `out` at zero is one-way audio toward the caller. Either one is a failed
cutover even though the call connected.

**Reversal:** Step 1.3's reversal, then tell agents to use
`https://hopwhistle.com` until it is fixed — the old host still serves the app
in full, which is why the redirect in Step 2.8 is deliberately temporary.

### Step 2.7 — Assert the SIP realm did not move

The SIP realm and the FreeSWITCH directory domain are what every registered
agent extension authenticates against. They are deliberately **not** part of
this migration: changing them invalidates every SIP credential on the platform.

```bash
docker exec hopwhistle-freeswitch-dev fs_cli -x 'eval ${domain}'
```

**Expected output:** the same value as before the deploy — whatever
`SIP_DOMAIN` is set to in `.env` on this host. Capture it first with
`grep '^SIP_DOMAIN=' .env` and compare.

```bash
grep -c 'hopwhistle.com' apps/freeswitch/conf/directory/default.xml
```

**Expected output:** `2` — the `<alias>` entries are unchanged.

**Reversal:** n/a — this step asserts, it does not change anything. If the realm
*has* moved, revert the commit that moved it before anything else; every agent
is already unable to register.

### Step 2.8 — Verify the redirect from the old host

Browsers move; machines do not. Both halves need checking.

```bash
curl -sS -o /dev/null -D - https://hopwhistle.com/delivery/settlements | head -3
```

**Expected output:**

```
HTTP/1.1 302 Found
Server: nginx/...
Location: https://agents.netenroll.com/delivery/settlements
```

The path is preserved, so a bookmark lands on the page it named.

Now confirm the two paths that must **not** redirect. Carriers hold webhook URLs
on the old hostname against numbers already provisioned, and a 301 on a POST is
a dropped body:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' https://hopwhistle.com/api/v1/ping
```

**Expected output:** `401` (or `400`) — anything from the API itself. A `302`
here means carrier webhooks are being redirected and inbound SMS is being lost.

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  -H 'Sec-WebSocket-Protocol: sip' \
  https://hopwhistle.com/ws
```

**Expected output:** `101` — an agent still on an open tab keeps their
registration.

**Reversal:** restore `/etc/nginx/sites-available/hopwhistle` from the `.bak`
taken in Step 2.1, `nginx -t`, reload. The old host then serves the app in full
again.

---

## If the softphone fails to register after cutover

Work down this list in order. Each step tells you which of the four things is
wrong: the socket, the credentials, the realm, or the browser.

**1. Is it the socket, or the SIP?** In the agent's browser console, look for
`[Phone] Initializing SIP UA dynamically:` and read `sipWsUrl` back.

- It says `wss://agents.netenroll.com/ws` → the app is right; go to 2.
- It says `wss://hopwhistle.com/ws` or `wss://...:7443` → the app is wrong.
  `NEXT_PUBLIC_SIP_WS_URL` is set in `.env` and is overriding the default. Unset
  it and redeploy.
- The line never appears → the browser never got credentials. Go to 4.

**2. Does the socket open at all?** Re-run Step 2.5's curl. A non-`101` is an
nginx problem and the response code says which — see the failure notes under
that step. Nothing else on this list will help until it returns `101`.

**3. Does FreeSWITCH see a REGISTER?**

```bash
docker exec hopwhistle-freeswitch-dev fs_cli -x 'sofia loglevel all 9'
docker logs -f hopwhistle-freeswitch-dev | grep -i register
```

- **No REGISTER arrives.** The socket opened but the client never sent one.
  Almost always the `Sec-WebSocket-Protocol: sip` header — FreeSWITCH accepts
  the WebSocket and then drops it because the subprotocol was not negotiated.
  Compare the `/ws` block against `infra/nginx/agents.netenroll.com`.
- **REGISTER arrives, 403 Forbidden.** The realm or the password is wrong. Go
  to 4.
- **REGISTER arrives, 401 then nothing.** Normal — the 401 is the challenge. If
  no second REGISTER follows, the client rejected the challenge's realm; go to 4.

Put the log level back with `sofia loglevel all 0` when you are done.

**4. Is the realm the one the credentials were issued for?** The app takes the
realm from the API response, not from the hostname:

```bash
grep -E '^(FREESWITCH_REALM|PUBLIC_IP|SIP_DOMAIN)=' .env
docker exec hopwhistle-freeswitch-dev fs_cli -x 'eval ${domain}'
```

`FREESWITCH_REALM` (falling back to `PUBLIC_IP`) is what the API hands the
browser; `${domain}` is what FreeSWITCH authenticates against. **They must
match.** If they diverged, that is the bug — and it is not something the domain
migration should have touched, so look at what else changed.

Confirm the directory still lists the extension:

```bash
docker exec hopwhistle-freeswitch-dev fs_cli -x 'user_exists id <ext> <realm>'
```

**Expected output:** `true`

**5. Is it just this browser?** A stale service worker or a cached bundle from
the old host will keep using the old signalling URL. Have the agent hard-reload
(Ctrl-Shift-R) and, if that fails, load the portal in a private window. If the
private window registers and the normal one does not, it is cache, not
infrastructure.

**6. Still stuck — get everyone working, then debug.** The old host still serves
the app in full (Step 2.8 keeps `/api` and `/ws` alive there). Point agents at
`https://hopwhistle.com` and reverse Step 2.8's redirect so browsers stop being
sent to the new host. Nobody loses a shift while you find it.

---

## Appendix — deploying from GitHub Actions

Actions → Deploy → Run workflow. Pick a ref, leave **dry run** ticked for the
first run to see the plan, untick it to deploy. One deploy runs at a time and a
running one is never cancelled — a half-applied migration is worse than a queued
job.

The workflow runs `scripts/deploy-netenroll.sh`, which preflights the tree and
the migration files, applies migrations **through psql**, syncs platform admins
against the still-running old application (refusing to continue if that would
leave zero platform admins), and then hands off to `scripts/deploy.sh --build
api web`.

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

### From the box

```bash
cd /opt/hopwhistle
git checkout main && git pull
PLATFORM_ADMIN_EMAILS=<your-address> ./scripts/deploy-netenroll.sh --dry-run
PLATFORM_ADMIN_EMAILS=<your-address> ./scripts/deploy-netenroll.sh
```

---

## Standing behaviour worth knowing

- **Self-serve signup requires an invitation.** `POST /api/auth/register`
  refuses without an activation token — the fix for strangers landing inside a
  paying agency. Issue invitations with `POST /api/v1/auth/activation-grants`
  as an OWNER or ADMIN of the agency being joined.
- **`auditLog()` raises instead of swallowing.** If the audit table becomes
  unwritable, operations that audit fail rather than proceed unrecorded.

See `docs/TENANT_ISOLATION_AUDIT.md` and `docs/PLATFORM_ADMIN.md`.
