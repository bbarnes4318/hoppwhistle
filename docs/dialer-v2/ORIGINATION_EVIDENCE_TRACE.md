# Origination evidence trace

What a reconciler can actually learn about an attempt that reached
`NEEDS_RECONCILIATION`, established by reading the code rather than by querying a
switch. Nothing in this document was produced by contacting FreeSWITCH,
staging, or production.

The short version: **the correlation id is constructed correctly and is
persisted nowhere.** Every durable answer a reconciler needs is missing, and one
of them — proof that a channel never existed — cannot be obtained from a live
FreeSWITCH at all, in principle, not merely in this repository.

---

## The path, end to end

| Stage | Where | What happens |
|---|---|---|
| Attempt id created | [lead-reservation-store.ts:112](apps/worker/src/services/lead-reservation-store.ts:112) | `crypto.randomUUID()` at reserve time, one per reservation, written to `lead_dial_reservations."attemptId"` in the same `INSERT` that claims the lead |
| Recorded before use | [dialer-worker.ts:401](apps/worker/src/services/dialer-worker.ts:401) | transition to `ORIGINATION_SUBMITTED` commits **before** the command is built |
| Put on the channel | [dialer-worker.ts:551](apps/worker/src/services/dialer-worker.ts:551) | `hopwhistle_attempt_id=${attemptId}` inside the originate `{…}` variable block |
| Read back off events | [normalize.ts:237](apps/dialer-v2/src/events/normalize.ts:237) | `variable_hopwhistle_attempt_id` → `NormalizedTelephonyEvent.attemptId` |
| Ingested | [ingestor.ts:92](apps/dialer-v2/src/events/ingestor.ts:92) | normalize → dedupe → `store.append` → notify |
| Persisted | [store.ts:48](apps/dialer-v2/src/events/store.ts:48) | **`InMemoryEventStore` — the only implementation that exists** |

## The twelve questions

**1. Does `hopwhistle_attempt_id` actually reach the FreeSWITCH channel?**

By construction yes, and in practice never. Variables inside the `{…}` block of
an `originate` are applied to the originated channel before it is created, so the
id is set on the A-leg for the whole of its life. But `originateCall()` throws
`OriginationDisabledError` before the command string is assembled unless
`LEGACY_HOPPER_ORIGINATION_ENABLED=true`, which is set in no workflow, no compose
file, no Dockerfile and no example environment — CI asserts that. No channel has
ever carried this id. That is a static claim about the ESL contract, not an
observation.

**2. Which ESL events return it?**

FreeSWITCH emits channel variables as `variable_*` headers on channel events, so
every subscribed event on that channel carries it: `CHANNEL_CREATE`,
`CHANNEL_ORIGINATE`, `CHANNEL_PROGRESS`, `CHANNEL_PROGRESS_MEDIA`,
`CHANNEL_ANSWER`, `CHANNEL_BRIDGE`, `CHANNEL_UNBRIDGE`, `CHANNEL_HANGUP`,
`CHANNEL_HANGUP_COMPLETE`, `DTMF`, `RECORD_START`, `RECORD_STOP`
([types.ts:28](apps/dialer-v2/src/events/types.ts:28)). The `sofia::*` CUSTOM
subclasses are registration events on no channel and carry nothing.

**3. Is it preserved through bridge, transfer and hangup?**

On its own channel, yes — including `CHANNEL_HANGUP_COMPLETE`, which is what
makes a terminal verdict possible at all. **Not on the other leg.** A bridged
agent leg is a separate channel with its own variable set; the only link is
`Other-Leg-Unique-ID`, which `normalize.ts` does capture. So evidence about
whether a *human* was reached lives partly on a channel that does not carry the
attempt id, and must be joined through the leg uuid.

**4. Where is the evidence persisted?**

Nowhere durable. `EventStore` has exactly one implementation and it is
in-memory. [`buildStores`](apps/dialer-v2/src/stores/provider.ts:106) returns
`new InMemoryEventStore()` in **both** branches — including the Redis branch,
where the comment is explicit: raw event bodies stay in memory. `RedisDedupeStore`
persists event *ids* for deduplication and holds no evidence.

**5. How long is that evidence retained?**

A bounded FIFO ring of 10 000 events in one process's heap, evicted oldest-first,
lost completely on restart. Dedupe keys live 24 h in Redis and carry nothing but
"seen".

**6. Can the application identify an active channel by attempt id?**

No. `EventStore` exposes `recentForTenant(tenantId, limit)` and nothing keyed by
attempt. No ESL query capability exists to ask the switch either — see 11.

**7. Can it identify a completed channel by attempt id?**

