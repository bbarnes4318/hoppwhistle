# DIALER V2 — VICIDIAL PARITY MATRIX

Status legend: **✅ done** (implemented + tested in this repo) · **🔨 phase N** (planned,
phase assigned) · **⬜ backlog** (post-Phase 6) · **🚫 won't** (deliberate non-goal)

Nothing is marked ✅ that is not covered by a passing test in this repository.

## Dialing modes

| Capability             | VICIdial | Hoppwhistle today    | V2                             | Phase |
| ---------------------- | -------- | -------------------- | ------------------------------ | ----- |
| Manual / click-to-call | ✔       | ✔ (softphone)       | keep existing                  | —     |
| Preview                | ✔       | ✖                   | 🔨                             | 2     |
| Progressive            | ✔       | ✖                   | 🔨                             | 2     |
| Power (ratio)          | ✔       | partial (global cap) | 🔨                             | 2     |
| Predictive (adaptive)  | ✔       | ✖                   | ✅ controller + sim; 🔨 wiring | 3     |
| Agentless / broadcast  | ✔       | ✖                   | 🔨                             | 3     |
| AI voice agent         | ✖       | ✔ (Dograh)          | keep + integrate               | 6     |
| AI → human transfer    | ✖       | ✖                   | 🔨                             | 6     |
| Inbound                | ✔       | ✔ (DID routing)     | keep + ACD                     | 4     |
| Blended                | ✔       | ✖                   | 🔨                             | 4     |

## Pacing

| Capability                     | VICIdial | Today | V2                    | Phase |
| ------------------------------ | -------- | ----- | --------------------- | ----- |
| Adaptive pacing                | ✔       | ✖    | ✅                    | 3     |
| Answer-rate forecasting        | ✔       | ✖    | ✅ Beta-Binomial      | 3     |
| Agent-availability forecasting | partial  | ✖    | ✅ survival model     | 3     |
| Abandonment control loop       | ✔       | ✖    | ✅ linear damping     | 3     |
| Auto mode degradation          | partial  | ✖    | ✅                    | 3     |
| Anti-oscillation               | ✖       | ✖    | ✅ ramp limit         | 3     |
| Explainable decisions          | ✖       | ✖    | ✅ binding constraint | 3     |
| Shadow mode                    | ✖       | ✖    | 🔨                    | 1     |
| Deterministic simulator        | ✖       | ✖    | ✅                    | 3     |

Explainability and shadow mode are the clearest places V2 exceeds VICIdial rather than
matching it: VICIdial's pacing is effectively opaque to the operator.

## Agents

| Capability              | VICIdial          | Today     | V2              | Phase |
| ----------------------- | ----------------- | --------- | --------------- | ----- |
| Agent presence / states | ✔ (~10)          | partial   | 🔨 19 states    | 1     |
| Reservation before dial | ✖                | ✖        | 🔨              | 2     |
| Skills + proficiency    | ✔                | ✖        | 🔨              | 4     |
| Pause codes             | ✔                | ✖        | 🔨              | 2     |
| Wrap-up timer           | ✔                | ✖        | 🔨              | 2     |
| Stale detection         | weak              | ✖        | 🔨 multi-source | 1     |
| WebRTC softphone        | via WebRTC add-on | ✔ sip.js | keep            | —     |
| Screen pop              | ✔                | ✔        | keep + extend   | 2     |
| Hotkeys                 | ✔                | ✖        | 🔨              | 5     |

Multi-source staleness (browser heartbeat **and** SIP registration **and** FS channel state)
is a deliberate improvement: VICIdial's agent state can disagree with reality after a
browser crash, and predictive pacing on a phantom agent is exactly how abandonment happens.

## Leads and lists

