# White-label domain: agents.lifeleadsplus.com

One application, one database, one API, one FreeSWITCH, two public hostnames:

| Host                       | Who signs in there                                     | Login page drawn as |
| -------------------------- | ------------------------------------------------------ | ------------------- |
| `agents.netenroll.com`     | every NetEnroll agency                                 | NetEnroll           |
| `agents.lifeleadsplus.com` | Life Leads Plus **and every child agency it onboards** | Life Leads Plus     |

Nothing is duplicated. There is no second deployment, database, API or
FreeSWITCH, and `APP_URL`, `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` stay
`agents.netenroll.com`.

## How it works

- **`Tenant.domain`** on the Life Leads Plus parent is `agents.lifeleadsplus.com`.
  Its child agencies have no domain. They inherit the parent's when it is read,
  and nothing is copied onto them.
- **Links.** Every invitation, password reset, owner invite and call-export
  link is built from `portalUrlForTenant()` (`apps/api/src/lib/tenant-brand.ts`).
  It uses the tenant's own domain, then its parent's, then `APP_URL`
  (`https://agents.netenroll.com`). The recipient's tenant decides the host.
  The host the request arrived on does not.
- **Login page brand.** Before sign-in, the web server asks
  `GET /api/v1/public/brand?host=<host>` which brand owns the host
  (`routes/public-brand.ts`). After sign-in, the brand comes from the session
  (`/api/auth/me`). A child inherits its parent's brand either way.
- **Authentication never reads the host.** The acting tenant is
  `request.user.tenantId` (`lib/tenant-context.ts`). Host, Origin, Referer,
  X-Forwarded-Host, query parameters and body cannot change it.
  `apps/api/src/__tests__/white-label-domain.test.ts` pins this. Agency A signed
  in on `agents.lifeleadsplus.com` is Agency A. It is not Life Leads Plus and it
  is not Agency B. Sessions are host-only cookies and localStorage, so each
  hostname has its own sign-in.
- **The browser** calls `window.location.origin` for `/api` and the softphone
  dials `wss://<current hostname>/ws`, so both work unchanged on the new host.

**No database migration is needed.** `Tenant.domain`, `whiteLabel`,
`parentTenantId`, `brandTheme` and `brandName` already exist, and the
`life-leads-plus` theme and its assets (`apps/web/public/brands/life-leads-plus/`)
are already in the build.

## Activation order

Do the steps in this order. **Set the tenant's domain last (step 6).** From the
moment it is saved, every link Life Leads Plus and its children are sent names
`agents.lifeleadsplus.com`, so the host must already be serving.

Run everything on the production host (`178.156.223.97`, checkout at
`/opt/hopwhistle`) unless a step says otherwise.

### 1. Deploy the code

```bash
cd /opt/hopwhistle
git pull
docker inspect --format '{{.Image}}' hopwhistle-web-dev | tee /tmp/web-image-before
docker inspect --format '{{.Image}}' hopwhistle-api-dev | tee /tmp/api-image-before
NEXT_PUBLIC_API_URL=https://agents.netenroll.com \
NEXT_PUBLIC_WS_URL=wss://agents.netenroll.com \
  scripts/deploy.sh --build api web
curl -s http://127.0.0.1:3001/health
```

`NEXT_PUBLIC_*` stays on `agents.netenroll.com` on purpose. The browser uses its
own origin, and these values only serve server-side rendering.

### 2. DNS

In the DNS zone for `lifeleadsplus.com`, create:

| Type | Name     | Value            | TTL   |
| ---- | -------- | ---------------- | ----- |
| `A`  | `agents` | `178.156.223.97` | `300` |

`178.156.223.97` is the production host recorded in `docs/DEPLOY.md`, and it is
the one that serves `agents.netenroll.com`. Confirm that before creating the record:

```bash
dig +short agents.netenroll.com        # must print 178.156.223.97
dig +short AAAA agents.netenroll.com   # if this prints an address, add the same AAAA for agents.lifeleadsplus.com; if empty, add none
```

Then wait for the new record:

```bash
dig +short agents.lifeleadsplus.com    # must print 178.156.223.97
```

Do not change any other record.

### 3. TLS certificate (Certbot, HTTP-01 webroot, as agents.netenroll.com)

`agents.netenroll.com` renews through the HTTP-01 webroot at
`/var/www/hopwhistle`. That is the `/.well-known/acme-challenge/` block in
`infra/nginx/agents.netenroll.com`. Check its renewal settings first, and match
the method if it differs:

