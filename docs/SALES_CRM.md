# Sales CRM and agreement suites

A B2B pipeline for **whoever is selling** — NetEnroll itself, and each
white-label issuer, beginning with Life Leads Plus — to insurance agencies,
licensed agents, IMOs/FMOs and call centers, and an **agreement suite per
seller** that sends that seller's own MSA / CPA / CPL for e-signature.

This is **not** the consumer CRM. `/insurance-leads` (nav: **CRM**) is where
agents work consumer prospects; it is unchanged. The Sales CRM (nav: **Sales
CRM**) uses its own tables and an agent sees none of it unless the owner
grants it.

| Piece                                    | Where                                                            |
| ---------------------------------------- | ---------------------------------------------------------------- |
| Migration (tables, backfill, triggers)   | `apps/api/prisma/migrations/20261009000000_sales_workspaces/`    |
| The one workspace resolver               | `apps/api/src/lib/sales-workspace.ts`                            |
| Sales API (CRM, access, settings, suites)| `apps/api/src/routes/sales.ts`                                   |
| Agreement management (both surfaces)     | `apps/api/src/routes/agreement-surface.ts`                       |
| Suites, issuer identity, template sets   | `apps/api/src/services/agreements/{suites,issuer,template-sets}.ts` |
| Agreement → prospect sync, stage policy  | `apps/api/src/services/sales/{agreement-sync,stage-policy}.ts`   |
| Screens                                  | `apps/web/src/app/(dashboard)/sales-crm/`                        |
| Shared agreement screens                 | `apps/web/src/components/agreements/`                            |
| Security test matrix                     | `apps/api/src/__tests__/sales-workspaces.test.ts`                |
| Navigation tests                         | `apps/web/src/components/layout/__tests__/sales-crm-nav.test.tsx` |

## Model

```
SalesWorkspace (PLATFORM | TENANT)          the company doing the selling
 ├─ AgreementSuite (1:1)                    legal entity, notice, signatory, copies,
 │                                          link origin, brand, template set, seal ref
 ├─ SalesWorkspaceAccess (*)                explicit grants: MANAGER | MEMBER | READONLY
 ├─ SalesProspect (*)                       type, stage, owner, follow-up, tags, …
 │   └─ SalesProspectActivity (*)           notes, calls, emails, stage changes,
 │                                          agreement lifecycle entries
 └─ AgreementEnvelope (*)                   salesWorkspaceId + agreementSuiteId = ISSUER
                                            tenantId = RECIPIENT (unchanged, nullable)
                                            salesProspectId (optional)
```

- `scopeType` is explicit. A check constraint enforces `PLATFORM ⇔ tenantId IS
  NULL`; a partial unique index allows exactly one PLATFORM workspace; `tenantId`
  is unique, so a tenant has at most one.
- Only a **top-level white-label tenant** (`whiteLabel` and no parent) is a sales
  issuer. A child agency never has, and never inherits, a workspace.
- `AgreementEnvelope.tenantId` keeps its meaning — the agency being contracted.
  The issuer is `salesWorkspaceId` / `agreementSuiteId`, set at send and frozen by
  trigger. The suite is the workspace's own by a composite foreign key; a linked
  prospect is in the same workspace by trigger. No cascade reaches an envelope:
  prospects are archived, never deleted, and every FK into
  `agreement_envelopes` is `RESTRICT` or `SET NULL`.
- The issuer's identity (names, notice details, brand, link origin, template set)
  is also frozen into the envelope's `terms.issuer`, so who issued a document is
  a fact about the document — not the host it is opened on, and not whatever the
  suite's settings say later.

## Who gets which workspace

`resolveSalesWorkspace(request)` is the only way a route learns its workspace.
It reads the authenticated principal and the database — never a header, query
parameter, body field, Origin or hostname.

| Principal                                        | Workspace                       | Level           |
| ------------------------------------------------ | ------------------------------- | --------------- |
| Platform admin, cross-agency view                | NetEnroll (PLATFORM)            | MANAGER         |
| Platform admin acting inside a tenant (the existing acting-tenant row) | that tenant's | MANAGER (support) |
| …while previewing a role                         | judged as the previewed role    |                 |
| White-label tenant **OWNER**                     | its own                         | MANAGER (implicit, cannot be revoked) |
| Any user of that tenant with a grant             | its tenant's                    | the grant       |
| ADMIN, AGENT without a grant                     | refused (403 `SALES_ACCESS_REQUIRED`) |           |
| Child agency, normal agency                      | refused (403 `SALES_WORKSPACE_UNAVAILABLE`) |     |
| API key                                          | refused (403)                   |                 |

