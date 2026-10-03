# Electronic agreements

NetEnroll's client agreements — the **Master Services Agreement (MSA)** and the
**CPA** and **CPL** campaign agreements — are generated, signed electronically
and delivered from one platform-admin screen: **Admin → Agreements**
(`/admin/agreements`).

NetEnroll's agreements are the **platform suite** of NetEnroll's sales
workspace. Each white-label issuer (Life Leads Plus first) has its **own** suite
— its own legal entity, settings, template set, brand, links and seal — managed
from its Sales CRM at `/sales-crm/agreements` through `/api/v1/sales/agreements`.
The engine below is shared; the issuer is frozen onto every envelope. See
**docs/SALES_CRM.md**. Everything in this file describes NetEnroll's suite
unless it says otherwise.

Only platform admins (users with a `PlatformAdmin` row) can see or use it. The
screen is in `STAFF_ONLY_ROUTES` and is listed only in `PLATFORM_NAV`; every API
route under `/api/v1/platform/agreements` is
`authenticate + requirePlatformAdmin` (API keys are refused 403) and every write
is in the AuditLog.

| Piece                                       | Where                                                                 |
| ------------------------------------------- | --------------------------------------------------------------------- |
| Admin + public API                          | `apps/api/src/routes/agreements.ts`                                   |
| Services                                    | `apps/api/src/services/agreements/`                                   |
| Verbatim templates                          | `apps/api/src/services/agreements/templates/{msa,cpa,cpl}.ts`         |
| Migration (tables, triggers, settings seed) | `apps/api/prisma/migrations/20261007000000_agreements/migration.sql`  |
| Migration (agency-entered details)          | `apps/api/prisma/migrations/20261008000000_agreements_party_details/` |
| Migration (sales workspaces, issuer suites) | `apps/api/prisma/migrations/20261009000000_sales_workspaces/`         |
| Shared admin routes (both surfaces)         | `apps/api/src/routes/agreement-surface.ts`                            |
| Suites, issuer, template sets               | `apps/api/src/services/agreements/{suites,issuer,template-sets}.ts`   |
| Admin screens                               | `apps/web/src/app/(dashboard)/admin/agreements/`                      |
| Signer page                                 | `apps/web/src/app/sign/[token]`                                       |
| Client download page                        | `apps/web/src/app/agreements/[token]`                                 |
| Public verify page                          | `apps/web/src/app/agreements/verify`                                  |

## What happens

