# VOICE AI INTEGRATION AUDIT (Prompt 0 correction)

> Prompt 0 — Read-only runtime audit, Voice AI correction. Grounded in current code at commit `130416d` plus one read-only HTTP header probe of the live site. No production behavior, no live Voice AI application, and no production proxy/auth/provider config was modified. This document supersedes the earlier Vapi-centric Voice AI assumptions.

---

## Required final statement (up front)

- **`aivoice.hopwhistle.com` is the canonical Voice AI application.** It is a self-hosted **Dograh** (Next.js) app running on the server at `/opt/dograh`, entirely **outside this repository** (no source, no submodule, no compose build context here).
- **Is the old `/voice-agents` implementation still used?** The **page** at `/voice-agents` is current and live — but as of HEAD commit `130416d` it no longer renders the old Vapi UI; it **iframes the canonical AI Voice app**. The old **Vapi stack** (`ai-campaigns`, `music-console-voice`, `vapi-proxy`) is **legacy and orphaned from the sidebar** (reachable only by direct URL), still registered on the API but effectively dormant.
- **Does the live AI Voice app depend on the main Hopwhistle backend?** **No, except for SSO.** Dograh has its own backend, datastore, and telephony. The only coupling is `GET /api/v1/aivoice/session`, which mints a Dograh session cookie so the iframe lands authenticated. It does **not** use `/api/v1/ai-campaigns`, `/api/v1/webhooks/vapi`, the AI-campaign tables, or the `PhoneNumber` inventory.
- **Safest method to display the canonical app from the Voice AI menu:** the **secure iframe** already implemented (Option 3), because the live site sends **no `X-Frame-Options` and no CSP `frame-ancestors`** (framing not blocked), the SSO cookie is already scoped to `.hopwhistle.com` (same-site → flows into the iframe), and the page already requests `allow="microphone; autoplay; clipboard-write"`. A **same-origin reverse proxy under `/voice-agents`** (Option 1) is the recommended hardening fallback if third-party-cookie policies tighten.
- **Files/systems that must not change:** `apps/api/src/routes/aivoice.ts`, `apps/api/src/lib/aivoice-jwt.ts`, `apps/api/src/index.ts:351-353`, `apps/web/src/app/(dashboard)/voice-agents/page.tsx`, the "AI Voice" sidebar item (`apps/web/src/components/layout/sidebar.tsx`), env `AIVOICE_JWT_SECRET`/`AIVOICE_URL`/`AIVOICE_COOKIE_DOMAIN`/`AIVOICE_DEFAULT_USER_ID`/`AIVOICE_TOKEN_TTL_HOURS`, and (out of repo) the `aivoice.hopwhistle.com` nginx vhost + `/opt/dograh` + Dograh's `OSS_JWT_SECRET`. Do **not** delete the legacy Vapi files during Prompt 0.
- **Next implementation prompt required:** a small, flag-gated "harden the AI Voice embed" task — verify/keep the live framing headers permissive to `hopwhistle.com`, confirm `AIVOICE_JWT_SECRET == OSS_JWT_SECRET` in the deployed env, handle iframe session-expiry/re-SSO, add responsive sizing, and prepare the reverse-proxy fallback. See §7.

---

## 1. What the repo actually contributes

The main repo holds only the **SSO glue + iframe**, three artifacts:

