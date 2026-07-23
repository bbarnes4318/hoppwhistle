# ENVIRONMENT VARIABLE MAP

> Prompt 0 — Read-only runtime audit. Grounded in current code at commit `130416d`. Collated from `process.env.*` usage across `apps/api`, `apps/worker`, `apps/web`, `apps/media`, `apps/monitor` and the compose files. Service tags: **A**=api, **W**=worker, **Wb**=web, **M**=media/transcriber, **Mon**=monitor, **FS**=freeswitch container, **K**=kamailio. Nothing was changed.

**Deployment reality:** production runs `infra/docker/docker-compose.dev.yml` on Hetzner `178.156.223.97` via `deploy.ps1` (see `CURRENT_RUNTIME_MAP.md` §9). Defaults below are the compose-baked defaults where present. ⚠️ = weak/committed secret (see `MULTITENANT_GAP_ANALYSIS.md` §7).

---

## Database / Analytics

| Var                                       | Svc   | Purpose                                     | Default                                                                          |
| ----------------------------------------- | ----- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`                            | A,W,M | Postgres DSN                                | `postgresql://callfabric:callfabric_dev@hopwhistle-postgres-dev:5432/callfabric` |
| `CLICKHOUSE_URL`                          | A,W   | ClickHouse HTTP                             | `http://clickhouse:8123`                                                         |
| `CLICKHOUSE_USER` / `CLICKHOUSE_PASSWORD` | A,W   | CH creds                                    | `default` / `clickhouse_dev` (empty in dev.yml) ⚠️                               |
| `CLICKHOUSE_DATABASE` / `CLICKHOUSE_DB`   | A,W   | CH database                                 | `hopwhistle_analytics` (base) / `hopwhistle` (dev) — inconsistent                |
| `DEFAULT_TENANT_ID`                       | A,W   | fallback tenant (websocket, simulate-calls) | —                                                                                |

## Redis

| Var         | Svc   | Purpose          | Default              |
| ----------- | ----- | ---------------- | -------------------- |
| `REDIS_URL` | A,W,M | Redis connection | `redis://redis:6379` |

## FreeSWITCH / Telephony

| Var                                                                         | Svc     | Purpose                                               | Default                                                            |
| --------------------------------------------------------------------------- | ------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `FREESWITCH_HOST` / `FREESWITCH_ESL_HOST`                                   | A,W,Mon | ESL host                                              | `freeswitch`                                                       |
| `FREESWITCH_ESL_PORT`                                                       | A,W     | ESL port                                              | `8021`                                                             |
| `FREESWITCH_ESL_PASSWORD`                                                   | A,W,FS  | ESL password                                          | `ClueCon` ⚠️ (hard-coded in compose + autodialer)                  |
| `RECORDING_CALLBACK_URL`                                                    | A/FS    | upload-recording.sh target                            | `http://<PUBLIC_IP>:3001/api/v1/recordings/uploaded`               |
| `PUBLIC_IP`                                                                 | A,FS,K  | public IP for SIP/media/callbacks                     | — (hard-coded `3.214.60.13` fallback in `vapi-carrier-service.ts`) |
| `SIP_DOMAIN` / `MEDIA_DOMAIN`                                               | A,FS    | SIP/media domains                                     | `freeswitch`                                                       |
| `OUTBOUND_SIP_PROXY` / `OUTBOUND_SIP_USER` / `OUTBOUND_SIP_PASS`            | A,W,FS  | wholesale SIP trunk                                   | —                                                                  |
| `OUTBOUND_CALLER_ID`                                                        | A,W,FS  | default caller-ID fallback                            | `12816991120` (A) / `+18656000124` (W) hard-coded literals         |
| `MAX_CONCURRENT_CALLS`                                                      | W       | Hopper concurrency cap                                | `10`                                                               |
| `DIALER_POLL_INTERVAL_MS`                                                   | W       | Hopper poll interval                                  | `1000`                                                             |
| `DIALER_BATCH_SIZE`                                                         | W       | Hopper batch size                                     | `50`                                                               |
| `SOCKET_LISTENER_HOST` / `SOCKET_LISTENER_PORT`                             | A,W     | Fronter Bot ESL bind (worker points FS at `api:8021`) | `api` / `8021`                                                     |
| `FRONTER_SOCKET_HOST` / `FRONTER_SOCKET_PORT`                               | A       | Fronter Bot socket server                             | `0.0.0.0` / `8021`                                                 |
| `FRONTER_DTMF_TIMEOUT_MS` / `FRONTER_INTRO_AUDIO` / `FRONTER_TRANSFER_DEST` | A       | Fronter Bot behavior                                  | `10000` / `ivr/ivr-welcome.wav` / `queue-default`                  |
| `VERTO_WS_URL`                                                              | A       | (vestigial) WS URL returned to client, discarded      | `wss://<PUBLIC_IP>:8082`                                           |
| `FREESWITCH_REALM`                                                          | A       | SIP realm                                             | `PUBLIC_IP` ?? `freeswitch`                                        |
| `NEXT_PUBLIC_SIP_DOMAIN` / `NEXT_PUBLIC_IP`                                 | Wb      | client SIP config                                     | —                                                                  |
| `RTPENGINE_URL` / `WORKER_CONCURRENCY`                                      | —       | dev compose                                           | —                                                                  |