Levels: **READONLY** reads; **MEMBER** also works prospects and sends, resends and
re-delivers agreements; **MANAGER** also edits suite settings, manages grants,
archives prospects, voids and retries completion.

A row of another workspace answers **404, byte-identical to an id that does not
exist** — prospects, envelopes, documents, an existing-MSA reference.

`/api/auth/me` reports `salesWorkspace: { scope, level, via, workspaceName } | null`
from the same resolver; the sidebar draws the **Sales** group from it, so the nav
can never disagree with the API.

## Access grants

Settings → *Who can use the Sales CRM* (owner / managers only). A grant names an
existing user of the **same tenant**; another tenant's user is "not found", and a
database trigger refuses the row regardless. Granting never changes the person's
role: an agent you grant stays an agent everywhere else. Every grant, change and
revocation is in the AuditLog (`sales.access.granted|changed|revoked`, under the
issuer's tenant).

## Agreement suites

Each workspace owns one suite. NetEnroll's is the platform suite: the existing
`/admin/agreements` screens and `/api/v1/platform/agreements` API, unchanged, now
scoped to it — a white-label suite's envelopes are not in its lists and its ids
404 there. The same engine serves `/api/v1/sales/agreements` for the caller's own
workspace (`/sales-crm/agreements`).

| Setting                         | Who edits it                       |
| ------------------------------- | ---------------------------------- |
| Display name, legal entity, d/b/a, notice address and email, reply-to, default signatory and title, internal copy emails | the workspace's MANAGERs (`/sales-crm/settings`) |
| Template set, seal reference and location, link origin, brand theme, reference prefix, enabled | platform admins only (`/api/v1/platform/agreement-suites`), audited as `agreement_suite.*` |

The brand is **not** the legal entity. A new white-label suite starts with its
brand name and **no** legal entity, notice details or signatory, and cannot send
until its owner fills them in ("Life Leads Plus's legal contracting entity is
empty").

For a white-label issuer, everything the signer and recipient see is the
issuer's: invitation, verification-code, completed and withdrawn emails (From
display name, subject, wording, logo, button colour, reply-to); signing and
download links on the issuer's portal domain (`Tenant.domain`, as
`portalUrlForTenant` resolves it); the signer and download pages (brand,
wordmark, palette — from the envelope, never the host); the consent disclosure
(`ESIGN-ISSUER-2026-10-09`, the same seven items in the issuer's name — NetEnroll
envelopes keep `ESIGN-2026-10-03` verbatim); the document and PDF frame (logo,
accent colours, footer `<legal name> · Confidential`, running header, PDF
author/producer); the Certificate of Completion (eyebrow, issuer section, copy
recipients, verify URL); and the event log (`ISSUER_SIGNED` with the issuer's
legal name and ids in its detail, `actorType` `ISSUER`). NetEnroll envelopes
keep writing `NETENROLL_SIGNED`; old rows are never touched.

### Template sets

`services/agreements/template-sets.ts`. NetEnroll's verbatim MSA/CPA/CPL are the
`netenroll` set (PLATFORM only). A set declares the scope — and for a tenant set
the brand theme — it may serve, so NetEnroll's legal text can never be assigned to
a white-label suite (refused at the API, and refused again by the engine if a row
names it). A template version is code and immutable: a new text is a new version
string, and registering a duplicate version throws.

**Life Leads Plus has no approved contract text in this repository.** Its set,
`life-leads-plus`, is registered with no documents, so its suite shows *Contract
templates not configured* and every preview and send answers
`409 TEMPLATES_NOT_CONFIGURED`. To install approved text, follow the steps at the
top of `template-sets.ts` (new modules under `templates/life-leads-plus/`, new
version strings, a verbatim-text test). Nothing else needs to change.

### Seals

A suite stores a **reference**, never key material (`sealSecretRef`, constrained
to an environment-variable-shaped name). `DEFAULT` is NetEnroll's
`AGREEMENT_SEAL_P12_*` and is refused for any other issuer — at the API, and again
at completion. A white-label seal `X` reads `AGREEMENT_SEAL_X_P12_BASE64` /
`AGREEMENT_SEAL_X_P12_PASSPHRASE`. With none, the issuer's PDFs are produced
hashed and verifiable and marked **Unsealed** — never sealed as PVN LLC d/b/a
NetEnroll.

### Existing MSA

`existingMsaEnvelopeId` is looked up **inside the issuing workspace and suite**:
another workspace's MSA is "not found", with the same response as an unknown id.
It must be completed, include the MSA, come from the same template family, and
belong to the same counterparty (same recipient tenant, signer email or prospect;
an MSA linked to a different prospect is refused).