1. **SSO route** — [`apps/api/src/routes/aivoice.ts`](../../apps/api/src/routes/aivoice.ts), registered at `index.ts:351-353`.
   - `GET /api/v1/aivoice/session` (line 44), auth-gated (401 unless `request.user.userId`/`tenantId`).
   - Mints a Dograh JWT via `signDograhToken`; sets cookies:
     - `dograh_auth_token` = the JWT
     - `dograh_auth_user` = JSON `{ id, name, email, provider:'local' }`
     - options: `domain=.hopwhistle.com` (`AIVOICE_COOKIE_DOMAIN`), `path=/`, `httpOnly:true`, `secure:true`, `sameSite:'lax'`, `maxAge = AIVOICE_TOKEN_TTL_HOURS*3600` (default 24h).
   - Returns `{ url: AIVOICE_URL }` (`AIVOICE_URL` default `https://aivoice.hopwhistle.com`).
   - 503 `AIVOICE_NOT_CONFIGURED` if `AIVOICE_JWT_SECRET` unset (lines 53-58).
   - Phase-2 shared workspace: `DEFAULT_DOGRAH_USER_ID = AIVOICE_DEFAULT_USER_ID || '1'` (line 24); `resolveWorkspace()` (32-41) is a stub that maps **every** Hopwhistle user to Dograh user `1`. Per-user provisioning is a Phase-3 TODO.

2. **JWT signer** — [`apps/api/src/lib/aivoice-jwt.ts`](../../apps/api/src/lib/aivoice-jwt.ts): `signDograhToken` (line 25) — **HS256**, header `{alg:'HS256',typ:'JWT'}`, payload `{ sub:String(userId), email, iat, exp }`, HMAC-SHA256 via Node `crypto`. Comment (lines 7-12): must match Dograh's `api/utils/auth.py create_jwt_token` and `OSS_JWT_SECRET`.

3. **Iframe page** — [`apps/web/src/app/(dashboard)/voice-agents/page.tsx`](<../../apps/web/src/app/(dashboard)/voice-agents/page.tsx>): client component `AIVoicePage`. On mount calls `apiClient.get('/v1/aivoice/session')` (line 25), then renders `<iframe src={url} title="AI Voice" allow="microphone; autoplay; clipboard-write" />` (lines 60-67) with loading/error states.

Sidebar "AI Voice" nav item → `/voice-agents` (`apps/web/src/components/layout/sidebar.tsx`).

---

## 2. Answers to the 18 correction questions

