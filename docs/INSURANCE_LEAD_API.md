# Insurance Lead API — send leads in, have them posted to the buyer

Base URL: `https://hopwhistle.com`
Auth: `x-api-key: <your key>` on every request. The tenant is resolved from the
key, so there is no tenant id in any path or body.

The buyer is Ameriquote (Boberdoo). Every lead we post reaches them as
`TYPE=19` (Final Expense) or `TYPE=31` (ACA) on
`https://ameriquote.leadportal.com/new_api/api.php`.

---

## The one thing to understand first

**A post is spent whether or not the lead sells.** Boberdoo's 90-day duplicate
window keys on submission, not on sale. Post a lead, get `Unmatched` back, and
that lead cannot be sold to anyone through this gateway for 90 days. There is no
undo.

That is why nothing in this API posts to the buyer as a side effect of storing a
lead. Ingest always parks a lead on `HOLD`. Delivery is always something a
caller asked for by name — either `deliver: true` on the way in, or an explicit
call to `/delivery/send`.

---

## Two ways to do it

### A. One call — ingest and deliver together

Best when an upstream system produces leads one at a time, or in small batches,
and wants the buyer's answer in the same response.

```
POST /api/v1/insurance-leads/inbound/fe?deliver=true
```

### B. Two calls — import, preflight, then release

Best for a CSV or any batch over 250. Lets you see what would bounce _before_
spending a single post.

```
POST /api/v1/insurance-leads/import            # store, held
POST /api/v1/insurance-leads/delivery/preflight # what would happen (free)
POST /api/v1/insurance-leads/delivery/send      # actually post
```

---

## `POST /api/v1/insurance-leads/inbound/:vertical`

`:vertical` is `fe`, `aca`, or `b2b` (case-insensitive). B2B has no buyer
mapping and can never be delivered.

**Query parameters**

| Name      | Default | Meaning                                                                                                            |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------ |
| `deliver` | `false` | Post to the buyer after storing. Accepts `true`, `1`, `yes`. Anything else — including `false` — does not deliver. |
| `force`   | `false` | Post even when the readiness check says the buyer will reject it. Spends a post to get a rejection.                |

**Request**

```http
POST /api/v1/insurance-leads/inbound/fe?deliver=true
x-api-key: YOUR_KEY
Content-Type: application/json

{
  "firstName": "Jane",
  "lastName": "Doe",
  "phone": "5125551234",
  "email": "jane.doe@example.com",
  "address": "123 Main St",
  "city": "Austin",
  "state": "TX",
  "zipCode": "78701",
  "birthDate": "04/12/1962",
  "gender": "Female",
  "ipAddress": "203.0.113.42",
  "trustedFormUrl": "https://cert.trustedform.com/abc123",
  "datePosted": "2026-08-31"
}
```

**Response — sold**

```json
{
  "success": true,
  "insuranceLeadId": "3f2a...",
  "submissionId": "9c81...",
  "validationStatus": "VALID",
  "postStatus": "MATCHED",
  "postMode": "LIVE",
  "ameriquoteStatus": "MATCHED",
  "ameriquoteLeadId": "8471923",
  "ameriquotePrice": "12.00",
  "deliveryMessage": null,
  "deliveryBlockers": null,
  "errors": null
}
```

**Response — stored but not deliverable**

```json
{
  "success": true,
  "postStatus": "NOT_READY",
  "deliveryMessage": "Missing fields the buyer requires — fix the data or re-send with force",
  "deliveryBlockers": [
    { "field": "gender", "outboundField": "Gender", "message": "Gender is required" }
  ]
}
```

`NOT_READY` means **no post was spent.** The lead is still sellable. Fix the
field and retry — this is the good outcome when data is incomplete.

**Status codes**: `200` valid, `422` failed validation (body echoes `errors`),
`400` bad vertical or body, `401` missing/invalid key, `500` ingestion failure.

---

## `POST /api/v1/insurance-leads/import`

**Body**