## Sales CRM ↔ agreements

*Send agreement* on a prospect opens the workspace's own agreement form with the
prospect filled in; the envelope is linked to it. Every lifecycle event writes a
timeline entry (deduplicated by `sourceKey`), and `stage-policy.ts` moves the
stage forward only:

| Event                | Activity              | Stage                                   |
| -------------------- | --------------------- | --------------------------------------- |
| sent                 | `AGREEMENT_SENT`      | → AGREEMENT_SENT, if not already further |
| first opened         | `AGREEMENT_VIEWED`    | → AGREEMENT_REVIEW, if not further      |
| agency details entered | `AGREEMENT_DETAILS_ENTERED` (lists what the agency entered: name, entity or individual, principal and signer, address, contact, billing) | unchanged |
| signed               | `AGREEMENT_SIGNED`    | → AGREEMENT_SIGNED, if not further      |
| completed            | `AGREEMENT_COMPLETED` | → AGREEMENT_SIGNED, if not further      |
| voided / expired / changes requested | `AGREEMENT_VOIDED` / `AGREEMENT_EXPIRED` / `CHANGES_REQUESTED` | unchanged |

WON and LOST are never changed by an agreement, and a signature never marks a
prospect WON — that is a person's explicit act. The sync runs after the
agreement's evidence has committed and can never fail it; opening a prospect
replays any entry a failure missed. Calls and emails on the timeline are only
ever what a person recorded.

## API

```
GET    /api/v1/sales/context                 workspace, level, readiness
GET    /api/v1/sales/metrics                 open, qualified, agreements out/signed, won, due today, overdue
GET    /api/v1/sales/members                 assignable people
GET    /api/v1/sales/prospects               ?q&stage&type&assignedUserId(me|none|id)&followUp(overdue|today|upcoming|none)&archived&sort&page&pageSize
POST   /api/v1/sales/prospects
GET    /api/v1/sales/prospects/:id           with timeline and linked agreements
PATCH  /api/v1/sales/prospects/:id
POST   /api/v1/sales/prospects/:id/stage     {stage, lostReason?}
POST   /api/v1/sales/prospects/:id/activities {type: NOTE|CALL|EMAIL|FOLLOW_UP, body, occurredAt?, nextFollowUpAt?}
POST   /api/v1/sales/prospects/:id/archive | /restore
GET    /api/v1/sales/access                  (TENANT, MANAGER)
PUT    /api/v1/sales/access/:userId          {level}
DELETE /api/v1/sales/access/:userId
GET    /api/v1/sales/settings
PUT    /api/v1/sales/settings
*      /api/v1/sales/agreements/...          preview, send, list, detail, documents, resend, void, send-copies, complete
GET    /api/v1/platform/agreement-suites     platform admins
PUT    /api/v1/platform/agreement-suites/:id platform admins: templateSetKey, sealSecretRef, sealLocation, linkOrigin, brandTheme, referencePrefix, status
```

`/api/v1/platform/agreements/...` is unchanged in shape and still
`authenticate + requirePlatformAdmin`; it additionally accepts `salesProspectId`.

## Deploying

```sh
cat apps/api/prisma/migrations/20261009000000_sales_workspaces/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
cat apps/api/prisma/migrations/20261010000000_sales_activity_details_entered/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
```

`scripts/deploy-netenroll.sh` applies it (it is in `REQUIRED_MIGRATIONS` with an
applied-state probe). Additive and idempotent. It creates NetEnroll's workspace
and suite from `agreement_settings`, attaches every existing envelope to it
(nothing else on an envelope, document or event is written), and creates a
workspace and suite for each top-level white-label tenant from its own row — no
hard-coded ids. An envelope written by the previous API during the deploy window
is attached to NetEnroll by an insert trigger.

After deploying, for Life Leads Plus:

1. The owner opens **Sales CRM → Settings** and enters the legal contracting
   entity, notice address and email, signatory and copy addresses.
2. Approved MSA/CPA/CPL text is installed in code (see *Template sets*) and
   deployed. Until then the CRM works and sending is refused.
3. Optional: a seal of its own — generate a p12 as in `docs/AGREEMENTS.md` with
   the issuer's own subject, add `AGREEMENT_SEAL_LIFE_LEADS_PLUS_P12_BASE64` and
   `AGREEMENT_SEAL_LIFE_LEADS_PLUS_P12_PASSPHRASE` to the environment, then
   `PUT /api/v1/platform/agreement-suites/<id> {"sealSecretRef":"LIFE_LEADS_PLUS"}`.