1. **Send.** A platform admin fills one form (who to send to — name, email and,
   optionally, the agency's name for our records — CPA and/or CPL, campaign
   terms, copy recipients), previews the documents exactly as they will be
   sent (the agency's fields read "To be completed by Agency"), ticks the authority confirmation and selects
   **Sign and send**. The MSA (unless the agency already has an executed one)
   and the chosen campaign agreements are rendered from the verbatim templates,
   NetEnroll's signatory's typed signature is applied, the as-sent HTML of each
   document is stored with its SHA-256, and the signer is emailed a link to
   `/sign/<token>`. If SMTP is down the record still stands and the admin is
   shown the link to send by hand.
2. **Verify.** The signer opens the link (only a summary is visible), asks for a
   code, and enters the 6-digit code emailed to the address the link was sent
   to. Five wrong attempts lock a code; at most five codes an hour.
3. **Consent and details.** The signer accepts the Electronic Records and
   Signature Disclosure (`ESIGN-2026-10-03`), then enters the agency's own
   details. They first choose **A business** or **An individual licensed
   agent**:
   - A business enters its legal name (and d/b/a), state of formation, entity
     type, address, principal name and title, email, phone, billing contact,
     and who signs (the principal, or another signer's name and title).
   - An individual agent enters only their full legal name (and d/b/a), state
     of residence, address, email, phone and billing contact. There is no
     entity type, principal or title: they sign for themselves ("Individually"),
     and the Parties tables show "Individual (sole proprietor)" and omit the
     principal row.

   The signer email is the address the link was sent to and cannot be changed.
   The details are saved once (`PARTY_DETAILS_SUBMITTED` event; a trigger
   refuses any change), and every document is completed with them. The
   completed version (`presentedHtml`, with its SHA-256) is what the signer
   reviews and signs; the offer NetEnroll signed (`sentHtml`) is kept as it was.
   If the agency already has an executed MSA, the form starts with its details.

4. **Review.** The signer reads each completed document in a sandboxed frame; a
   document is marked reviewed only once scrolled to the end.
5. **Sign.** The signer types their name (it must match the signer named in
   the details), title (businesses only) and initials, types or draws a signature,
   ticks the acceptance box for every document and the intent statement, and
   selects **Sign Agreements**.
6. **Complete.** Each document's executed HTML is the signed (completed) HTML with only the
   five signature markers filled — and is checked to be exactly that. It is
   printed by headless Chrome, a **Certificate of Completion** (the audit trail)
   is appended, the PDF is sealed when a seal certificate is configured,
   hashed, and stored once under `agreements/<envelopeId>/<documentId>-executed.pdf`.
   The signer, the copy recipients, NetEnroll's internal copy addresses and the
   sending admin are emailed the PDFs; the client gets a 12-month download link.

## The five evidence properties

The build exists to prove these five things for every envelope under ESIGN
(15 U.S.C. §7001 et seq.) and Florida's UETA (Fla. Stat. §668.50).

| Property                              | How it is proven                                                                                                                                                                                                                                                                                                       | Where                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| **Intent**                            | An explicit **Sign Agreements** action with the intent statement and a per-document acceptance statement; the exact text of each is stored on the `SIGNED` event.                                                                                                                                                      | `documents.ts` (`intentStatement`, `acceptanceStatement`), `POST /sign/:token/sign` |
| **Consent**                           | The disclosure must be accepted before signing; the `CONSENT_GIVEN` event records its version and the SHA-256 of the text shown.                                                                                                                                                                                       | `documents.ts` (`ESIGN_DISCLOSURE_V1`), `POST /sign/:token/consent`                 |
| **Attribution**                       | The link is sent to one address; a one-time code is sent to that same address and must be verified; every event carries IP (from `X-Real-IP` behind nginx, `lib/client-ip.ts`) and user agent; the typed name must match the named signer.                                                                             | `POST /sign/:token/otp`, `/verify`, `agreement_events`                              |
| **Association**                       | Each document's as-sent HTML and its SHA-256 are frozen at send (a trigger refuses any change). The `SIGNED` event records every document's as-sent hash; the executed render is verified to be the as-sent text plus the signature fragments and nothing else; the certificate prints the content and as-sent hashes. | `executed.ts`, `agreement_documents` trigger                                        |
| **Retention & accurate reproduction** | Executed PDFs are written once (no overwrite, no delete path), their SHA-256 is stored and re-checked before every download, they are digitally sealed, and the event log is append-only (trigger) and hash-chained (`verifyEventChain`).                                                                              | `complete.ts`, `events.ts`, `storage.ts` (`putObjectOnce`), migration triggers      |

The event chain: each event's `hash` is
`sha256(prevHash + canonicalJson({envelopeId, seq, type, occurredAt, actorType, actorUserId, actorEmail, ipAddress, userAgent, detail}))`,
the first `prevHash` being 64 zeros. The admin detail page shows
"Audit trail verified" or the first event that fails verification.

## Statuses

| Status              | Meaning                                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `SENT`              | Created, signed by NetEnroll, link sent (or shown to the admin).                                                                  |
| `VIEWED`            | The signer opened the link.                                                                                                       |
| `SIGNED`            | The signature is committed; the executed PDFs are not produced yet (completion failed — **Retry completion** on the detail page). |
| `COMPLETED`         | Executed PDFs stored and delivered. Not voidable here: termination happens under MSA §15, outside the system.                     |
| `CHANGES_REQUESTED` | The signer asked for changes; the link no longer works. Send a new envelope.                                                      |
| `VOIDED`            | Withdrawn by NetEnroll; the signer was told (without the reason).                                                                 |
| `EXPIRED`           | 30 days passed without a signature.                                                                                               |

## Verifying a PDF

Anyone can check a copy at **`https://agents.netenroll.com/agreements/verify`**:
the browser computes the file's SHA-256 locally and asks whether an executed
agreement has that hash. Any change to the file — a single byte — produces a
different hash and no match. When the PDF is sealed, any PDF reader also shows
the seal by "PVN LLC d/b/a NetEnroll" and flags the file if it was modified.

## Reissuing copies

On a completed agreement's page, **Send copies again** emails the executed PDFs
to the signer, the copy recipients and NetEnroll again, with a **new** 12-month
download link (the old link stops working). The PDFs themselves never change.

## The seal certificate

Seals are per suite. A suite names a seal by reference (`sealSecretRef`); the
platform suite's is `DEFAULT`, which means the two variables below. `DEFAULT` is
refused for any other issuer, so NetEnroll's seal is never applied to a
white-label agreement; a white-label seal `X` reads
`AGREEMENT_SEAL_X_P12_BASE64` / `AGREEMENT_SEAL_X_P12_PASSPHRASE` (see
docs/SALES_CRM.md).

Without a seal certificate the agreements are still produced, hashed and
verifiable, but marked **Unsealed** (and the API logs an error in production).
To seal them, run this once on the production server, replacing `PASSPHRASE`
with a passphrase of your choosing (letters and numbers) in **both** places:

```sh
mkdir -p /root/seal && cd /root/seal
openssl req -x509 -newkey rsa:3072 -sha256 -days 3650 -nodes -keyout seal.key -out seal.crt -subj "/CN=PVN LLC d\/b\/a NetEnroll Document Seal/O=PVN LLC/C=US"
openssl pkcs12 -export -inkey seal.key -in seal.crt -out seal.p12 -passout pass:PASSPHRASE
echo "AGREEMENT_SEAL_P12_BASE64=$(base64 -w0 seal.p12)" >> /opt/hopwhistle/.env
echo "AGREEMENT_SEAL_P12_PASSPHRASE=PASSPHRASE" >> /opt/hopwhistle/.env
```

The slashes in `d\/b\/a` are escaped on purpose. `-subj` separates fields with
`/`, so an unescaped `d/b/a` cuts the name to "PVN LLC d" (with a
`req warning: Skipping unknown subject name attribute` line) and drops the
organization.

Check both before deploying:

```sh
openssl x509 -in /root/seal/seal.crt -noout -subject
# subject=CN = PVN LLC d/b/a NetEnroll Document Seal, O = PVN LLC, C = US
grep -c '^AGREEMENT_SEAL_P12_' /opt/hopwhistle/.env
# 2
```

Then deploy so the API reads the new settings:

```sh
cd /opt/hopwhistle && scripts/deploy.sh --build api web
```

To start over (for example after a typo), remove the two lines first with
`sed -i '/^AGREEMENT_SEAL_P12_/d' /opt/hopwhistle/.env`, then repeat the steps.
Agreements completed after the deploy are sealed; the admin detail page shows a
**Sealed** badge.

**`seal.key`, `seal.crt` and `seal.p12` are never committed to this repository**
(they are in `.gitignore`). Keep `seal.key`/`seal.p12` offline after setup.

## Configuration

| Variable                        | Purpose                                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `AGREEMENTS_S3_BUCKET`          | Bucket for executed PDFs and drawn signatures (default `agreements`), on the same `S3_*` credentials. |
| `AGREEMENT_SEAL_P12_BASE64`     | The seal certificate, base64. Optional.                                                               |
| `AGREEMENT_SEAL_P12_PASSPHRASE` | Its passphrase.                                                                                       |
| `AGREEMENT_SEAL_<REF>_P12_BASE64` / `_PASSPHRASE` | A white-label suite's own seal, when its `sealSecretRef` is `<REF>`. Optional.      |
| `SMTP_*`                        | Email. Sends are best-effort; a failed send never fails the record.                                   |
| `APP_URL`                       | The portal links point at (default `https://agents.netenroll.com`).                                   |
| `FIELD_ENCRYPTION_KEY`          | Encrypts the stored signing token so **Resend** can rebuild the same link.                            |

NetEnroll's notice address and email, the default signatory and the internal
copy addresses are in **Admin → Agreements → Settings** (seeded by the
migration). They are stored on the platform suite (`agreement_suites`); the
legacy `agreement_settings` row is kept in step as a rollback mirror. Sending is
refused while either notice field is empty.

New NetEnroll envelopes also carry `issuerSignatory*` columns and the frozen
`terms.issuer`; their `netenrollSignatory*` columns and `NETENROLL_SIGNED` event
are written exactly as before. Envelopes written before suites existed have no
`terms.issuer` and are read as NetEnroll's.

## Applying the migration

Production has no `_prisma_migrations` table and is never run through
`prisma migrate deploy`. Apply the additive, idempotent SQL directly:

```sh
cat apps/api/prisma/migrations/20261007000000_agreements/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
cat apps/api/prisma/migrations/20261008000000_agreements_party_details/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
cat apps/api/prisma/migrations/20261009000000_sales_workspaces/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
```

All three are safe to run more than once. The third attaches every existing
envelope to NetEnroll's platform suite without changing anything else on it.
