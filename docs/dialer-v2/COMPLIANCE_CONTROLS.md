# DIALER V2 — COMPLIANCE CONTROLS

## 0. Scope statement — read this first

This system provides **configurable controls and an evidence trail**. It does not make a
campaign lawful, and nothing in this document is legal advice. Whether a given campaign
complies with the TCPA, the TSR, state telemarketing statutes, state recording-consent
statutes, or any non-US regime depends on facts this software cannot verify: the nature of
the relationship with the contact, the content of the call, and the provenance of consent.

Defaults are chosen to be conservative. **Defaults are not a compliance program.** Each
tenant must configure a compliance profile with counsel, and the platform must not present
"defaults accepted" as "compliant".

## 1. Control points

Compliance is evaluated at three distinct points, because passing an earlier check does not
imply the later one still holds:

1. **Lead selection** — cheap, indexed predicates in the selection query (DNC, calling
   hours, attempt limits, suppression). Excludes the bulk of ineligible leads before any
   work is done.
2. **Pre-originate gate** — authoritative re-check immediately before ESL originate, inside
   the same code path that places the call. State can change between selection and dial
   (a DNC entry added, a window closing), and this is the check that actually blocks.
3. **In-call and post-call** — recording-consent handling, abandonment accounting,
   safe-harbor treatment.

Every evaluation at points 1 and 2 writes a `dialer_v2_compliance_decision` row. Allows are
recorded, not just blocks — an evidence trail that only records refusals cannot demonstrate
that a permitted call was permitted.

## 2. Suppression sources

Checked in order; first block wins and short-circuits:

| Source                                  | Backing                                         |
| --------------------------------------- | ----------------------------------------------- |
| Platform suppression                    | `DncList` type `GLOBAL`                         |
| Tenant DNC                              | `DncList` scoped to tenant                      |
| Campaign DNC                            | `DncList` type `CAMPAIGN`                       |
| Seller-specific DNC                     | tenant-scoped list keyed by seller              |
| National DNC                            | **interface only** — see §7                     |
| State suppression                       | state rules by area code + contact state        |
| Litigator / reassigned-number screening | **interface only** — see §7                     |
| Prior outcome                           | `DO_NOT_CALL` disposition, invalid/disconnected |
| Wireless / reassignment flags           | `CarrierLookup`                                 |

Phone numbers are normalized to E.164 before every lookup. A normalization failure is a
**block**, not a pass — an unparseable number is never dialed.

## 3. Calling hours

Local time is computed for the **contact**, resolved in this order: explicit
`lead.timezone` → state → area code → campaign default. Area-code inference is the weakest
link (number portability) and is recorded in the decision row so an audit can distinguish a
verified local time from an inferred one.

Defaults: 08:00–21:00 contact local time, with per-state overrides where stricter, plus a
campaign holiday calendar. A campaign may narrow these; it may not widen them past the
tenant's compliance profile ceiling without a recorded override (§8).

Windows are re-evaluated at the pre-originate gate, so a call is never placed a second
after a window closes.

## 4. Abandonment

Default configurable ceiling **3.0%** of live-answered calls per campaign over the
compliance measurement period, with a stricter internal warn threshold at **2.0%**.

A call counts as abandoned when a live human answers and no agent is connected within the
assignment deadline (default 2 s). The measurement is taken from **telephony events**
(`CHANNEL_ANSWER` → `CHANNEL_BRIDGE`), not from the fact that a bridge command was
submitted — the mandate's §4.7 requirement, and the difference between a real metric and a
self-congratulatory one.

Behavior at the warn threshold (`PREDICTIVE_PACING_SPEC.md` §4.6): pacing damps linearly,
supervisors are alerted, the decision is recorded. At the hard ceiling: pacing goes to zero
and the campaign pauses.

Ring duration before treating a call as unanswered defaults to **15 seconds or four rings**.

## 5. Safe harbor

When a live human answers and no agent can be connected within the deadline, the campaign's
configured safe-harbor treatment plays: a recorded identification message stating the
caller's name and telephone number, containing no sales content.

A campaign in PREDICTIVE or POWER mode **cannot be started without safe-harbor audio
configured**. This is a preflight failure, not a warning — a predictive campaign without a
safe-harbor message will eventually abandon a call to a real person with dead air.

## 6. Caller ID

- Every outbound call presents a caller ID the tenant is authorized to use, verified
  against `PhoneNumber` ownership at origination.
- **No hard-coded fallback.** `CURRENT_STATE_AUDIT.md` F-6 documents the current
  `+18656000124` fallback, which can present one tenant's number on another tenant's call.
  V2's behavior when no valid caller ID is available is to **pause the campaign** and alert.
  Given the July 2026 toll-fraud and carrier-disable incident, silently substituting an
  unverified number is the failure mode most likely to cost the platform its carrier.
- STIR/SHAKEN attestation status is recorded per attempt. Falling below the campaign's
  minimum attestation opens a circuit breaker on that route.

## 7. Interfaces that are deliberately not implementations

The following are defined as interfaces with no live provider wired in this branch, and the
UI labels them "not configured" rather than showing a green check:

- National DNC registry (requires a registered Organization ID and a subscription)
- Litigator screening
- Reassigned Numbers Database
- TrustedForm / Jornaya certificate verification (the `ConsentToken` model exists; live
  verification does not)

Presenting an unwired check as passing would be worse than not having it. Preflight shows
these as explicitly unconfigured so an operator cannot mistake absence for approval.

## 8. Overrides

Any override requires: an explicit permission (`compliance:override`), a written reason, a
named approver, an expiry, and an immutable `dialer_v2_compliance_decision` +
`dialer_v2_audit_event` pair. Overrides are never silent and never permanent.

Some controls are **not overridable in software**: the platform abandonment ceiling, the
caller-ID ownership check, and E.164 normalization. These have no override path at all,
which is a deliberate design decision rather than an omission.

## 9. Recording consent

Per-campaign profile: `ALL_PARTY`, `ONE_PARTY`, or `BY_STATE`. In `BY_STATE`, the contact's
resolved state selects the treatment, and an unresolved state falls back to the **stricter**
all-party handling. Consent announcements are configured per profile; recording start is
gated on the announcement having played.

## 10. Evidence and retention

`dialer_v2_compliance_decision` is append-only — no update path, no delete path, minimum
five-year retention. Exportable per campaign and per period: attempts, blocks by rule,
abandonment with numerator and denominator, safe-harbor treatments, overrides with approver,
caller IDs used, and agent assignment timings.

Reports reconcile to raw attempts by construction: aggregates are derived from
`dialer_v2_call_attempt` and every figure drills through to the individual rows behind it.