```bash
sudo grep -E 'authenticator|webroot' /etc/letsencrypt/renewal/agents.netenroll.com.conf
```

nginx will not load the full server block until the certificate exists. Serve
the challenge first with a temporary port-80-only block:

```bash
sudo tee /etc/nginx/sites-available/agents.lifeleadsplus.com >/dev/null <<'EOF'
server {
    listen 80;
    server_name agents.lifeleadsplus.com;
    location /.well-known/acme-challenge/ {
        root /var/www/hopwhistle;
    }
    location / {
        return 404;
    }
}
EOF
sudo ln -sfn /etc/nginx/sites-available/agents.lifeleadsplus.com \
             /etc/nginx/sites-enabled/agents.lifeleadsplus.com
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/hopwhistle \
  -d agents.lifeleadsplus.com \
  --deploy-hook 'systemctl reload nginx'
```

**Expected:** `Successfully received certificate.` with files under
`/etc/letsencrypt/live/agents.lifeleadsplus.com/`.

Certbot's existing timer or cron renews this certificate with the others.
Confirm it:

```bash
sudo certbot renew --dry-run --cert-name agents.lifeleadsplus.com
sudo certbot certificates    # agents.netenroll.com is still listed, unchanged
```

### 4. nginx

Replace the temporary block with the committed one, which routes the same way
as `agents.netenroll.com`: `/` to `:3000`, `/api` to `:3001`, and `/ws` to
FreeSWITCH `:7443` with the same WebSocket headers and timeouts:

```bash
cd /opt/hopwhistle
sudo cp infra/nginx/agents.lifeleadsplus.com /etc/nginx/sites-available/agents.lifeleadsplus.com
sudo ln -sfn /etc/nginx/sites-available/agents.lifeleadsplus.com \
             /etc/nginx/sites-enabled/agents.lifeleadsplus.com
sudo nginx -t && sudo systemctl reload nginx && systemctl is-active nginx
```

`infra/nginx/agents.netenroll.com` is not touched.
`apps/api/src/__tests__/ws-proxy.test.ts` fails if the two files ever differ in
anything but the hostname and certificate path.

### 5. Check the host before any link points at it

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://agents.lifeleadsplus.com/
#   302 https://agents.lifeleadsplus.com/login     (NOT agents.netenroll.com)
curl -sS -o /dev/null -w '%{http_code}\n' https://agents.lifeleadsplus.com/login
#   200
curl -sS 'https://agents.lifeleadsplus.com/api/v1/public/brand?host=nobody.example'
#   {"data":null}       -- JSON from the API (:3001), not the web app's HTML
node scripts/check-ws-proxy.mjs wss://agents.lifeleadsplus.com/ws
#   ok  wss://agents.lifeleadsplus.com/ws completed a WebSocket handshake and negotiated `sip`
node scripts/check-ws-proxy.mjs
#   ok  wss://agents.netenroll.com/ws ...   (unchanged)
```

### 6. Configure the Life Leads Plus tenant

The parent tenant needs:

| Field            | Value                      |
| ---------------- | -------------------------- |
| `whiteLabel`     | `true`                     |
| `brandTheme`     | `life-leads-plus`          |
| `brandName`      | `Life Leads Plus`          |
| `domain`         | `agents.lifeleadsplus.com` |
| `parentTenantId` | `null` (unchanged)         |

**Preferred: the platform screen, which writes an audit row.** Sign in to
`https://agents.netenroll.com` as a platform admin and open **Agencies**
(`/admin/agencies`). Open _Life Leads Plus_ and, in its brand controls:

1. switch on **White-label tier**,
2. choose **Brand theme → Life Leads Plus** and **Save brand theme**,
3. enter `agents.lifeleadsplus.com` in **Portal domain** and **Save domain**.

These controls call `PATCH /api/v1/admin/tenants/:tenantId/branding`
(platform admins only, audited as `platform.tenant.brand_changed`). The route
normalises the host. It refuses `agents.netenroll.com`, a host another agency
already owns (409), and any domain on a child agency.

**Alternative: psql.** This writes no audit row. Use it only if the screen is
unavailable:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
BEGIN;
-- Exactly one top-level tenant named Life Leads Plus, or nothing changes.
DO $$ BEGIN
  IF (SELECT count(*) FROM tenants WHERE name = 'Life Leads Plus' AND "parentTenantId" IS NULL) <> 1 THEN
    RAISE EXCEPTION 'expected exactly one top-level tenant named Life Leads Plus';
  END IF;
