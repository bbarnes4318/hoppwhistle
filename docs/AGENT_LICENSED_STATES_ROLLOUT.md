# Rolling out AGENT licensed-state enforcement

PR #120 makes an AGENT's access conditional on the states they are licensed in,
and it **defaults to deny**. An agent with no licence performs no
state-authorized operation, and a lead carrying no readable state is served to
no agent.

That is the correct rule and it is not negotiable. What it means operationally
is that **on a database that has never recorded a licence, every agent starts
with nothing**. This document is how to not find that out from a support queue.

---

## 1. There is no licence data to back-fill from

This was checked exhaustively before it was written down. Every `state` column in
the schema:

| Column                                                                 | What it actually holds                            |
| ---------------------------------------------------------------------- | ------------------------------------------------- |
| `Lead.state`, `InsuranceLead.state`, `ProspectIntake.state`            | the **prospect's** address                        |
| `InsuranceCarrierApplication.state`, `.stateOfBirth`, `.bankCityState` | the **applicant's** details                       |
| `Call.callerIdState`                                                   | the **caller's** state, from the area code        |
| `BuyerEndpoint.acceptedStates`                                         | a **buyer's** routing preference                  |
| `AgencyProfile.state`                                                  | one state for the whole **agency**                |
| `Tenant.ratingState`, `RateCurveVersion.states`                        | billing status — not a US state at all            |
| `User.stateEvents`                                                     | softphone availability (`available`/`away`/`dnd`) |
| `LeadDialReservation.state`                                            | a reservation enum                                |

There is no NPN, no licence number, no producer number and no carrier
appointment anywhere in the schema or the codebase — the greps return nothing.
`User.metadata` has only ever carried `position`, `defaultScript`,
`customScripts`, `extension`, `tempPassword`, `invitedBy` and a legacy
`publisherId`. `CampaignAgent` has no state column.

**So: BACKFILL NOT SAFE WITHOUT EXPLICIT LICENSE DATA.** The two sources that
look closest are the two worst:

- **the states of leads an agent has handled** is a record of what they were
  _given_ — which is the very thing the licence is meant to constrain. Reading
  it back as their licence would ratify every past violation and guarantee the
  enforcement can never catch anything;
- **the agency's home state** is one state for an entire agency, and an agency
  in Tennessee employs agents licensed in Florida. It would be simultaneously
  too narrow for most agents and wrong for the rest.

A licence is a legal fact about a person. It gets typed in by somebody who knows
it, or it does not exist.

## 2. Before you merge: find out where you stand

Read-only. Every statement is a `SELECT`; it creates no table, not even a
temporary one. Safe against production, which is the only place worth running it.

```bash
scripts/licensed-states-report.sh                       # DATABASE_URL from apps/api/.env
scripts/licensed-states-report.sh --url "postgresql://…"
scripts/licensed-states-report.sh --csv-dir ./out       # also write each section as CSV
```

Exit status: **0** ready, **1** configuration or cleanup needed first, **2**
could not tell.

It reports every AGENT and the licence they hold; exactly who would be blocked
and why; licence entries that are stored but unreadable (these grant nothing);
AGENT-owned leads broken down by whether their state is usable; and, for the
leads whose state is not, whether the original inbound payload can repair it.

It deliberately does **not** suggest what any agent's licence should be.

## 3. Configure the licences

`metadata.licensedStates` is writable on **today's** production code — the
existing `PATCH /api/v1/users/:userId` has always merged a metadata object and
has always been admin-and-owner-only. So the licences can be populated _before_
this PR ships, and the deploy then lands on a database that is already ready.

The supported path:

```bash
pnpm --filter @hopwhistle/api agents:licenses                        # report
pnpm --filter @hopwhistle/api agents:licenses -- --list  a@agency.com
pnpm --filter @hopwhistle/api agents:licenses -- --set   a@agency.com TN,FL
pnpm --filter @hopwhistle/api agents:licenses -- --clear a@agency.com
```

`--set` replaces the licence with exactly the states given — it never widens,
never infers, and running it twice leaves the same list. It validates through the
same `normalizeStateCode()` the enforcement uses, so what you are told you
granted is what will be enforced, and it refuses the whole call on a typo rather
than silently dropping it: an operator who pastes `Tennesee` and is told nothing
has granted a licence they believe they granted. It merges rather than replaces
`metadata`, so an agent's softphone extension survives.

It does not create accounts and does not grant roles.

> There is **no UI** for this. The only screen that calls `PATCH
/api/v1/users/:userId` is the pending-approvals list, and it sends `status`
> only. Building a licensing screen was deliberately left out of this step.

## 4. Leads whose state cannot be read

Do not invent a state to make a lead visible, and do not relax the check.

`InsuranceLeadSubmission.rawPayload` keeps the original inbound JSON verbatim,
so where it carries a state the column does not, the column can be repaired
**from the source record** rather than guessed. Section 6 of the report counts
exactly that, in three buckets:

- **repairable from source** — the raw payload holds a valid code;
- **source is a name or junk** — the raw payload holds something like
  `"Tennessee"`, which the existing `normalizeState()` in
  `services/insurance-lead-validator.ts` mangles to `"TE"` because it is
  `toUpperCase().slice(0, 2)`. Repairable, but it needs a resolver, not a
  truncation;
- **no source** — nothing to repair from. These need the vendor, or they stay
  unassigned to any agent.

Run the report first. If those counts are zero, there is nothing to do here.

## 5. Pre-deployment checklist

1. `scripts/licensed-states-report.sh --csv-dir ./out` against production. Keep
   the CSVs; they are the before-picture.
2. For every agent in section 2, get their **actual** licensed states from
   whoever holds that record — not from this database.
3. `pnpm --filter @hopwhistle/api agents:licenses -- --set <email> <STATES>` for
   each. Re-run freely; it is idempotent.
4. Resolve anything in section 3 (stored but unreadable) by re-setting that
   agent's licence properly.
5. Decide on section 4/6 (leads with no usable state). Either repair from the
   source record or accept that those leads reach no agent until they are fixed.
6. Re-run the report. **Merge and deploy when it exits 0.**
7. After the deploy, spot-check one agent: they should see their own leads in
   their licensed states, and get `403 STATE_NOT_LICENSED` on one outside them.

## 6. What is NOT an acceptable way out

- making a missing licence mean "all states";
- skipping the check for accounts that existed before the deploy;
- inferring a licence from lead history, agency state, campaign states, or any
  address field;
- widening `AGENCY_PRINCIPAL_ROLES` or granting agents ADMIN to get them moving.

The rule is: **no verified licensed states, no state-authorized AGENT
operation.** The rollout problem is a data problem, and it gets solved in the
data.