| Field      | Type    | Notes                                                                                                            |
| ---------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| `vertical` | string  | `fe`, `aca`, or `b2b`. Required.                                                                                 |
| `leads`    | array   | Lead objects, same shape as inbound. Required.                                                                   |
| `listName` | string  | Created if it doesn't exist. Becomes the default `SubSource`, which is how a sold lead traces back to its batch. |
| `listId`   | string  | Pin to an existing list. Use the `listId` from the first chunk's response to keep a chunked import in one list.  |
| `deliver`  | boolean | Post after storing. Capped at **250 leads per call** — beyond that use `/delivery/send`.                         |
| `force`    | boolean | Post leads readiness flagged.                                                                                    |

```http
POST /api/v1/insurance-leads/import
x-api-key: YOUR_KEY
Content-Type: application/json

{
  "vertical": "fe",
  "listName": "fe-september-2026",
  "deliver": true,
  "leads": [ { "firstName": "Jane", "...": "..." } ]
}
```

**Response**

```json
{
  "total": 100,
  "successCount": 98,
  "failCount": 2,
  "listId": "03d67f24-...",
  "delivery": {
    "attempted": 98,
    "matched": 61,
    "unmatched": 30,
    "manualReview": 4,
    "errored": 1,
    "notReady": 2,
    "remaining": 0,
    "nextCursor": null,
    "results": ["...per lead..."]
  },
  "details": [{ "success": true, "phone": "5125551234", "submissionId": "9c81..." }]
}
```

`delivery` is `null` when you didn't ask to deliver — so "we sent nothing" and
"we sent and everything bounced" stay tellable apart.

---

## `POST /api/v1/insurance-leads/delivery/preflight`

Free and read-only. **Run this before any batch you care about.**

```json
{ "listId": "03d67f24-..." }
```

```json
{
  "sendable": 4892,
  "ready": 4781,
  "blocked": {
    "count": 111,
    "reasons": [
      { "message": "Gender is required", "field": "gender", "count": 92 },
      { "message": "Address is required", "field": "address", "count": 16 }
    ]
  },
  "warnings": { "count": 0, "reasons": [] },
  "alreadyMatched": 1233,
  "invalid": 3,
  "mode": "LIVE"
}
```

**Check `mode` reads `LIVE`.** A `TEST` post stamps `Test_Lead=1`, is never
bought, and looks identical to a real one in every log and response.

---

## `POST /api/v1/insurance-leads/delivery/send`

The explicit bulk release. Must be scoped — a call with neither `listId` nor
`submissionIds` is rejected, because otherwise one call would release every held
lead the tenant has ever imported.

| Field           | Notes                                                 |
| --------------- | ----------------------------------------------------- |
| `listId`        | Send one imported list.                               |
| `submissionIds` | Send a hand-picked set. One of these two is required. |
| `vertical`      | Optional extra filter.                                |
| `limit`         | Batch size, max 250, default 100.                     |
| `cursor`        | From the previous response's `nextCursor`.            |
| `force`         | Post leads readiness flagged. Off by default.         |

Page until `nextCursor` comes back `null`:

```bash
CURSOR=null
while :; do
  BODY=$(jq -nc --arg l "$LIST_ID" --arg c "$CURSOR" \
    '{listId:$l, limit:250} + (if $c=="null" then {} else {cursor:$c} end)')
  OUT=$(curl -s -X POST https://hopwhistle.com/api/v1/insurance-leads/delivery/send \
    -H "x-api-key: $KEY" -H 'Content-Type: application/json' -d "$BODY")
  echo "$OUT" | jq '{matched,unmatched,manualReview,notReady,remaining}'
  CURSOR=$(echo "$OUT" | jq -r '.nextCursor // "null"')
  [ "$CURSOR" = "null" ] && break
done
```

### Stop if the match rate collapses

The buyer has a cap nobody has documented to us. In the August 2026 run the
match rate held at 65–70% for six batches, then went to **0% and stayed there
for fourteen consecutive batches** — 3,417 leads posted into a closed buyer,
every one now locked for 90 days.

If you see two full batches at 0% matched, stop and ask them before continuing.
`scripts/send-lead-list-to-buyer.mjs` does this automatically
(`--stop-after-unmatched`, default 50). Nothing in the HTTP API does.

---

## Lead fields

Everything is optional to _store_ — only `phone` is required for that. The
"required" column below is what the **buyer** requires; a lead missing any of it
comes back `NOT_READY` and is never posted.