No, for the same reasons, and one worse one. FreeSWITCH's live channel list
describes channels that exist *now*. A completed call leaves no queryable trace
there once the channel is destroyed, so the switch can never distinguish
"hung up two seconds ago" from "never created". Terminal verdicts require a
durable ledger; the live switch cannot supply them.

**8. Can it distinguish "never accepted" from "accepted but evidence delayed"?**

No. Both present identically as no evidence.

**9. Does an application restart lose required evidence?**

Yes — all of it. And the loss is not even confined to restarts: the ingestor runs
in `apps/dialer-v2`, the reconciler must run in `apps/worker`, and these are
separate processes with separate heaps. `apps/worker` cannot read
`InMemoryEventStore` at any point in its lifetime. `dialer-v2` is also absent
from the main stack (`infra/docker/docker-compose.yml`); it ships in its own
`docker-compose.dialer-v2.yml`.

**10. Are duplicates or out-of-order delivery expected?**

Yes, both, and the ingestor already handles them. `eventId` is a content hash
([normalize.ts:128](apps/dialer-v2/src/events/normalize.ts:128)) so a redelivered
event dedupes to the same id; `EVENT_STATE_RANK` counts backwards moves rather
than rejecting them. Any reconciler must be idempotent for the same reason.

**11. What read-only FreeSWITCH queries are already supported?**

Almost none. `EslClient` writes exactly one command ever — the `event`
subscription — and deliberately never exposes the socket, so no caller can reach
past it. The one real API call in the repository is the Hopper's
`api('show', 'calls count')` at
[dialer-worker.ts:458](apps/worker/src/services/dialer-worker.ts:458): read-only,
but a capacity check on the dialing path, not an attempt lookup. There is no
`uuid_exists`, no `uuid_getvar`, no `show channels` capability anywhere.

**12. What evidence is missing?**

1. A durable, attempt-indexed event ledger. Nothing survives a restart.
2. Cross-process access to it. The reconciler and the ingestor do not share a heap.
3. A read-only ESL query port. Built in this round; see below.
4. **Positive proof of absence, which no live switch can give.** This one is not
   a gap in the repository, it is a property of the system being queried.

---

## What this means for the contract

Point 12.4 decides the design. Three outcomes the spec names can be produced from
a live switch and three cannot:

| Outcome | Obtainable from a live FreeSWITCH? |
|---|---|
| `ACTIVE_CALL_CONFIRMED` | **Yes.** A channel present in the live list, carrying this attempt id, is positive proof. |
| `EVIDENCE_CONFLICT` | **Yes.** Two live channels for one attempt is positive proof of a conflict. |
| `FREESWITCH_UNREACHABLE` | **Yes.** The transport says so. |
| `COMPLETED_CALL_CONFIRMED` | **No.** Needs a terminal event from the ledger. |
| `ORIGINATION_REJECTED_CONFIRMED` | **No.** Needs the recorded rejection body. |
| `NO_CHANNEL_CONFIRMED` | **No, and not in principle.** An empty channel list is absence of evidence. |

So `NO_CHANNEL_CONFIRMED` is declared in the contract — the spec requires the
distinction to exist — and is **reachable only from an explicit ledger record
asserting no channel was created**. It is never inferred from an empty query
result. Because no durable ledger exists yet, it is unreachable in this
repository today, and the classifier's negative path terminates in
`MANUAL_REVIEW_REQUIRED` instead. That is the spec's own instruction where
positive proof cannot be produced, and it is enforced by test rather than by
convention.

`COMPLETED_CALL_CONFIRMED` and `ORIGINATION_REJECTED_CONFIRMED` are implemented
and tested against injected ledger evidence, so the classifier is complete and
correct the moment a durable store is wired in. They are equally unreachable
today, for the same reason, and the classifier says so in its `reason` string
rather than silently returning something weaker.

---

## Stop conditions this trace triggers

From the round's Phase 13:

- **"FreeSWITCH evidence can disappear before reconciliation runs."** Confirmed,
  and stronger than the wording assumes: it is never durably written at all, and
  the reconciler could not read it if it were.
- **"No existing read-only FreeSWITCH query can prove the required condition."**
  Confirmed for every terminal and negative outcome.

Neither blocks the pure contract, the injected adapter, the allowlist, the
reconciler, the operator path, the audit tooling, the fixtures, the CI guards or
this document — all of which are delivered. What they block is any automatic
resolution of an uncertain attempt into "safe to dial again". That resolution
requires an operator until a durable event ledger exists, and the code refuses to
guess in the meantime.

## What would close the gap

A PostgreSQL `EventStore` implementation, indexed on `(tenantId, attemptId)`,
written by the ingestor and readable by the worker — the migration for which is
already drafted in [DATA_MODEL.md](docs/dialer-v2/DATA_MODEL.md) and deliberately
not applied. That is a separate change with its own migration story; it is not
smuggled into this one.
