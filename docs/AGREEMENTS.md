# Electronic agreements

NetEnroll's client agreements — the **Master Services Agreement (MSA)** and the
**CPA** and **CPL** campaign agreements — are generated, signed electronically
and delivered from one platform-admin screen: **Admin → Agreements**
(`/admin/agreements`).

Only platform admins (users with a `PlatformAdmin` row) can see or use it. The
screen is in `STAFF_ONLY_ROUTES` and is listed only in `PLATFORM_NAV`; every API
route under `/api/v1/platform/agreements` is
`authenticate + requirePlatformAdmin` (API keys are refused 403) and every write
is in the AuditLog.

| Piece                                       | Where                                                                |
| ------------------------------------------- | -------------------------------------------------------------------- |
| Admin + public API                          | `apps/api/src/routes/agreements.ts`                                  |
| Services                                    | `apps/api/src/services/agreements/`                                  |
| Verbatim templates                          | `apps/api/src/services/agreements/templates/{msa,cpa,cpl}.ts`        |
| Migration (tables, triggers, settings seed) | `apps/api/prisma/migrations/20261007000000_agreements/migration.sql` |
| Admin screens                               | `apps/web/src/app/(dashboard)/admin/agreements/`                     |
| Signer page                                 | `apps/web/src/app/sign/[token]`                                      |
| Client download page                        | `apps/web/src/app/agreements/[token]`                                |
| Public verify page                          | `apps/web/src/app/agreements/verify`                                 |

## What happens

1. **Send.** A platform admin fills one form (agency details, CPA and/or CPL,
   campaign terms, signer, copy recipients), previews the documents exactly as
   they will be sent, ticks the authority confirmation and selects
   **Sign and send**. The MSA (unless the agency already has an executed one)
   and the chosen campaign agreements are rendered from the verbatim templates,
   NetEnroll's signatory's typed signature is applied, the as-sent HTML of each
   document is stored with its SHA-256, and the signer is emailed a link to
   `/sign/<token>`. If SMTP is down the record still stands and the admin is
   shown the link to send by hand.
2. **Verify.** The signer opens the link (only a summary is visible), asks for a
   code, and enters the 6-digit code emailed to the address the link was sent
   to. Five wrong attempts lock a code; at most five codes an hour.
3. **Consent and review.** The signer accepts the Electronic Records and
   Signature Disclosure (`ESIGN-2026-10-03`), then reads each document in a
   sandboxed frame; a document is marked reviewed only once scrolled to the end.
4. **Sign.** The signer types their name (it must match the name the
   agreements were issued to), title and initials, types or draws a signature,
   ticks the acceptance box for every document and the intent statement, and
   selects **Sign Agreements**.
5. **Complete.** Each document's executed HTML is the as-sent HTML with only the
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
| `SMTP_*`                        | Email. Sends are best-effort; a failed send never fails the record.                                   |
| `APP_URL`                       | The portal links point at (default `https://agents.netenroll.com`).                                   |
| `FIELD_ENCRYPTION_KEY`          | Encrypts the stored signing token so **Resend** can rebuild the same link.                            |

NetEnroll's notice address and email, the default signatory and the internal
copy addresses are in **Admin → Agreements → Settings** (seeded by the
migration). Sending is refused while either notice field is empty.

## Applying the migration

Production has no `_prisma_migrations` table and is never run through
`prisma migrate deploy`. Apply the additive, idempotent SQL directly:

```sh
cat apps/api/prisma/migrations/20261007000000_agreements/migration.sql | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
```