## Carriers

| Var                                                                                                                                    | Svc    | Purpose                                   | Notes                                           |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------- | ----------------------------------------------- |
| `FONESTORM_USERNAME` / `FONESTORM_PASSWORD` / `FONESTORM_BASE_URL`                                                                     | A      | FracTEL/Fonestorm auth (fractel-adapter)  | primary active carrier                          |
| `BULKVS_USERNAME` / `BULKVS_PASSWORD` / `BULKVS_TRUNK_GROUP`                                                                           | A      | BulkVS (retired)                          | ⚠️ plaintext defaults in compose                |
| `ANVEO_API_KEY` / `ANVEO_EMAIL` / `ANVEO_SECURE_PHRASE`                                                                                | A      | Anveo (legacy inbound)                    | via `secrets.ts`                                |
| `SIGNALWIRE_PROJECT_ID` / `_API_TOKEN` / `_SPACE` / `_SIP_DOMAIN` / `_SIP_USERNAME` / `_SIP_PASSWORD` / `_OUTBOUND_PROXY` / `_SIP_URI` | A,FS,K | SignalWire (semi-active)                  | password also hard-coded in `signalwire.xml` ⚠️ |
| `TELNYX_API_KEY`                                                                                                                       | A      | Telnyx (dormant/provisioning)             | —                                               |
| `TWILIO_API_KEY` / `TWILIO_API_SECRET`                                                                                                 | A      | CNAM/carrier lookup (placeholder→Mock)    | not on call path                                |
| `DIGITALOCEAN_TOKEN` / `DEFAULT_PROVIDER`                                                                                              | A      | provisioning                              | —                                               |
| Bandwidth                                                                                                                              | A      | via provisioning adapter (keys passed in) | no direct env in adapter                        |

## Vapi + AI Voice (Dograh)

| Var                                         | Svc    | Purpose                                                                  | Default                                                         |
| ------------------------------------------- | ------ | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| `VAPI_API_KEY` / `VAPI_API_TOKEN`           | A,Wb   | Vapi cloud (legacy)                                                      | ⚠️ hard-coded fallback `b8c9e4...` in 3 `vapi-proxy` web routes |
| **`AIVOICE_URL`**                           | A      | canonical AI Voice app URL (iframe src)                                  | `https://aivoice.hopwhistle.com`                                |
| **`AIVOICE_JWT_SECRET`**                    | A      | HS256 secret for Dograh SSO JWT — **must equal Dograh `OSS_JWT_SECRET`** | — (route 503s if unset)                                         |
| **`AIVOICE_COOKIE_DOMAIN`**                 | A      | SSO cookie domain                                                        | `.hopwhistle.com`                                               |
| `AIVOICE_TOKEN_TTL_HOURS`                   | A      | SSO token TTL                                                            | `24`                                                            |
| `AIVOICE_DEFAULT_USER_ID`                   | A      | shared Dograh workspace user (Phase-2)                                   | `1`                                                             |
| (Dograh side, out of repo) `OSS_JWT_SECRET` | Dograh | must match `AIVOICE_JWT_SECRET`                                          | —                                                               |

