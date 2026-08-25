# Importing a CSV of leads and selling them to the buyer

How to take a vendor file (say 1,000 aged final-expense leads) from CSV to a
posted, matched lead in the buyer's CRM, and what stops that from happening.

Related: `docs/INSURANCE_LEAD_DELIVERY_TEST.md` for exercising a single lead.

## The two halves

Importing and selling are deliberately separate steps.

1. **Import** stores the lead, validates it, and maps the outbound payload —
   then parks the submission on `HOLD`. Nothing is posted. This is true of the
   CSV importer, the inbound webhook, and the bulk endpoint alike.
2. **Delivery** is an explicit action. It posts the mapped payload to the
   Ameriquote/Boberdoo gateway and records what came back.

So a completed import does *not* mean the buyer has the leads. If you are
looking at "1,000 valid ingested" and wondering where the money is, the leads
are sitting on `HOLD` waiting for step 2.

## Column mapping

The importer maps CSV headers to lead fields. These are the fields that matter
for a buyer post; headers are matched case- and punctuation-insensitively, and
the listed aliases auto-map too.

| CSV column | Lead field | Posted as | Buyer requires |
| --- | --- | --- | --- |
| `Date_Posted` | `datePosted` | `Origin_Lead_Date` | No — but see below |
| `First_Name` | `firstName` | `FirstName` | Yes |
| `Last_Name` | `lastName` | `LastName` | Yes |
| `Address` | `address` | `Address` | Yes |
| `City` | `city` | `City` | Yes |
| `State` | `state` | `State` | Yes |
| `Zip` | `zipCode` (alias `zip`) | `ZipCode` | Yes |
| `Phone` | `phone` | `Primary_Phone` | Yes |
| `Email` | `email` | `Email` | Yes |
| `DOB` | `birthDate` (alias `dob`) | `Birth_Date` | Yes |
| `IP_Address` | `ipAddress` | `IP_Address` | Yes |
| `Trusted_Form_URL` | `trustedFormUrl` | `Trusted_Form_URL` | No — but see below |

`Age` is required by the buyer and is not a column in most vendor files. It is
computed from `DOB` during validation, so a good `DOB` covers it.

### What that column list does not cover

Two fields the buyer requires are absent from the twelve columns above, and no
amount of mapping conjures them:

- **Final Expense (TYPE=19) requires `Gender`** at both ping and post. An FE
  batch with no gender column is rejected lead-for-lead.
- **ACA / Health (TYPE=31) requires `Height_Feet`, `Height_Inches`, and
  `Weight`.** Same story.

Get the vendor to include the column, or the batch is not sellable as-is. The
preflight below tells you the exact count before you spend a post on it.

### Fields that are not required but are worth having

- `Trusted_Form_URL` (or `leadidToken`) is the consent proof. A lead posted
  without either still matches, but a TCPA complaint has nothing behind it.
- `Date_Posted` becomes `Origin_Lead_Date`. Aged leads sent without it can be
  priced — and later disputed — as fresh.
- `IP_Address` falls back to `127.0.0.1` when absent. That is a valid-looking
  value that buyers routinely scrub, so a missing IP is worse than it looks.
  Preflight flags it as a warning rather than letting it pass silently.

## Step by step

### 1. Import

Insurance Leads → **Import CSV**. Pick the vertical, name the list, upload,
confirm the column mapping, import. The file is sent to the API in batches of
100 rows, so a 1,000-row file will not time out.

Equivalent API call, if you would rather script it:

```
POST /api/v1/insurance-leads/import
{ "vertical": "FE", "listName": "acme-aged-2026-07", "leads": [ ... ] }
```

Send it in chunks of ~100 and reuse the `listId` from the first response on
every later chunk, so a name lookup can't fan out into duplicate lists.

### 2. Preflight

```
POST /api/v1/insurance-leads/delivery/preflight
{ "listId": "<list id>" }
```

Read-only. It reports how many of the list's held leads the buyer would accept,
how many are blocked, and which fields are responsible — tallied per lead and
sorted worst-first. Also reports the current post mode.

The UI runs this automatically on the import result screen.

### 3. Check the mode

`INSURANCE_LEAD_MODE` defaults to `TEST`, which flags every post with
`Test_Lead=1`. Test posts are not bought. Set `INSURANCE_LEAD_MODE=LIVE` on the
API before a real send; the preflight response and the UI badge both show which
mode you are in.

`AMERIQUOTE_API_KEY` must be set or delivery throws. `AMERIQUOTE_FE_SRC` /
`AMERIQUOTE_ACA_SRC` default to the aged-lead source values.

### 4. Send

```
POST /api/v1/insurance-leads/delivery/send
{ "listId": "<list id>", "limit": 100 }
```

Keep calling with the returned `nextCursor` until it comes back `null`. Batches
are capped at 250 per request and posted a few at a time
(`INSURANCE_LEAD_DELIVERY_CONCURRENCY`, default 4).

Two things it refuses to do on its own:

- **It will not post a lead that fails readiness.** Those come back as
  `NOT_READY` with their blockers. Pass `"force": true` to send anyway — each
  one is a near-certain rejection that still costs a ping.
- **It will not re-post a `MATCHED` submission.** A sold lead is excluded from
  selection, so re-running a batch cannot double-sell it.

A send must be scoped to a `listId` or an explicit `submissionIds` array. There
is no "send everything held" call, by design.

## Reading the outcome

Per submission, on the lead's detail sheet and in the send response:

| Outcome | Meaning |
| --- | --- |
| `MATCHED` | Bought. `ameriquoteLeadId` and `ameriquotePrice` are recorded. |
| `UNMATCHED` | Reached the buyer, no buyer wanted it. Not an error. |
| `ERROR` | The post failed — see `ameriquoteErrorMessage`. Re-sendable. |
| `NOT_READY` | Held back locally; never left the building. |

Every attempt writes an `InsuranceLeadSubmission` row with the raw inbound
payload, the normalized payload, the mapped outbound payload (API key redacted),
and the buyer's raw response, plus an activity entry on the lead.
