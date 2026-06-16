# Walkthrough - Hetzner Migration Preparation

We have successfully prepared the Hoppwhistle repository for immediate migration from AWS to Hetzner by parameterizing all hardcoded AWS public IP references, cleaning up stale Vultr references, updating environment variable templates, and providing a comprehensive step-by-step migration guide.

## Changes Made

### 1. FreeSWITCH Parameterization
*   **`apps/freeswitch/conf/vars.xml`**: Replaced the hardcoded AWS public IP (`3.214.60.13`) with environment-driven variables `${PUBLIC_IP}`, `${SIP_PUBLIC_IP}`, and `${SIP_DOMAIN}`.
*   **`apps/freeswitch/docker-entrypoint.sh`**: Added dynamic substitution for `SIP_PUBLIC_IP` and `SIP_DOMAIN` on startup.
*   **`apps/freeswitch/conf/sip_profiles/external.xml`**: Updated `ext-rtp-ip` and `ext-sip-ip` parameters to use `$${sip_public_ip}`.
*   **`apps/freeswitch/conf/sip_profiles/vapi.xml`**: Updated `ext-rtp-ip` and `ext-sip-ip` parameters to use `$${sip_public_ip}`.
*   **`apps/freeswitch/conf/dialplan/default.xml`**: Parameterized `sofia_contact` bridge target domain using `$${domain}`.
*   **`apps/freeswitch/conf/dialplan/public.xml`**: Parameterized the inbound DID domain and `sofia_contact` bridge target domain using `$${domain}`.
*   **`apps/freeswitch/scripts/inbound_route.lua`**: Modified the Lua routing script to dynamically query the `domain_name` channel variable instead of using the hardcoded AWS public IP.

### 2. Frontend Configuration
*   **`apps/web/src/components/phone/phone-provider.tsx`**: Replaced the hardcoded AWS public IP fallback with `process.env.NEXT_PUBLIC_SIP_DOMAIN` and a dynamic fallback to `window.location.hostname`.

### 3. Vultr Stale Reference Cleanup
*   **`infra/nginx/hopwhistle`**: Modified Host headers from the stale Vultr IP `45.32.213.201` to use the dynamic `$host` variable.
*   **`apps/media/__tests__/integration.test.ts` & `apps/worker/src/__tests__/billing-integration.test.ts`**: Replaced legacy Vultr database connection string fallbacks with a local connection string fallback.
*   **`scripts/vapi_provision_and_call.js`**: Parameterized host variables and removed hardcoded Vapi tokens.
*   **`apps/api/run-ssh-query.ps1`**: Updated the ssh target to use the `$env:PUBLIC_IP` variable.

### 4. Environment Templates
*   Added the required Hetzner S3, URLs, and IP variables to `infra/docker/env.example`, `infra/docker/env.template`, `apps/api/env.example`, and `apps/web/env.example`.

### 5. Migration Guide Playbook
*   Created [HETZNER_MIGRATION_FROM_AWS.md](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/HETZNER_MIGRATION_FROM_AWS.md) in the workspace root detailing definitions, steps, validation commands, and rollback procedures.
*   **Final Playbook Corrections**:
    *   Replaced the PostgreSQL container reference `hopwhistle-postgres-1` with `hopwhistle-postgres-dev` to align with the AWS production setup.
    *   Revised the recordings sync section to establish `rclone` as the recommended primary method (with optimal check/transfer flags) and provided a safe two-step fallback using the `aws-cli`.
    *   Added database and recordings verification checklists (spot-checks, table counting, and rclone size comparisons).

---

## Verification Results

*   **Diff Checks**: Run on all modified files to ensure strict alignment with formatting rules.
*   **Repo Status**: All modifications have been successfully verified using git.
*   **Playbook Verification**: Executed `git grep` to verify that `hopwhistle-postgres-1` has been fully removed and `hopwhistle-postgres-dev` is used correctly.