| #   | Question                                               | Answer (repo-grounded)                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Which repo contains the app at aivoice.hopwhistle.com? | **External** — not this repo. No `.gitmodules`, no `dograh/**`, no dograh build context. Runs at `/opt/dograh` (memory).                                                                                                                                                                      |
| 2   | Which branch/commit is deployed there?                 | **NOT DETERMINABLE FROM REPO** — check `git -C /opt/dograh rev-parse HEAD` + remote on the server.                                                                                                                                                                                            |
| 3   | Uses main Hopwhistle backend (apps/api)?               | **No**, except `GET /api/v1/aivoice/session`. Dograh has its own backend (`api/auth/oss`, its middleware).                                                                                                                                                                                    |
| 4   | Uses `/api/v1/ai-campaigns`?                           | **No.** Those are called only by the legacy `(dashboard)/ai-campaigns/**` pages.                                                                                                                                                                                                              |
| 5   | Uses `/api/v1/webhooks/vapi`?                          | **No.** That belongs to the legacy Vapi campaign flow.                                                                                                                                                                                                                                        |
| 6   | Uses ai_campaigns / \_contacts / \_calls tables?       | **No.** Dograh has its own datastore.                                                                                                                                                                                                                                                         |
| 7   | Uses the PhoneNumber inventory?                        | **No repo evidence.** Dograh manages its own caller-ID pool (Phase-3 TODO describes provisioning _inside_ Dograh).                                                                                                                                                                            |
| 8   | Shares auth with hopwhistle.com?                       | **Yes, via SSO cookie shim** (see §1.1). HS256 JWT + `dograh_auth_user` cookie on `.hopwhistle.com`.                                                                                                                                                                                          |
| 9   | Same users & tenants?                                  | **No — single shared workspace** today (`AIVOICE_DEFAULT_USER_ID='1'`, `resolveWorkspace` stub). Every Hopwhistle user → Dograh user 1.                                                                                                                                                       |
| 10  | Cookies vs JWT vs other; what is AIVOICE_URL?          | **JWT-in-cookie** (two cookies). `AIVOICE_URL` = iframe src, default `https://aivoice.hopwhistle.com`.                                                                                                                                                                                        |
| 11  | Can it run under `/voice-agents` same-origin?          | As built it runs on its **own subdomain via iframe**, not reverse-proxied. No `/voice-agents` proxy or aivoice vhost exists in `infra/nginx/hopwhistle`. Same-origin proxy is possible but unbuilt.                                                                                           |
| 12  | WebSockets / streaming / mic / audio?                  | Iframe requests `microphone; autoplay; clipboard-write` (page.tsx:65) ⇒ mic + audio needed. Dograh is a realtime voice-agent builder ⇒ WebSockets/streaming near-certain. **Verify on the live app.**                                                                                         |
| 13  | Permits being embedded?                                | **NOT DETERMINABLE FROM REPO** (no framing config in-repo). **Live probe: YES** — see §3.                                                                                                                                                                                                     |
| 14  | Current CSP / X-Frame-Options in-repo?                 | **None.** `infra/nginx/hopwhistle` sets no framing headers for either vhost; `apps/api` sets none. Whatever Dograh's own server emits governs it.                                                                                                                                             |
| 15  | Safest architecture?                                   | **Secure iframe now** (cookie domain + page already built for it), **reverse proxy as hardening fallback**. Shared mount N/A (separate codebase). See §4.                                                                                                                                     |
| 16  | What does `/voice-agents` do now (post-HEAD)?          | **Iframes the AI Voice app** — not the old Vapi UI. (see §1.3).                                                                                                                                                                                                                               |
| 17  | Is `/voice-agents` legacy or live?                     | **Current & live** entry point to canonical AI Voice (via SSO→iframe). The legacy pages are `(dashboard)/ai-campaigns/**`.                                                                                                                                                                    |
| 18  | Files to protect + legacy used/unused.                 | Protect: the three SSO artifacts + sidebar item + `AIVOICE_*` env + (out of repo) aivoice vhost & `/opt/dograh`. Legacy Vapi routes are **wired but dormant** (no UI entry); do not delete without confirming nothing external still calls `/api/v1/webhooks/vapi` or `/api/v1/ai-campaigns`. |

---

## 3. Live header probe (read-only GET, `2026-07-18`)

Probe of `https://aivoice.hopwhistle.com/`:

- Status `200 OK`, **final URL `/auth/login`** (unauthenticated root redirects to login → the app has its own auth; SSO cookie lets the iframe skip this).
- `Server: nginx/1.24.0 (Ubuntu)`, `X-Powered-By: Next.js`, `Cache-Control: private, no-cache, no-store`.
- **No `X-Frame-Options` header. No `Content-Security-Policy` header.** ⇒ Framing is **not blocked** at the HTTP level today; no `frame-ancestors` allow-list is enforced either way.

**Implication:** a cross-subdomain iframe of `aivoice.hopwhistle.com` inside `hopwhistle.com` is not blocked, and because both share the registrable domain `hopwhistle.com` (same-site), the `.hopwhistle.com` SSO cookie (SameSite=Lax, Secure) is delivered to the framed app. The embed works today. The **risk** is that if Dograh later adds `X-Frame-Options: DENY/SAMEORIGIN` or a restrictive CSP, the iframe breaks — so this must be monitored / pinned.

---

## 4. Implementation-option evaluation

