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

So a completed import does _not_ mean the buyer has the leads. If you are
looking at "1,000 valid ingested" and wondering where the money is, the leads
are sitting on `HOLD` waiting for step 2.

## The template is in the buyer's vocabulary

**Download Buyer Template** on the import screen produces a CSV whose columns
are Ameriquote's own field names, taken from `api-fe-fields.txt` (TYPE=19) and
`api-aca-fields.txt` (TYPE=31). Required columns come first. Hand this file to
your lead vendor as-is.

Final Expense — `ameriquote_fe_lead_template.csv`:

```
FirstName,LastName,Primary_Phone,Email,Address,City,State,ZipCode,Birth_Date,
Gender,IP_Address,Trusted_Form_URL,Origin_Lead_Date
```

ACA — `ameriquote_aca_lead_template.csv`:

```
FirstName,LastName,Primary_Phone,Email,Address,City,State,ZipCode,Birth_Date,
Height_Feet,Height_Inches,Weight,IP_Address,Trusted_Form_URL,Origin_Lead_Date,
Gender,Household_Income,People_In_Household
```

Internal CRM fields — beneficiaries, banking, SSN, medications, follow-up
dates — are deliberately **not** in these templates. None of them are ever
posted to the buyer, and a template that asks a lead vendor for a bank routing
number is a liability, not a convenience. Those fields still exist on the lead
and can still be mapped during import; they just sit below the buyer's fields
in the mapping step, where the blue `→ Field_Name` tag marks everything that
actually gets posted.

Two buyer-required fields are intentionally absent, because nothing needs to
fill them in:

- **`Age`** is derived from `Birth_Date` on ingest. A hand-filled Age column
  can only ever disagree with the DOB. If a file does carry one, the supplied
  value wins — so drop the column on an aged file, where the age captured at
  generation time is now stale.
- **`SRC`** is `PVNFE_aged` / `PVNACA_aged` from config, and **`SubSource`**
  defaults to the lead-list name of the import, so a matched lead traces back
  to its batch. A mapped Source column still wins.
- **`leadid_token`, `consent_language`, `Address_2`, `County`, `Smoker`** are
  optional to the buyer and not in our vendor files. They stay mappable in the
  import step for a file that happens to carry them.
- **`Landing_Page`** is the same page for every lead we sell —
  `https://quotes.nationallifecoverage.org` — so the mapper supplies it on
  every post (`DEFAULTS.LANDING_PAGE` in `insurance-lead-config.ts`, pinned by
  a test). A lead that carries its own `landingPage` still overrides it, which
  is the only way a different opt-in page reaches the buyer.

`buyer-fields.ts` holds this mapping, and `__tests__/buyer-template.test.ts`
asserts it against the spec files on every run, so the template cannot drift
back toward our internal names.

### If your vendor file already exists

Headers are matched case- and punctuation-insensitively, and both the buyer's
names and common vendor spellings auto-map. A typical aged-lead file needs no
manual mapping:

Every one of these is posted on every send. The last column is whether a lead
is allowed to go out **without** it.

| Vendor column      | Posted as          | Required to send       |
| ------------------ | ------------------ | ---------------------- |
| `First_Name`       | `FirstName`        | Yes — buyer            |
| `Last_Name`        | `LastName`         | Yes — buyer            |
| `Address`          | `Address`          | Yes — buyer            |
| `City`             | `City`             | Yes — buyer            |
| `State`            | `State`            | Yes — buyer            |
| `Zip`              | `ZipCode`          | Yes — buyer            |
| `Phone`            | `Primary_Phone`    | Yes — buyer            |
| `Email`            | `Email`            | Yes — buyer            |
| `DOB`              | `Birth_Date`       | Yes — buyer            |
| `IP_Address`       | `IP_Address`       | Yes — buyer, real IP   |
| `Trusted_Form_URL` | `Trusted_Form_URL` | Yes — our rule         |
| `Date_Posted`      | `Origin_Lead_Date` | No — warned, see below |

### Consent proof and IP are hard requirements here

Ameriquote's spec marks `Trusted_Form_URL` as `Post Required: NO`. That means
only that **Boberdoo will not reject a post that omits it** — it is not
permission to sell a lead with no evidence the consumer consented. Readiness
treats it as a blocker regardless of what their gate enforces:

- **No `Trusted_Form_URL` and no `leadid_token` → blocked.** Either artifact
  satisfies it; a lead with neither never goes out. A `Trusted_Form_URL` that
  is not an `http(s)://` certificate URL (`n/a`, `none`, a bare token) is
  blocked the same way.
- **`IP_Address` of `127.0.0.1` → blocked.** That is the placeholder the mapper
  substitutes when a lead has no IP at all. It passes the buyer's format check
  while proving nothing about where the opt-in happened, so it does not count
  as a value.

`force: true` on the send endpoint overrides both, deliberately and per call.
It is not a default anyone should reach for.

### What that column list does not cover

Two fields the buyer requires are absent from the twelve columns above, and no
amount of mapping conjures them:

- **Final Expense (TYPE=19) requires `Gender`** at both ping and post. An FE
  batch with no gender column is rejected lead-for-lead.
- **ACA / Health (TYPE=31) requires `Height_Feet`, `Height_Inches`, and
  `Weight`.** Same story.

Get the vendor to include the column, or the batch is not sellable as-is. The
preflight below tells you the exact count before you spend a post on it.

### What only warns

- `Date_Posted` → `Origin_Lead_Date`. Aged leads sent without it can be priced —
  and later disputed — as fresh. Warned, not blocked.