## Auth / Secrets

| Var                                                                       | Svc     | Purpose                                        | Default                                        |
| ------------------------------------------------------------------------- | ------- | ---------------------------------------------- | ---------------------------------------------- |
| `JWT_SECRET`                                                              | A       | JWT + session + CSRF signing                   | `change-me` / `35353535` / `dev-secret-...` ⚠️ |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL`                                        | Wb      | NextAuth                                       | `change-me` ⚠️ / `https://hopwhistle.com`      |
| `SIP_AGENT_PASSWORD`                                                      | A       | agent softphone SIP password                   | `1234` ⚠️ (see memory)                         |
| `FIELD_ENCRYPTION_KEY`                                                    | A       | field-level encryption (gates encrypt/decrypt) | —                                              |
| `BANKING_ENCRYPTION_KEY`                                                  | A       | banking-detail encryption                      | —                                              |
| `CSRF_SECRET`                                                             | A       | CSRF (falls back to `JWT_SECRET`)              | —                                              |
| `API_KEY` / `NEXT_PUBLIC_API_KEY` / `VALID_API_KEYS` / `INTERNAL_API_KEY` | A,Wb,FS | API-key auth                                   | `demo-key` ⚠️                                  |
| `AMERICAN_AMICABLE_AGENT_ID` / `_PASSWORD` / `_SIGNATURE_NAME`            | A       | carrier RPA creds                              | via `.env`                                     |
| `AUTOMATION_TEST_MODE` / `PUPPETEER_EXECUTABLE_PATH`                      | A       | RPA controls                                   | `/usr/bin/chromium-browser`                    |

## Storage

| Var                                                                                                   | Svc   | Purpose                                | Default                                                                                                             |
| ----------------------------------------------------------------------------------------------------- | ----- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` / `S3_FORCE_PATH_STYLE` | A,FS  | MinIO/S3 recordings                    | `http://minio:9000` / `recordings`\|`hopwhistle-recordings` (inconsistent) / `minioadmin` ⚠️ / `us-east-1` / `true` |
| `LOCAL_STORAGE_DIR`                                                                                   | A     | local disk fallback if S3 creds absent | `/tmp/uploads`                                                                                                      |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`                                                             | infra | MinIO root                             | `minioadmin` ⚠️                                                                                                     |
| `RECORDING_HOT_TO_WARM_DAYS` / `_WARM_TO_COLD_DAYS` / `_RETENTION_DAYS` / `_LIFECYCLE_ENABLED`        | A     | recording lifecycle tiering            | `30` / `90` / `365` / on                                                                                            |
| `RECORDING_PROCESSING_TIMEOUT_MS`                                                                     | A     | reconciler stale threshold             | `60000`                                                                                                             |
| `RECORDINGS_FORMAT`                                                                                   | FS    | recording format                       | `wav`                                                                                                               |

## Billing / Stripe

| Var                                    | Svc | Purpose                 |
| -------------------------------------- | --- | ----------------------- |
| `STRIPE_SECRET_KEY` / `STRIPE_ENABLED` | W   | Stripe (billing worker) |

## AI / Transcription

| Var                                                                                                                                              | Svc | Purpose                  | Default                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | --- | ------------------------ | ------------------------------------------------------------- |
| `DEEPSEEK_API_KEY` / `DEEPSEEK_ENDPOINT` / `DEEPSEEK_MODEL`                                                                                      | A,W | recording analysis / LLM | `https://api.deepseek.com/chat/completions` / `deepseek-chat` |
| `DEEPGRAM_API_KEY`                                                                                                                               | A   | TTS/STT (bot)            | —                                                             |
| `OPENAI_API_KEY`                                                                                                                                 | A   | OpenAI                   | —                                                             |
| `TRANSCRIBE_MAX_CONCURRENCY` / `_MAX_DURATION_SEC` / `_ENGINE_PREF`, `PYTHON_BIN` / `PY_SVC_TIMEOUT_MS` / `PYTHON_WORKDIR`, `TEST_LONG_FILE_URL` | M   | transcriber              | —                                                             |

