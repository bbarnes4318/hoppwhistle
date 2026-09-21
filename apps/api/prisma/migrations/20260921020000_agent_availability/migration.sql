-- An agent's own declaration of whether they are taking calls.
--
-- ── What was wrong ───────────────────────────────────────────────────────────
--
-- An agent had no working way to stop calls reaching them.
--
-- There were TWO controls that looked like they did it, and neither did:
--
--   1. The Available/Away/On-call dropdown in the call-centre header. It was
--      bound to a React `useState` in `CallCenterPortal` and was never sent
--      anywhere. Setting it changed a variable in the browser and nothing else
--      -- while driving the large banner at the top of the console, so an agent
--      who picked "Away" read AWAY in capitals with calls still ringing. The
--      change that adds this column removes that dropdown.
--
--   2. `AgentStatusSelector` in the softphone panel. That one does reach
--      `PUT /api/v1/agent/status`, which writes `agent:status:<id>` in Redis --
--      but `services/routing.ts` deliberately ignores that key, and says why:
--      it is browser-inferred state that goes stale when a tab closes, and
--      excluding agents on it silenced people who were sitting there ready.
--
--      For an agent trying to step away it is worse than ignored. The softphone
--      writes 'available' unconditionally on SIP registration and on every
--      reconnect, so a transport blip silently undid the agent's own choice.
--      The key also carries a 24-hour TTL.
--
-- So "turn my phone off" was not expressible. An agent at lunch, on a break, or
-- finishing paperwork kept being rung, and the call went to somebody who could
-- not take it instead of to somebody who could.
--
-- ── What this column is ──────────────────────────────────────────────────────
--
-- A DELIBERATE, DURABLE fact: a person saying "I am not taking calls".
--
-- It is deliberately separate from the Redis presence key rather than replacing
-- it. The two answer different questions and the presence key is still the
-- right answer to its own: what is this agent's softphone doing right now, for
-- the live view and the availability-seconds figure on the delivery page.
-- Nothing automatic writes THIS column -- only an explicit act by the agent or
-- their principal -- which is exactly what makes it safe for routing to obey.
--
-- ── DEFAULT true, and it has to be ───────────────────────────────────────────
--
-- Every existing agent becomes available, and that is the whole safety property
-- of this migration. A default of false would take the entire platform off the
-- queue the moment it deployed, with every agent wondering why the phones went
-- quiet -- the same trap the licence and schedule rollouts were written to
-- avoid.
--
-- `availabilityChangedAt` stays NULL until somebody first toggles it, so "never
-- touched" and "turned on at 9am" stay distinguishable.
--
-- ── How this migration is applied ────────────────────────────────────────────
--
--     psql "$DATABASE_URL" -f apps/api/prisma/migrations/20260921020000_agent_availability/migration.sql
--
-- Additive only and idempotent. It adds two columns with defaults, which
-- PostgreSQL 11+ applies without rewriting the table. It drops nothing, alters
-- no existing column, and changes no existing value.

BEGIN;

ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "availableForCalls" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "availabilityChangedAt" TIMESTAMP(3);

COMMIT;
