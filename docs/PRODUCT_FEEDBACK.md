# Feedback & Roadmap

A two-way loop between an agency's people and the product team. Agents,
managers, owners and admins send an idea, a problem, a workflow or a complaint
from **Feedback & Roadmap** (`/feedback`), then follow it from review to
release. The product team runs every agency's feedback from **Admin → Product
feedback** (`/admin/product-feedback`): triage, priority, owner, target, public
updates, internal notes, questions, merges, shipping.

Built first for Life Leads Plus; it works for every agency, in each agency's own
brand. Agency-facing copy says "the product team" — never the platform's name.

| Piece                                    | Where                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Vocabulary (statuses, targets, labels)   | `packages/shared/src/product-feedback.ts`                                                                                      |
| Migration                                | `apps/api/prisma/migrations/20261017000000_product_feedback/`                                                                  |
| Who reads what (visibility, serialisers) | `apps/api/src/services/product-feedback/access.ts`                                                                             |
| Emails to submitters and followers       | `apps/api/src/services/product-feedback/notify.ts`                                                                             |
| API (agency and staff)                   | `apps/api/src/routes/product-feedback.ts`                                                                                      |
| Agency screen                            | `apps/web/src/components/feedback/feedback-roadmap.tsx`                                                                        |
| Staff console                            | `apps/web/src/components/feedback/staff/`                                                                                      |
| API security and lifecycle tests         | `apps/api/src/__tests__/product-feedback.test.ts`                                                                              |
| Navigation and rendered tests            | `apps/web/src/components/layout/__tests__/feedback-nav.test.ts`, `apps/web/src/app/__tests__/feedback-roadmap.render.test.tsx` |
| Sample data (non-production only)        | `apps/api/prisma/product-feedback-demo-seed.ts`                                                                                |

## Model

```
ProductFeedback                one request; tenantId from the session (null = product-team item)
 ├─ ProductFeedbackVote (*)    "I want this too"; UNIQUE (feedbackId, userId)
 ├─ ProductFeedbackComment (*) PUBLIC_UPDATE | QUESTION | USER_REPLY | INTERNAL_NOTE
 ├─ ProductFeedbackStatusEvent (*)  every status actually reached: the timeline
 └─ ProductFeedbackRead (*)    when a person last opened it: the "New update" marker
```

Statuses: `NEW → UNDER_REVIEW → PLANNED → IN_PROGRESS → TESTING → SHIPPED`, plus
`NEEDS_INFO`, `CONSIDERING`, `NOT_PLANNED` and `MERGED`. A target is a kind
(`WEEK`, `MONTH`, `QUARTER`, `DATE`, `NONE`) and the day its period starts, so
"Next week" turns into "This week" on its own; it is always shown as
"Target: …", never as a promise.

## Who sees what

Enforced on the server, in `visibleWhere` and the serialisers — never by hiding
things in the browser. A request this viewer may not read answers **404**.

| Visibility | Readers besides the product team                            |
| ---------- | ----------------------------------------------------------- |
| `PRIVATE`  | the submitter, and their agency's OWNER and ADMIN (default) |
| `TENANT`   | everybody in the submitting agency                          |
| `PUBLIC`   | every agency — the roadmap                                  |

- Outside the submitting agency a reader gets the **public title and summary**
  only: not the submitter's words, not their name.
- A question and the replies to it are seen by the submitter and their
  agency's admins only. Internal notes are never selected by an agency route.
- Priority, owner, browser context and the source route exist only in staff
  responses.
- Every staff change is audited (`product_feedback.*` in `audit_logs`) with who,
  when, and each field's before and after.

## Deploying

Additive: seven enum types, five tables. Listed in
`scripts/deploy-netenroll.sh` with its applied-state probe; to apply by hand:

```
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f apps/api/prisma/migrations/20261017000000_product_feedback/migration.sql
```

## Sample data

For a demo or screenshots, into a tenant marked `isNonProduction` only (it
refuses a real agency by name):

```
pnpm --filter @hopwhistle/api db:seed:feedback-demo -- --tenant <slug>
```

Every row it writes is tagged `clientContext.sample`, shown as "Sample data" in
the staff console, and replaced on the next run.

## Notifications

Email, in the recipient's agency brand, best-effort: the submitter hears when
their request is planned, started, shipped, not planned, needs information, or
gets a public update or a merge; everybody who wanted it hears when it ships.
Inside the app the "New update" marker and the My Feedback badge are the
signal; there is no in-app notification centre in this product yet.