END $$;
UPDATE tenants
   SET domain = 'agents.lifeleadsplus.com',
       "whiteLabel" = true,
       "brandTheme" = 'life-leads-plus',
       "brandName" = 'Life Leads Plus',
       "updatedAt" = now()
 WHERE name = 'Life Leads Plus' AND "parentTenantId" IS NULL;
COMMIT;
SQL
```

**Child agencies need no configuration.** Life Leads Plus creates them under
**Network → Agencies**, which sets `parentTenantId` to the parent. Do not give
them a domain. Each child stays its own tenant, with its own users, agents,
calls and data.

The login page brand cache clears on the save (or within 5 minutes, after a
psql change).

### 7. Google sign-in (only if used)

If agents use **Sign in with Google**, add `https://agents.lifeleadsplus.com`
to **Authorized JavaScript origins** of the OAuth client
(`NEXT_PUBLIC_GOOGLE_CLIENT_ID`) in Google Cloud Console. Keep the existing
`https://agents.netenroll.com` origin.

## Verification

```bash
curl -s 'https://agents.lifeleadsplus.com/api/v1/public/brand?host=agents.lifeleadsplus.com'
#   {"data":{"theme":"life-leads-plus","name":"Life Leads Plus"}}
curl -s 'https://agents.netenroll.com/api/v1/public/brand?host=agents.netenroll.com'
#   {"data":null}     (NetEnroll)
```

Then, in a browser:

1. **NetEnroll:** `https://agents.netenroll.com` redirects to `/login`, shows
   the NetEnroll logo, title and favicon, and sign-in works.
2. **Life Leads Plus:** `https://agents.lifeleadsplus.com` stays on
   `agents.lifeleadsplus.com/login` and shows the Life Leads Plus logo, colours,
   tab title and favicon. The Life Leads Plus owner signs in and sees their own
   dashboard.
3. **Child agency:** a child agency's owner signs in at
   `agents.lifeleadsplus.com`. The portal is Life Leads Plus-branded and shows
   only that child's data. There is no Sales, Payouts or Network, and none of
   the parent's or sibling agencies' data.
4. **Softphone:** on `agents.lifeleadsplus.com`, open the phone as an agent. It
   registers (`fs_cli -x 'show registrations'` lists the extension), and a test
   call connects both ways.
5. **Invitations:** as the Life Leads Plus owner, invite an agent. The email
   (and the copy-link fallback) is `https://agents.lifeleadsplus.com/login?activation=…`.
   Do the same from a child agency and from a NetEnroll agency, whose link
   must be `https://agents.netenroll.com/…`.
6. **Password reset:** request a reset for a Life Leads Plus user, a child
   agency user and a NetEnroll user. The links are
   `https://agents.lifeleadsplus.com/reset-password?token=…` for the first two
   and `https://agents.netenroll.com/reset-password?token=…` for the third,
   whichever site the request was made from.
7. **Tenant isolation:** sign in as a child agency user on
   `agents.lifeleadsplus.com`. In DevTools → Network, the `/api/auth/me`
   response has that child's `tenantId`, not the parent's, and its lists show
   only that child's agents and calls. Sign in as a second child agency and
   confirm it sees none of the first one's. Sign in as a NetEnroll agency user
   on `agents.lifeleadsplus.com`. They are still their own agency with their
   own data. The host changes only the look, never the tenant.

## Rollback

Undo these steps in reverse order. Each one is independent.

1. **Links back to NetEnroll:** clear **Portal domain** on the Life Leads Plus
   agency (or, in psql,
   `UPDATE tenants SET domain = NULL WHERE domain = 'agents.lifeleadsplus.com';`).
   Links go back to `agents.netenroll.com`, and the brand on the NetEnroll host
   is unaffected.
2. **Stop serving the host:**
   ```bash
   sudo rm -f /etc/nginx/sites-enabled/agents.lifeleadsplus.com
   sudo nginx -t && sudo systemctl reload nginx
   ```
   `agents.netenroll.com` is unaffected. The certificate can stay, or
   `sudo certbot delete --cert-name agents.lifeleadsplus.com` removes it.
3. **DNS:** delete the `agents` A record in `lifeleadsplus.com`.
4. **Code:** `git checkout <previous-sha>` and re-run
   `scripts/deploy.sh --build api web`, or restore the images saved in step 1
   as in `docs/DEPLOY.md` Step 1.3. There is no schema change to reverse.