| Option                                                                         | Verdict                                        | Rationale                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **1. Same-origin reverse proxy** (`hopwhistle.com/voice-agents` serves Dograh) | **Recommended hardening fallback**             | Most robust against third-party-cookie/SameSite tightening and any future framing headers (no cross-origin at all). But **not built**: needs a new nginx location proxying to Dograh, handling `/_next/static` asset paths, WebSocket upgrade, and Dograh base-path/cookie-domain rewriting. Higher effort + telephony-adjacent risk. Defer to a dedicated prompt. |
| **2. Shared application mounting** (same code both places)                     | **Not applicable**                             | Dograh is a separate codebase/framework at `/opt/dograh`; nothing to mount from this repo.                                                                                                                                                                                                                                                                         |
| **3. Secure iframe**                                                           | **✅ Current design — safest low-effort path** | Already implemented; live headers permit framing; SSO cookie already `.hopwhistle.com`; page already grants mic/autoplay. Remaining checks: framing headers stay permissive, `AIVOICE_JWT_SECRET==OSS_JWT_SECRET`, cookie names/claims match deployed Dograh, third-party-cookie behavior, session-expiry re-SSO, responsive sizing.                               |
| **4. Direct redirect** (`/voice-agents` → `aivoice.hopwhistle.com`)            | **Fallback only, not desired**                 | Loses the in-app menu experience (leaves the Hopwhistle shell). Acceptable as a temporary degrade if the iframe is ever blocked.                                                                                                                                                                                                                                   |

**Recommendation:** keep the **secure iframe (Option 3)** as the shipped experience; plan the **reverse proxy (Option 1)** as a hardening follow-up. Do not implement either during Prompt 0.

---

## 5. Is the SSO embed complete?

**Structurally complete for Phase 2, pending live/infra verification.** The full chain exists: sidebar → `/voice-agents` → auth-gated SSO route (mints HS256 JWT, sets `.hopwhistle.com` cookies) → `{ url }` → iframe loads `aivoice.hopwhistle.com` authenticated. My live probe confirms framing is not blocked. What remains (§7) is verification + hardening, not new construction.

---

## 6. Protected files/systems (breaking any breaks live AI Voice)

In-repo: `apps/api/src/routes/aivoice.ts`, `apps/api/src/lib/aivoice-jwt.ts`, `apps/api/src/index.ts:351-353`, `apps/web/src/app/(dashboard)/voice-agents/page.tsx`, `apps/web/src/components/layout/sidebar.tsx` (AI Voice item). Env: `AIVOICE_JWT_SECRET`, `AIVOICE_URL`, `AIVOICE_COOKIE_DOMAIN`, `AIVOICE_DEFAULT_USER_ID`, `AIVOICE_TOKEN_TTL_HOURS`. Out of repo: the `aivoice.hopwhistle.com` nginx vhost + framing headers, `/opt/dograh` app, Dograh `OSS_JWT_SECRET`. **`docker-compose.voice.yml` is the SIP/FreeSWITCH voice edge — NOT the Dograh app — and is unrelated to this feature.** Do not delete legacy Vapi files during Prompt 0.

---

## 7. Next implementation prompt (recommended — do NOT run in Prompt 0)

> **Prompt N — Harden the AI Voice embed** (flagged behind `white_label_branding_v1`/`saas_control_plane_v1` where relevant, additive only):
>
> 1. Confirm on the server that `aivoice.hopwhistle.com` sends `CSP: frame-ancestors https://hopwhistle.com` (or at minimum no `X-Frame-Options: DENY`) and pin it so a Dograh upgrade can't silently break the embed.
> 2. Verify `AIVOICE_JWT_SECRET` is set on the api container and equals Dograh's `OSS_JWT_SECRET`; verify Dograh reads `dograh_auth_token`/`dograh_auth_user` with the exact claim/JSON shape.
> 3. Handle iframe **session expiry** — re-call `/api/v1/aivoice/session` on 401/expiry and reload the frame.
> 4. Add responsive sizing + a graceful error/redirect fallback (Option 4) if the frame fails to load.
> 5. Prepare (design only) the Option 1 reverse-proxy path as the third-party-cookie hardening fallback.
> 6. Phase-3 (separate): replace the shared `resolveWorkspace` stub with per-tenant Dograh workspace provisioning for true multi-tenant isolation.

No live Voice AI application, sidebar, `/voice-agents`, authentication, production proxy, or provider integration is changed during Prompt 0.
