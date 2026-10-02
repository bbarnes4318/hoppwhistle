"""Read-only preflight for the FracTEL inbound DID -> Dograh workflow mapping.

Resolves the three IDs needed before any write:

1. ``workflows.id`` for the exact workflow name (default: the Final Expense
   live-transfer workflow).
2. ``telephony_configurations.id`` for the Asterisk ARI config (``provider='ari'``).
3. Current ``telephony_phone_numbers`` row counts for that config.

It also runs the **shared-config check**, which is the reason this script exists
separately from the importer. Dograh's outbound caller-ID rotation pool is seeded
from *every active row* in ``telephony_phone_numbers`` for an
(organization_id, telephony_configuration_id) pair — there is no pool-tag filter
in the selection path (``extra_metadata.pool`` is only read by reporting). See
``deploy/dograh/pool_state_inventory.py`` (``total_active_caller_ids``) and the
docstring of ``deploy/dograh/import_state_caller_ids.py``.

Inbound lookup requires ``is_active = true``, so inbound rows cannot be hidden
from that pool by deactivating them. If the ARI config that answers inbound is
the same config the campaigns dial out on, then adding 2777 inbound DIDs also
adds 2777 outbound caller IDs. This script reports whether that is the case so
the decision is made on evidence rather than assumption.

This script writes nothing. Run it first, read the report, then decide.

Run inside the dograh api container (has asyncpg + DATABASE_URL):
  docker cp deploy/dograh/inbound-dids/. dograh-api-1:/tmp/inbound-dids/
  docker exec dograh-api-1 python /tmp/inbound-dids/resolve_inbound_ids.py
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os

WORKFLOW_NAME = (
    "Final Expense Outbound Calls with goal of Live Transfers to licensed agents "
    "- outbound"
)


async def safe_fetch(conn, sql: str, *params):
    """Run a query, returning ``(rows, None)`` or ``([], "error text")``.

    The preflight touches tables whose exact columns we have not verified on this
    deployment. One unexpected column must not cost us the rest of the report.
    """
    try:
        return [dict(r) for r in await conn.fetch(sql, *params)], None
    except Exception as e:  # noqa: BLE001 - report, never abort the preflight
        return [], f"{type(e).__name__}: {e}"


async def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workflow-name", default=WORKFLOW_NAME)
    p.add_argument("--org-id", type=int, default=1)
    args = p.parse_args()

    import asyncpg

    dsn = os.environ.get("DATABASE_URL", "").replace(
        "postgresql+asyncpg://", "postgresql://"
    )
    if not dsn:
        raise SystemExit("DATABASE_URL not set")

    report: dict = {"organization_id": args.org_id, "workflow_name": args.workflow_name}
    conn = await asyncpg.connect(dsn=dsn)
    try:
        # 1. Workflow, by exact name.
        rows, err = await safe_fetch(
            conn,
            "select id, name, organization_id from workflows where name = $1",
            args.workflow_name,
        )
        report["workflow_exact_match"] = {"rows": rows, "error": err}
        if len(rows) == 1:
            report["resolved_inbound_workflow_id"] = rows[0]["id"]
        elif not rows:
            # Near-misses make a name typo or trailing-whitespace drift obvious.
            near, nerr = await safe_fetch(
                conn,
                "select id, name, organization_id from workflows "
                "where name ilike '%Final Expense%' order by id limit 20",
            )
            report["workflow_near_matches"] = {"rows": near, "error": nerr}
            report["resolved_inbound_workflow_id"] = None
        else:
            report["resolved_inbound_workflow_id"] = None
            report["workflow_ambiguous"] = True

        # 2. Telephony configurations, with the ARI one called out.
        cfgs, cerr = await safe_fetch(
            conn,
            "select id, organization_id, provider, name, is_active "
            "from telephony_configurations order by id",
        )
        report["telephony_configurations"] = {"rows": cfgs, "error": cerr}
        ari = [c for c in cfgs if (c.get("provider") or "").lower() == "ari"]
        report["ari_configs"] = ari
        report["resolved_ari_config_id"] = ari[0]["id"] if len(ari) == 1 else None
        if len(ari) > 1:
            report["ari_config_ambiguous"] = True

        # 3. Existing phone-number rows per config.
        counts, nerr = await safe_fetch(
            conn,
            "select telephony_configuration_id as tcid, organization_id as org, "
            "count(*) as total, "
            "count(*) filter (where is_active) as active, "
            "count(*) filter (where inbound_workflow_id is not null) as with_inbound_wf, "
            "count(*) filter (where is_active and inbound_workflow_id is null) "
            "  as active_without_inbound_wf "
            "from telephony_phone_numbers group by 1, 2 order by 1, 2",
        )
        report["phone_number_counts_by_config"] = {"rows": counts, "error": nerr}

        # 4. Shared-config check: which config do outbound campaigns dial on?
        camp, caerr = await safe_fetch(
            conn,
            "select telephony_configuration_id as tcid, organization_id as org, "
            "count(*) as campaigns from campaigns group by 1, 2 order by 3 desc",
        )
        report["campaign_configs"] = {"rows": camp, "error": caerr}

        ari_id = report.get("resolved_ari_config_id")
        campaign_tcids = {r["tcid"] for r in camp if r.get("tcid") is not None}
        if ari_id is not None and camp:
            shared = ari_id in campaign_tcids
            active_now = next(
                (
                    r["active"]
                    for r in counts
                    if r["tcid"] == ari_id and r["org"] == args.org_id
                ),
                0,
            )
            report["shared_config_check"] = {
                "ari_config_id": ari_id,
                "campaign_config_ids": sorted(campaign_tcids),
                "shares_config_with_outbound_campaigns": shared,
                "active_caller_ids_on_ari_config_now": active_now,
                "verdict": (
                    "COLLISION — inbound rows added to this config also become "
                    "outbound caller IDs in the rotation pool. Do not bulk-load "
                    "until this is resolved; see README 'Caller-ID pool collision'."
                    if shared
                    else "CLEAR — the ARI inbound config is not a campaign dialing "
                    "config, so inbound rows will not enter the outbound caller-ID "
                    "rotation pool."
                ),
            }
        else:
            report["shared_config_check"] = {
                "verdict": "INCONCLUSIVE — could not resolve the ARI config id "
                "and/or read campaigns; resolve manually before loading."
            }

        # 5. Anything from this CSV already present (re-run safety / conflicts).
        existing, eerr = await safe_fetch(
            conn,
            "select telephony_configuration_id as tcid, organization_id as org, "
            "count(*) as n from telephony_phone_numbers "
            "where extra_metadata->>'inbound_pool' = 'fe_inbound' "
            "group by 1, 2 order by 1",
        )
        report["already_imported_fe_inbound"] = {"rows": existing, "error": eerr}
    finally:
        await conn.close()

    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