## Compliance / Leads

| Var                                                                                          | Svc | Purpose                   |
| -------------------------------------------------------------------------------------------- | --- | ------------------------- |
| `TCPA_API_KEY` / `TCPA_API_SECRET`                                                           | A   | TCPA litigator validation |
| `TRUSTEDFORM_API_KEY` / `JORNAYA_API_KEY`                                                    | A   | lead consent proof        |
| `INSURANCE_LEAD_MODE`, `AMERIQUOTE_API_KEY` / `_ACA_SRC` / `_FE_SRC`, `LIVE_STATUS_PROVIDER` | A   | insurance lead pipeline   |

## Email / Observability / Misc

| Var                                                                    | Svc | Purpose               | Default                                                                 |
| ---------------------------------------------------------------------- | --- | --------------------- | ----------------------------------------------------------------------- |
| `SMTP_HOST` / `PORT` / `USER` / `PASSWORD` / `FROM`                    | A   | publisher email       | —                                                                       |
| `JAEGER_ENDPOINT` / `ENABLE_TRACING`                                   | A,W | tracing               | `http://jaeger:14268/api/traces` / on (`ENABLE_TRACING=false` disables) |
| `METRICS_PORT`                                                         | W   | worker metrics server | `9091`                                                                  |
| `LOG_LEVEL` / `DEBUG` / `NODE_ENV`                                     | all | logging / env mode    | —                                                                       |
| `PORT` / `HOST`                                                        | A   | API bind              | `3001` / `0.0.0.0`                                                      |
| `NEXT_PUBLIC_API_URL` / `_WS_URL` / `_APP_NAME` / `_DISABLE_WEBSOCKET` | Wb  | client config         | `https://hopwhistle.com` / `wss://hopwhistle.com`                       |

---

## Env-based toggles/kill-switches actually read in code (today)

`ENABLE_TRACING`, `RECORDING_LIFECYCLE_ENABLED`, `FIELD_ENCRYPTION_KEY` (presence gates encryption), `VAPI_API_KEY`/`VAPI_API_TOKEN` (presence gates Vapi), `FONESTORM_*` (FracTEL enablement), `S3_ACCESS_KEY`/`S3_SECRET_KEY` (presence selects S3 vs local disk), `STRIPE_ENABLED`, `NODE_ENV` (cookie `secure`, swagger path), `AUTOMATION_TEST_MODE`.

## ⚠️ Required SaaS kill switches that DO NOT yet exist (Master Contract)

`SAAS_CONTROL_PLANE_ENABLED`, `TENANT_DIALER_V2_ENABLED`, `TENANT_DIALER_V2_ORIGINATE_ENABLED`, `TENANT_DIALER_V2_ALLOWED_TENANT_IDS` (empty ⇒ none), `SUBSCRIPTION_BILLING_ENABLED`, `MANAGED_TELECOM_ENABLED`, `CUSTOM_DOMAINS_ENABLED`. These must be introduced (default off) before any SaaS capability originates calls or bills tenants.

## Notes / hazards

- Bucket name mismatch: `storage.ts` default `recordings` vs base compose `hopwhistle-recordings` — can strand recording files.
- `docker-compose.dev.yml:140` mounts a stray `rating (9) (1).xlsx` into the api container.
- `DEPLOYMENT_ENV_VARS.md` is the intended reference but predates several vars above (esp. `AIVOICE_*`, `FONESTORM_*`).
- The runtime `.env` at repo root is **not** git-tracked (only `.env.voice.example` is).