| Capability                     | VICIdial | Today        | V2                | Phase |
| ------------------------------ | -------- | ------------ | ----------------- | ----- |
| CSV import + mapping           | ✔       | partial      | 🔨                | 5     |
| List priority / weight         | ✔       | ✖           | 🔨                | 2     |
| Attempt limits                 | ✔       | ✖           | 🔨                | 2     |
| Retry rules by outcome         | ✔       | ✖           | 🔨                | 2     |
| Recycle rules                  | ✔       | ✖           | 🔨                | 2     |
| Alternate phone numbers        | ✔       | ✖           | 🔨                | 2     |
| Callbacks (agent / any)        | ✔       | ✖           | 🔨                | 4     |
| Lead locking / lease           | weak     | **✖ (F-4)** | 🔨 partial unique | 2     |
| Duplicate-active-attempt guard | weak     | ✖           | 🔨 DB-enforced    | 2     |
| Time-zone restriction          | ✔       | ✖           | 🔨                | 2     |

## Compliance

| Capability                  | VICIdial | Today       | V2                          | Phase |
| --------------------------- | -------- | ----------- | --------------------------- | ----- |
| Internal DNC                | ✔       | schema only | 🔨                          | 2     |
| National DNC                | ✖       | ✖          | 🔨 interface only           | 2     |
| Calling hours by local time | ✔       | ✖          | 🔨                          | 2     |
| Consent records             | ✖       | schema only | 🔨                          | 2     |
| Abandonment ceiling         | partial  | ✖          | ✅ controller; 🔨 reporting | 3     |
| Safe harbor message         | ✔       | ✖          | 🔨                          | 3     |
| Immutable evidence log      | ✖       | ✖          | 🔨                          | 2     |
| Litigator screening         | ✖       | ✖          | 🔨 interface only           | 2     |

## Carrier and caller ID

| Capability                   | VICIdial | Today         | V2                      | Phase |
| ---------------------------- | -------- | ------------- | ----------------------- | ----- |
| Multi-gateway failover       | ✔       | ✔ FracTEL ×6 | keep + circuit breakers | 2     |
| Caller-ID rotation           | ✔       | ✔ per tenant | keep + limits           | 2     |
| Local presence               | add-on   | ✖            | 🔨                      | 5     |
| Per-number daily/hourly caps | ✖       | ✖            | 🔨                      | 5     |
| Quarantine / spam status     | ✖       | ✖            | 🔨                      | 5     |
| No unauthorized fallback CID | ✖       | **✖ (F-6)**  | 🔨 pause instead        | 2     |
| STIR/SHAKEN                  | ✖       | ✔            | keep                    | —     |
| Per-carrier CPS              | ✔       | ✖            | 🔨                      | 2     |

## Supervisor

| Capability                 | VICIdial | Today | V2                     | Phase |
| -------------------------- | -------- | ----- | ---------------------- | ----- |
| Real-time agent grid       | ✔       | ✖    | 🔨                     | 5     |
| Listen / whisper / barge   | ✔       | ✖    | 🔨                     | 5     |
| Campaign start/pause/drain | ✔       | ✖    | 🔨                     | 5     |
| Emergency stop             | ✖       | ✖    | ✅ flag; 🔨 UI         | 5     |
| "Why is this not dialing?" | ✖       | ✖    | ✅ gate reasons; 🔨 UI | 5     |
| Live transcript            | ✖       | ✖    | 🔨                     | 6     |

## Multi-tenancy

| Capability                 | VICIdial | Today           | V2             | Phase  |
| -------------------------- | -------- | --------------- | -------------- | ------ |
| Per-tenant concurrency     | ✖       | **✖ (F-3)**    | 🔨             | 0–2    |
| Tenant-scoped Redis        | n/a      | ✖              | ✅ key builder | 0      |
| Cross-tenant isolation     | weak     | gaps documented | 🔨             | prereq |
| Per-tenant caller-ID pools | ✖       | ✔              | keep + enforce | 2      |

VICIdial is effectively single-tenant; per-tenant concurrency, isolation, and quota are
where V2 is a different class of product rather than a better version of the same one.

## Deliberate non-goals

| Item                                         | Why                                                   |
| -------------------------------------------- | ----------------------------------------------------- |
| Asterisk compatibility                       | 🚫 stack is FreeSWITCH                                |
| VICIdial schema import                       | 🚫 no demand; would constrain the data model          |
| On-prem installer                            | 🚫 SaaS product                                       |
| ML pacing in v1                              | 🚫 must beat the transparent baseline in replay first |
| Manual dial-ratio override above safety caps | 🚫 the caps are the abandonment protection            |
