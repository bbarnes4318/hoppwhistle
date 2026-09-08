# agents.netenroll.com -- the agency portal.
#
# Deploy to /etc/nginx/sites-available/agents.netenroll.com and symlink into
# sites-enabled. This file is the source of truth; the copy on the box is not.
#
# Three things in here are load-bearing and are called out where they appear:
# the /ws proxy, `Host $host`, and the root redirect. Read those comments before
# changing anything, because two of the three fail silently.

server {
    listen 80;
    server_name agents.netenroll.com;

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
    server_name agents.netenroll.com;

    ssl_certificate /etc/letsencrypt/live/agents.netenroll.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/agents.netenroll.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # The root is the portal's front door, and the portal has no marketing page.
    # Everyone arriving at https://agents.netenroll.com/ wants to sign in.
    #
    # 302, not 301. A 301 is cached by the browser forever and cannot be walked
    # back without asking every user to clear their cache, so it must not be
    # used for a redirect we might reverse -- for instance if the root ever
    # becomes a real page again.
    location = / {
        return 302 /login;
    }

    # WebSocket for SIP, proxied to FreeSWITCH's ws binding.
    #
    # THIS BLOCK IS NOT OPTIONAL. The softphone builds its signalling URL from
    # the hostname in the address bar -- `wss://<window.location.hostname>/ws`,
    # see apps/web/src/components/phone/phone-provider.tsx -- so on this host it
    # dials wss://agents.netenroll.com/ws and nowhere else. Without this block
    # every agent softphone fails to register: no REGISTER is ever sent, the
    # agent still shows as available in the dashboard, and every call to them
    # dies with USER_NOT_REGISTERED.
    #
    # All four headers below are required, and each has its own failure:
    #   Upgrade / Connection      -- without them nginx never performs the
    #                                WebSocket handshake and the socket 400s.
    #   Host                      -- see the note in `location /`.
    #   Sec-WebSocket-Protocol    -- FreeSWITCH refuses a WebSocket that does
    #                                not negotiate the `sip` subprotocol.
    # Keep them identical to the hopwhistle block in this directory. The two
    # hosts share one FreeSWITCH.
    #
    # 8083 is the plaintext ws binding, terminated by TLS here. The long
    # timeouts hold the registration socket open between calls; the default 60s
    # read timeout would tear down every idle agent once a minute.
    location /ws {
        proxy_pass http://127.0.0.1:8083;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header Sec-WebSocket-Protocol sip;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
    }

    # API
    location /api {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Frontend
    location / {
        # Next.js server actions compare the browser's `origin` against
        # `x-forwarded-host`, falling back to `host`, and abort the action when
        # the two disagree. Keep `Host $host` as it is. If you ever add
        # `X-Forwarded-Host` it MUST be the public hostname the browser used —
        # anything else makes every server action fail with "Invalid Server
        # Actions request". The buyer pages do not rely on this to stay safe
        # (their write actions take the bearer token as an explicit argument),
        # but they do rely on it to keep working.
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
