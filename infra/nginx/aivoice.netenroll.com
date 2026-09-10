# aivoice.netenroll.com -- the AI Voice app (Dograh), on the portal's domain.
#
# Deploy to /etc/nginx/sites-available/aivoice.netenroll.com and symlink into
# sites-enabled. This file is the source of truth; the copy on the box is not.
#
# ── Why this vhost exists ────────────────────────────────────────────────────
#
# /voice-agents in the portal is an iframe around this app, and it is signed in
# by a cookie the portal's API mints (`apps/api/src/routes/aivoice.ts`). That
# handoff is a browser same-site question, not a configuration string:
#
#   * A response from agents.netenroll.com may only set a cookie whose Domain is
#     that host or a parent of it. `.hopwhistle.com` is neither, so while the AI
#     Voice app was served from aivoice.hopwhistle.com the browser dropped both
#     Set-Cookie headers silently.
#   * Even correctly scoped, a frame on a different registrable domain is
#     cross-site, and SameSite=Lax cookies are not sent into one at all.
#
# It worked before the portal moved because hopwhistle.com and
# aivoice.hopwhistle.com shared one registrable domain. Serving the same app at
# aivoice.netenroll.com restores exactly that property for agents.netenroll.com,
# and nothing else about the SSO has to change.
#
# Set these together in the portal's .env when this vhost goes live -- the route
# file says the same thing, because they must always name the same host:
#
#     AIVOICE_URL=https://aivoice.netenroll.com
#     AIVOICE_COOKIE_DOMAIN=.netenroll.com
#
# ── Before you enable it ─────────────────────────────────────────────────────
#
# The authoritative reference for what this app needs from a proxy is the
# aivoice.hopwhistle.com vhost already on the box. DIFF THIS AGAINST IT before
# enabling, and carry over anything it does that this does not -- the upstream
# ports below are read from `docker compose ps` in /opt/dograh and are the
# published ports of dograh-ui-1 and dograh-api-1, but that app's routing is
# outside this repository and can change without anything here noticing.
#
#     diff /etc/nginx/sites-available/aivoice.hopwhistle.com \
#          /etc/nginx/sites-available/aivoice.netenroll.com
#
# Full runbook, including DNS and the certificate: docs/AIVOICE_DOMAIN_MOVE.md

server {
    listen 80;
    server_name aivoice.netenroll.com;

    # Let's Encrypt renewal. Must stay above the redirect: certbot's HTTP-01
    # challenge is served over port 80 and a blanket 301 fails the renewal.
    location /.well-known/acme-challenge/ {
        root /var/www/hopwhistle;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl;
    server_name aivoice.netenroll.com;

    ssl_certificate /etc/letsencrypt/live/aivoice.netenroll.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/aivoice.netenroll.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # A voice agent builder streams audio. Do not lower these.
    client_max_body_size 100M;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;

    # ── Framing ──────────────────────────────────────────────────────────────
    #
    # The whole point of this vhost is to be embedded by the portal, so the
    # portal is named as the only permitted frame-ancestor. `frame-ancestors`
    # supersedes X-Frame-Options in every browser that supports it, but a
    # stray X-Frame-Options: DENY from the upstream would still be obeyed by
    # older ones -- so drop whatever the app sends and state the policy here.
    #
    # This is a deliberate narrowing, not a loosening: before this, framing was
    # governed by whatever Dograh happened to emit, which the audit recorded as
    # "no X-Frame-Options and no CSP frame-ancestors" -- framable by anyone.
    proxy_hide_header X-Frame-Options;
    proxy_hide_header Content-Security-Policy;
    add_header Content-Security-Policy "frame-ancestors https://agents.netenroll.com;" always;

    # ── The app's own API ────────────────────────────────────────────────────
    #
    # Ahead of `location /` because nginx prefix-matching takes the longest
    # match, and the UI's calls must not be answered by the UI container.
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # ── The UI ───────────────────────────────────────────────────────────────
    #
    # `Host $host` rather than the upstream's name: a Next.js app builds its own
    # absolute URLs and redirects from the Host it is given, and handing it
    # 127.0.0.1 sends the browser to 127.0.0.1. This is the same trap called out
    # in the agents.netenroll.com vhost, and it fails silently there too.
    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
