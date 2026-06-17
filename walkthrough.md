# Walkthrough - Insurance Lead CRM Enhancements

I have completed the implementation to fix the CRM side of the insurance/final-expense lead system, secure the pipeline, and completely deactivate outbound Ameriquote/Boberdoo posting.

All changes are contained within the git repository workspace.

## Key Accomplishments

### 1. Hard-Disabled Ameriquote/Boberdoo Posting
- **Backend Backstop**: Updated [insurance-lead-poster.ts](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/api/src/services/insurance-lead-poster.ts) to throw an error immediately if `postToAmeriquote` is called, ensuring zero external network egress.
- **Retry Deactivation**: Short-circuited the manual retry endpoint in [insurance-lead-service.ts](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/api/src/services/insurance-lead-service.ts) to immediately update status to `HOLD`, log a blocked-submission activity, and return:
  ```json
  {
    "success": false,
    "postStatus": "HOLD",
    "disabled": true,
    "message": "Ameriquote delivery is disabled by owner request."
  }
  ```
- **UI Deactivation**: Removed the "Retry" action button from [lead-detail-sheet.tsx](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/web/src/components/leads/lead-detail-sheet.tsx) and displayed a prominent warning: *"Ameriquote delivery is disabled by owner request. Leads are stored for internal review only."*

### 2. CRM & Final Expense Master Lead Fields
- Extended `InsuranceLead` in the [schema.prisma](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/api/prisma/schema.prisma) database schema with columns for assignment, priority, stages, dates, and DNC, plus FE-specific columns (smoker, premium, face amount, carrier, trustedForm, recording url).
- Added interactive fields in the CRM frontend sheet [lead-detail-sheet.tsx](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/web/src/components/leads/lead-detail-sheet.tsx) to assign leads, view/edit FE details, and update follow-up schedules.

### 3. Tasks & Follow-ups
- Added new models (`InsuranceTask` and related status/priority enums) to the schema.
- Added task REST endpoints (`GET/POST tasks`, `POST complete`, `POST cancel`) in [insurance-leads.ts (routes)](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/api/src/routes/insurance-leads.ts).
- Implemented task manager in [lead-detail-sheet.tsx](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/web/src/components/leads/lead-detail-sheet.tsx) allowing users to add open items, set priorities, track due dates, and complete/cancel them.

### 4. Activity Timeline
- Added the `InsuranceActivity` model to track notes, calls, task actions, validation failures, and updates.
- Added timeline rendering in the detail sheet to show lead timeline logs in reverse chronological order.

### 5. Masking Payment Fields & Enforcing Tenants
- Modified [prospect-intake.ts](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/api/src/routes/prospect-intake.ts) to immediately mask `routingNumber` and `accountNumber` to `****[last4]` values on write, preventing raw banking credentials leakage.
- Replaced hardcoded default tenant IDs with authenticated `tenantId` checking across tasks, intake, and retention endpoints to maintain strict tenant boundaries.

### 6. Mock Retention UI Deactivation
- Removed the Retention link from the navigation sidebar.
- Redirected the `/retention` frontend routes to `/insurance-leads`.
- Retained database models for safety as requested.

### 7. Call Center CRM Panel & Lookup API
- **Lookup API**: Created [call-center.ts](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/api/src/routes/call-center.ts) with `GET /api/v1/call-center/customer-lookup` endpoint. It normalizes numbers to the last 10 digits, searches across CRM tables with strict tenant boundaries, masks sensitive data, and separates duplicates.
- **Dynamic CRM Panel**: Created [CustomerCrmPanel.tsx](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/web/src/components/call-center/CustomerCrmPanel.tsx) to display clean grouped contact card layouts, final expense details, active call context (reloads on call state changes), tasks (with inline creation/completion), activity log (with notes logger), and a possible duplicates panel.
- **Portal Integration**: Modified [CallCenterPortal.tsx](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/web/src/components/call-center/CallCenterPortal.tsx) to trigger lookup and automatically show the CRM Target Profile tab on inbound ring/answer, outbound dial, and call transfer/resumption. Designed it with a responsive layout where softphone controls and CRM panels stack on mobile/smaller screens.
- **Disabled Ameriquote/Boberdoo Actions**: Ensured that the Call Center panel shows the lead delivery status as `"HOLD"` only, with a message stating *"External delivery disabled by owner request"*, and completely omitted any buttons or flows that can send/retry posts to Ameriquote.

## Verification & Quality
- Added service-level unit tests in [insurance-lead-crm.test.ts](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/api/src/services/__tests__/insurance-lead-crm.test.ts) proving that `postToAmeriquote` throws errors, manual retries block external posts, and valid leads default to `HOLD`.
- Added Fastify integration tests in [call-center.test.ts](file:///C:/Users/jimbo/.gemini/antigravity/worktrees/hopbot/edit-campaign-buyer-fix/apps/api/src/__tests__/call-center.test.ts) proving:
  - Inbound and outbound calls show matching CRM customer data.
  - Normalization to the last 10 digits functions correctly.
  - Tenant isolation is fully enforced.
  - Banking fields are masked and never returned.
  - Duplicate matches are returned without crashing.

---

## 8. Hetzner Server Migration Deployment & Stack Validation

I completed the provisioning retry, environment sanitization, and verification of the full Docker stack on the Hetzner server (`37.27.189.145`) for branch `edit-campaign-buyer-fix`.

### Key Verification Metrics
- **Host Env Sanitization**: Scrubbed Upstash/AWS URLs from the host `.env` file, pointing database, redis, clickhouse, and S3 storage endpoints purely to their local Hetzner Docker container instances:
  - `DATABASE_URL` -> `postgresql://callfabric:callfabric_dev@postgres:5432/callfabric`
  - `REDIS_URL` -> `redis://redis:6379`
  - `S3_ENDPOINT` -> `http://minio:9000`
- **Database Schema & Seeding**:
  - Aligned database schemas on the fresh PostgreSQL container using `npx prisma db push --force-reset --skip-generate` to synchronize schema models.
  - Successfully seeded the database using `npx prisma db seed`, creating all baseline Tenant, Admin User, API Keys, Carrier/Trunks, and Flow nodes.
- **Service Pings & Health**:
  - **API**: `live` & `ready` checks are fully healthy with status `200 OK`.
  - **PostgreSQL**: Succeeded (database table count check `calls` = 1).
  - **Redis**: Succeeded (`PONG` response).
  - **ClickHouse**: Succeeded (`Ok.` response).
  - **MinIO**: Succeeded (bucket `hopwhistle-recordings` created and listed recursively).
- **Telephony & FreeSWITCH Variables**:
  - Configured `PUBLIC_IP` and `MEDIA_DOMAIN` to pass into the FreeSWITCH environment.
  - Confirmed FreeSWITCH loaded the environment correctly with Sofia external and vapi profiles successfully bound to Hetzner's public IP `37.27.189.145`.
- **Recording Upload Flow**:
  - Generated a test recording payload (> 100 bytes) and executed the FreeSWITCH recording upload utility script.
  - Verified a successful upload (HTTP 200) resulting in the object written to local MinIO storage and mapped correctly to the call record in PostgreSQL.
