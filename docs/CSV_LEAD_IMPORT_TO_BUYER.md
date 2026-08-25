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
Gender,IP_Address,Landing_Page,Trusted_Form_URL,leadid_token,consent_language,
Origin_Lead_Date,Address_2,County,Smoker,SubSource
```

ACA — `ameriquote_aca_lead_template.csv`:

```
FirstName,LastName,Primary_Phone,Email,Address,City,State,ZipCode,Birth_Date,
Height_Feet,Height_Inches,Weight,IP_Address,Landing_Page,Trusted_Form_URL,
leadid_token,consent_language,Origin_Lead_Date,Address_2,County,Gender,Smoker,
Household_Income,People_In_Household,SubSource
```

Internal CRM fields — beneficiaries, banking, SSN, medications, follow-up
dates — are deliberately **not** in these templates. None of them are ever
posted to the buyer, and a template that asks a lead vendor for a bank routing
number is a liability, not a convenience. Those fields still exist on the lead
and can still be mapped during import; they just sit below the buyer's fields
in the mapping step, where the blue `→ Field_Name` tag marks everything that
actually gets posted.

`Age` is intentionally absent. The buyer requires it, but it is derived from
`Birth_Date` on ingest — a hand-filled Age column can only ever disagree with
the DOB.

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
| `Landing_Page`     | `Landing_Page`     | No — warned, see below |

`Landing_Page` is worth adding to a vendor file even though it only warns.
Header spellings like `Original Landing Page`, `Landing_Page_URL`, and
`Source_URL` all auto-map to it.

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
- **`Landing_Page` falling back to `hopwhistle.com`.** `Landing_Page` is Post
  Required, so the mapper always sends something; with no value on the lead it
  sends our own domain. For a lead generated on our site that is simply true,
  which is why this warns rather than blocking like the loopback IP does —
  readiness cannot tell an owned lead from a bought one by its payload. For a
  vendor-sourced lead it misstates where the consumer opted in, so supply the
  real one. Say the word if you want it blocked outright for imports.

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

| Outcome     | Meaning                                                        |
| ----------- | -------------------------------------------------------------- |
| `MATCHED`   | Bought. `ameriquoteLeadId` and `ameriquotePrice` are recorded. |
| `UNMATCHED` | Reached the buyer, no buyer wanted it. Not an error.           |
| `ERROR`     | The post failed — see `ameriquoteErrorMessage`. Re-sendable.   |
| `NOT_READY` | Held back locally; never left the building.                    |

Every attempt writes an `InsuranceLeadSubmission` row with the raw inbound
payload, the normalized payload, the mapped outbound payload (API key redacted),
and the buyer's raw response, plus an activity entry on the lead.