| Field            | Format                       | FE                    | ACA                   |
| ---------------- | ---------------------------- | --------------------- | --------------------- |
| `firstName`      |                              | required              | required              |
| `lastName`       |                              | required              | required              |
| `phone`          | 10 digits                    | required              | required              |
| `email`          |                              | required              | required              |
| `address`        |                              | required              | required              |
| `city`           |                              | required              | required              |
| `state`          | 2 letters                    | required              | required              |
| `zipCode`        | 5 digits                     | required              | required              |
| `birthDate`      | `MM/DD/YYYY`                 | required              | required              |
| `age`            | integer                      | auto from `birthDate` | auto from `birthDate` |
| `ipAddress`      | IPv4/IPv6                    | required              | required              |
| `trustedFormUrl` | `http(s)://`                 | required¹             | required¹             |
| `leadidToken`    |                              | alternative to¹       | alternative to¹       |
| `gender`         | `Male`/`Female`/`Non-binary` | **required**          | optional              |
| `heightFeet`     | integer                      | —                     | **required**          |
| `heightInches`   | integer                      | —                     | **required**          |
| `weight`         |                              | —                     | **required**          |
| `datePosted`     | any parseable date           | optional              | optional              |
| `source`         |                              | defaults to list name | defaults to list name |

¹ Consent proof. Boberdoo's spec marks both `Post Required: NO` — this is _our_
rule, and it is stricter than theirs. A lead needs one of the two, not both.

**Supplied automatically, do not send:**

- `Landing_Page` — always `https://quotes.nationallifecoverage.org`
- `SRC` — `PVNFE_aged` / `PVNACA_aged` (`AMERIQUOTE_FE_SRC`, `AMERIQUOTE_ACA_SRC`)
- `TYPE` — from the vertical
- `Key` — `AMERIQUOTE_API_KEY`
- `SubSource` — the list name, unless `source` is set on the lead

An `ipAddress` of `127.0.0.1` is treated as **missing**, not present: the mapper
substitutes loopback when a lead has no IP, which satisfies the buyer's format
check while proving nothing about where the consumer opted in.

---

## Outcomes

| Value           | Post spent? | Meaning                                                                                       |
| --------------- | ----------- | --------------------------------------------------------------------------------------------- |
| `MATCHED`       | yes         | Sold. `ameriquoteLeadId` and `ameriquotePrice` are set.                                       |
| `MANUAL_REVIEW` | yes         | _"Lead ID n has to be manually approved."_ Accepted, pending their review. **Never re-send.** |
| `UNMATCHED`     | yes         | No buyer wanted it. Locked ~90 days. Not fixable.                                             |
| `ERROR`         | usually     | Duplicate, blocked number, or a gateway failure.                                              |
| `NOT_READY`     | **no**      | Our own check stopped it. Still sellable — fix and retry.                                     |

`MATCHED` and `MANUAL_REVIEW` are excluded from every re-send path. Re-posting
either comes back as a duplicate and destroys the lead.

To audit what happened to a batch:

```
docker exec -u root hopwhistle-api-dev node /app/disposition.mjs <list name>
```

See `scripts/export-buyer-disposition.mjs`.

---

## Environment

| Variable                              | Default       | Notes                                    |
| ------------------------------------- | ------------- | ---------------------------------------- |
| `AMERIQUOTE_API_KEY`                  | —             | Required. Delivery throws without it.    |
| `INSURANCE_LEAD_MODE`                 | `live`        | Only the literal `test` gives test mode. |
| `AMERIQUOTE_FE_SRC`                   | `PVNFE_aged`  |                                          |
| `AMERIQUOTE_ACA_SRC`                  | `PVNACA_aged` |                                          |
| `INSURANCE_LEAD_DELIVERY_CONCURRENCY` | `4`           | 1–20.                                    |

---

## Checklist for a new integration

1. Post one real lead with `?deliver=true`. Confirm `MATCHED` and a lead id.
2. Import a batch of 50 without `deliver`. Run preflight. Confirm `mode: LIVE`
   and that `blocked` is what you expect.
3. Send it. Check the match rate.
4. Only then scale up — and watch for the rate going to zero.

Related: `docs/CSV_LEAD_IMPORT_TO_BUYER.md` for the CSV path and the full
account of the August 2026 run.