- A `leadid_token` with no TrustedForm certificate and no `consent_language`.
  It clears the consent requirement, but it is thinner proof than a cert.

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

`INSURANCE_LEAD_MODE` defaults to **`live`**. Set it to `test` only for a
deliberate test run — that stamps `Test_Lead=1`, and those posts are never
bought. The default used to be `test` "for safety", which had the failure
backwards: a test post is indistinguishable from a real one in the logs, so an
unset variable silently discarded a whole batch. The preflight response and the
UI badge both show the mode before you send.

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

| Outcome     | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `MATCHED`   | Bought. `ameriquoteLeadId` and `ameriquotePrice` are recorded. |
| `UNMATCHED` | Reached the buyer, no buyer wanted it. Not an error.           |
| `ERROR`     | The post failed — see `ameriquoteErrorMessage`. Re-sendable.   |
| `NOT_READY` | Held back locally; never left the building.                    |

Every attempt writes an `InsuranceLeadSubmission` row with the raw inbound
payload, the normalized payload, the mapped outbound payload (API key redacted),
and the buyer's raw response, plus an activity entry on the lead.

### Why a lead failed

The send panel groups every non-delivery in the run by what the buyer actually
said, worst first, with a few example leads under each reason — so "18 errored"
now reads as "14× duplicate within 90 days, 4× missing DOB" without opening a
single lead. The same grouping is on the API response as `failureReasons`, and
in the API log line at the end of each batch.

A reason is never blank. Where Boberdoo answers with XML, an HTML error page,
a non-2xx, an unrecognized status, or nothing at all, the message carries the
HTTP status and a snippet of the body rather than a generic parse failure. An
`UNMATCHED` says what it means instead of leaving the column empty.

For a run that already happened, `why-are-leads-erroring.mjs` reads the same
thing back out of the submission rows, per lead as well as grouped:

```
docker cp scripts/why-are-leads-erroring.mjs hopwhistle-api-dev:/app/why.mjs
docker exec -u root hopwhistle-api-dev node /app/why.mjs                 # lists your lists
docker exec -u root hopwhistle-api-dev node /app/why.mjs "FE August 2026" --all
```

## What a live run of 5,000 leads taught us

From 2026-08-25. Recorded because none of it is visible in the buyer's spec.

### A post spends the lead, sold or not

Boberdoo registers a lead the moment it is posted and the 90-day duplicate
window runs from then — not from the sale. A lead that comes back `Unmatched`
is just as locked as one that sold.

Measured, not assumed: re-sending 20 previously-unmatched leads returned
**20/20** `Duplicate lead value ... within the past 90 days`, including one
that had been accepted for manual approval on the first pass.

This is the single most expensive fact about the pipeline. Posting a lead
nobody buys does not cost nothing — it costs the lead.

### Demand stops without warning

That run matched 65-70% across its first 1,475 leads, then returned zero
matches for 3,417 consecutive posts, in the two minutes it took to drain the
rest of the list. Exactly 1,000 sold.

A match rate does not fall from 67% to 0% and stay there on its own. That is
the buyer's ceiling — their daily volume, or their own downstream buyers
filling up. The sender now halts after 50 consecutive unmatched
(`--stop-after-unmatched`), which on that run would have stopped near lead
1,525 and left ~3,350 still sellable the next day.

**Ask the buyer what the ceiling is and when it resets, and pace to it.**
Feeding a list faster than they buy converts inventory into locked rows.

### Not every non-Matched answer is a failure

Boberdoo answers some posts with a status that is neither Matched, Unmatched
nor Error:

```json
{ "response": { "status": "Lead ID 326229333 has to be manually approved." } }
```

The lead is accepted and holding for their review. It has an id. It is
recorded as `MANUAL_REVIEW` and is never re-sent — a second post of an
accepted lead comes back as a duplicate and destroys it.

### Operational scripts

All run inside the api container: `docker cp scripts/<file> hopwhistle-api-dev:/app/<file>`
then `docker exec -u root hopwhistle-api-dev node /app/<file> <args>`.

| Script                                 | What it does                                                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `send-lead-list-to-buyer.mjs`          | Sends a named list to completion. `--dry-run`, `--max <n>`, `--stop-after-unmatched <n>`, `--force`.             |
| `lead-acceptance-report.mjs`           | Splits a list into accepted / refused / recoverable; exports the recoverable to CSV in the buyer's column names. |
| `analyze-send-run.mjs`                 | Match rate in blocks in posting order — shows a wall as a cliff.                                                 |
| `why-are-leads-erroring.mjs`           | Why every undelivered lead failed — grouped and per lead. No args lists your lists; `--all` shows every lead.    |
| `repair-manual-review-submissions.mjs` | Reclassifies accepted-for-review rows written as ERROR by an older parser.                                       |
| `recover-manual-review-lead-ids.mjs`   | Recovers buyer lead ids from the retained raw response.                                                          |

Every one is dry-run or read-only by default. Use `--max 20` to answer a
question about the buyer for the price of twenty leads rather than a batch.

### Deploying a schema change

This database has no Prisma migration history — it was built with `db push`,
so `prisma migrate deploy` fails with **P3005** on a non-empty schema. Apply a
migration by piping its SQL:

```bash
cat apps/api/prisma/migrations/<name>/migration.sql \
  | docker exec -i hopwhistle-postgres-dev psql -U callfabric -d callfabric
```

`db push --accept-data-loss` is not an acceptable substitute on a database
holding sold leads. Baselining against `prisma/migrations` would fix this
properly.
