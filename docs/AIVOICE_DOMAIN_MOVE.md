# The AI Voice calls stopped showing in the portal

**Symptom:** the AI voice calls and recordings used to appear in the portal and
now do not. Nothing else changed on the day it happened.

**Status:** nothing is lost. As of 2026-09-10 the Dograh database holds
**110,723 call runs**, from 2026-07-16 through the current minute, and it is
still recording. This is a broken sign-in between two websites, not missing
data.

---

## What actually broke

The portal never stored these calls. `/voice-agents` is an **iframe** around the
Dograh app, and the portal's API signs you into it by setting a cookie —
`apps/api/src/routes/aivoice.ts`. The audit is explicit about the split:

> Dograh owns its own database and recording storage; nothing about these calls
> lands in the Hopwhistle DB.
> — `deploy/dograh/export_recordings.py`

That cookie handoff works only while the portal and the AI Voice app share one
registrable domain. They used to:

| | before | now |
| --- | --- | --- |
| portal | `hopwhistle.com` | **`agents.netenroll.com`** |
| AI Voice app | `aivoice.hopwhistle.com` | `aivoice.hopwhistle.com` |
| same registrable domain? | yes → cookie flows | **no → cookie dropped** |

When the portal moved to `agents.netenroll.com`, two independent browser rules
started blocking the handoff, and neither is fixable with a configuration
string:

1. **A response may only set a cookie for its own domain or a parent of it**
   (RFC 6265 domain-match). A page on `agents.netenroll.com` cannot set a
   cookie for `.hopwhistle.com`, so the browser drops both `Set-Cookie` headers
   **silently**.
2. **The frame is now cross-site.** `SameSite=Lax` cookies are not sent into a
   cross-site frame at all. `SameSite=None; Secure` would make it a third-party
   cookie — blocked outright by Safari and Firefox, partitioned by Chrome.

So the iframe loads, Dograh shows its own login instead of your calls, and
nothing errors anywhere. That is exactly what "they all showed before and just
don't now" looks like from the outside.

This was a known consequence of the domain move, recorded in the header of
`apps/api/src/routes/aivoice.ts` at the time.

## The fix

Serve the same Dograh app at **`aivoice.netenroll.com`**. That restores the
shared registrable domain, and nothing about the SSO code has to change — the
route file already names the two settings it needs.

Everything below happens **on the server**. Nothing here is a code change.

### 1. DNS

Add an A record for `aivoice.netenroll.com` pointing at the same IP that serves
`agents.netenroll.com`. Wait for it to resolve:

```bash
dig +short aivoice.netenroll.com
```

Do not continue until that prints the server's IP. Certbot's HTTP-01 challenge
fails against a name that does not resolve yet.

### 2. Install the vhost

```bash
cd /opt/hopwhistle
git pull
cp infra/nginx/aivoice.netenroll.com /etc/nginx/sites-available/aivoice.netenroll.com
```

`cp: cannot stat` there means the change is not on `main` yet — `git pull` on
this box only ever brings `main`, and the vhost is still on its branch. Either
merge it first, or take the one file straight off the branch without touching
the checkout:

```bash
git fetch origin claude/ecstatic-wozniak-9aihy8
git show origin/claude/ecstatic-wozniak-9aihy8:infra/nginx/aivoice.netenroll.com \
  > /etc/nginx/sites-available/aivoice.netenroll.com
```

**Before enabling it, diff it against the one that already works.** The AI Voice
app's routing lives outside this repository, and the vhost in this repo is
written from its published container ports rather than from that app's own
documentation:

```bash
diff /etc/nginx/sites-available/aivoice.hopwhistle.com \
     /etc/nginx/sites-available/aivoice.netenroll.com
```

Carry over anything the working one does that the new one does not. Then:

```bash
ln -s /etc/nginx/sites-available/aivoice.netenroll.com /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

`nginx -t` must pass before the reload. If it fails, the reload is skipped and
the old config keeps serving — fix the error and re-test.

### 3. Certificate

```bash
certbot --nginx -d aivoice.netenroll.com
```

### 4. Point the portal at the new host

In `/opt/hopwhistle/.env`, set both — they must always name the same host:

```
AIVOICE_URL=https://aivoice.netenroll.com
AIVOICE_COOKIE_DOMAIN=.netenroll.com
```

Then restart the API so it picks them up:

```bash
cd /opt/hopwhistle
docker compose --env-file .env -f infra/docker/docker-compose.dev.yml up -d --force-recreate api
```

### 5. Dograh's own configuration

Dograh is a separate application at `/opt/dograh` and has its own idea of its
public URL and which origins may embed it. Update those to the new hostname per
that project's configuration, and restart its stack:

```bash
cd /opt/dograh
docker compose restart
```

`AIVOICE_JWT_SECRET` in the portal's `.env` must equal Dograh's `OSS_JWT_SECRET`.
That has not changed and does not need to — but if the iframe still shows a
login after all of the above, check it, because a mismatched secret produces a
token Dograh rejects without saying why.

### 6. Verify

Open `https://agents.netenroll.com/voice-agents`. The AI Voice app should load
already signed in, showing your calls — no second login.

If it still shows Dograh's login screen, open the browser's developer tools,
Application → Cookies, and check for `dograh_auth_token` on `.netenroll.com`.
Its absence means step 4 was not picked up; its presence with a login screen
still showing means step 5 — the secret or the allowed origins.

## Getting the recordings out, today

This works right now and does not depend on any of the above:

```bash
cd /opt/hopwhistle
./get-dograh-recordings.sh 2025-09-10 2026-09-10
```

Both dates inclusive, read as US Eastern. It writes a `manifest.csv` of every
call in the window plus the audio itself, tars it up, and prints the `scp`
command to pull it to your PC. It is read-only against Dograh.

## What this does not do

It restores the embedded app. It does **not** put the AI voice calls into the
portal's own `/calls` ledger alongside the pay-per-call traffic, because they
are not in the Hopwhistle database at all — they never have been.

Doing that is a separate piece of work: a sync that reads Dograh's
`workflow_runs` and writes `Call` and `Recording` rows into Hopwhistle, so the
two kinds of call appear in one list, survive a domain change, and can be
filtered, exported and billed together. It is worth doing, and it is not what
this document describes.
