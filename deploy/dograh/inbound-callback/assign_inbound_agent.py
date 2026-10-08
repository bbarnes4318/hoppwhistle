#!/usr/bin/env python3
"""Make a Dograh agent answer calls to the AI's caller-ID numbers.

Dograh answers an inbound ARI call with the workflow set on the dialled
number's ``telephony_phone_numbers.inbound_workflow_id``. This sets that column
to one workflow (agent) for the caller-ID pool of one telephony configuration.

Runs inside the Dograh api container (it needs asyncpg and DATABASE_URL), the
same way as ../import_state_caller_ids.py. Dry run unless ``--apply``.

    python assign_inbound_agent.py --workflow-id 15             # dry run
    python assign_inbound_agent.py --workflow-id 15 --apply
    python assign_inbound_agent.py --workflow-id 15 --clear --apply   # undo

By default only the state caller-ID pool (``extra_metadata.pool = state_cid``)
is changed; ``--all-numbers`` takes every active number on the configuration.
A number already answered by a different agent is reported and left alone
unless ``--replace`` is given.

The last line printed is ``RESULT <json>``; install_inbound_callback.py reads
the Stasis application name and the numbers the agent answers from it.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from typing import Any, Dict, Iterable, List, Optional

POOL_TAG = "state_cid"


def stasis_app_of(credentials: Any) -> Optional[str]:
    """The Stasis application Dograh's ARI listener runs, from its credentials."""
    if isinstance(credentials, str):
        try:
            credentials = json.loads(credentials or "{}")
        except ValueError:
            return None
    if not isinstance(credentials, dict):
        return None
    return credentials.get("stasis_app_name") or credentials.get("app_name") or None


def plan_assignment(
    rows: Iterable[Dict[str, Any]], workflow_id: Optional[int], replace: bool
) -> Dict[str, List[Dict[str, Any]]]:
    """Split numbers into those to set, already set, and held by another agent.

    ``workflow_id=None`` clears: numbers currently on any agent are set to none.
    """
    plan: Dict[str, List[Dict[str, Any]]] = {"to_set": [], "already": [], "other_agent": []}
    for row in rows:
        current = row.get("inbound_workflow_id")
        if current == workflow_id:
            plan["already"].append(row)
        elif current is None or workflow_id is None or replace:
            plan["to_set"].append(row)
        else:
            plan["other_agent"].append(row)
    return plan


def answered_numbers(plan: Dict[str, List[Dict[str, Any]]], clear: bool) -> List[str]:
    """Numbers on the agent after the plan is applied, sorted."""
    if clear:
        return []
    return sorted(r["address_normalized"] for r in plan["to_set"] + plan["already"])


async def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--workflow-id", type=int, required=True, help="Dograh agent (workflow) id")
    parser.add_argument("--org-id", type=int, default=1)
    parser.add_argument("--tcid", type=int, default=1, help="telephony configuration (FracTEL ARI)")
    parser.add_argument("--all-numbers", action="store_true",
                        help="every active number on the configuration, not only the caller-ID pool")
    parser.add_argument("--replace", action="store_true",
                        help="also move numbers another agent already answers")
    parser.add_argument("--clear", action="store_true",
                        help="remove the agent from these numbers instead (undo)")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)

    import asyncpg  # only inside the container

    dsn = os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
    if not dsn:
        raise SystemExit("DATABASE_URL not set")

    result: Dict[str, Any] = {"apply": args.apply, "workflow_id": args.workflow_id, "ok": False}
    conn = await asyncpg.connect(dsn=dsn)
    try:
        has_column = await conn.fetchval(
            "select count(*) from information_schema.columns "
            "where table_name='telephony_phone_numbers' and column_name='inbound_workflow_id'"
        )
        if not has_column:
            result["error"] = ("This Dograh has no telephony_phone_numbers.inbound_workflow_id: "
                               "it predates inbound ARI calls. Upgrade Dograh first.")
            print("RESULT " + json.dumps(result))
            return 2

        workflow = await conn.fetchrow(
            "select id, name, organization_id from workflows where id=$1", args.workflow_id
        )
        if not workflow or workflow["organization_id"] != args.org_id:
            result["error"] = f"No agent {args.workflow_id} in organization {args.org_id}."
            print("RESULT " + json.dumps(result))
            return 2
        result["workflow_name"] = workflow["name"]

        config = await conn.fetchrow(
            "select id, provider, credentials from telephony_configurations "
            "where id=$1 and organization_id=$2",
            args.tcid, args.org_id,
        )
        if not config or config["provider"] != "ari":
            result["error"] = f"Telephony configuration {args.tcid} is not an ARI configuration."
            print("RESULT " + json.dumps(result))
            return 2
        result["stasis_app"] = stasis_app_of(config["credentials"])

        query = ("select id, address_normalized, inbound_workflow_id from telephony_phone_numbers "
                 "where organization_id=$1 and telephony_configuration_id=$2 and is_active")
        if not args.all_numbers:
            query += " and extra_metadata->>'pool' = '" + POOL_TAG + "'"
        rows = [dict(r) for r in await conn.fetch(query, args.org_id, args.tcid)]

        target = None if args.clear else args.workflow_id
        if args.clear:
            rows = [r for r in rows if r["inbound_workflow_id"] == args.workflow_id]
        plan = plan_assignment(rows, target, args.replace)
        result.update({
            "numbers": len(rows),
            "to_set": len(plan["to_set"]),
            "already": len(plan["already"]),
            "other_agent": len(plan["other_agent"]),
            "other_agent_sample": [r["address_normalized"] for r in plan["other_agent"][:10]],
            # The numbers this agent answers once the run is applied: what
            # Hopwhistle marks as AI-callback numbers.
            "numbers_answered": answered_numbers(plan, args.clear),
        })

        if args.apply and plan["to_set"]:
            await conn.execute(
                "update telephony_phone_numbers set inbound_workflow_id=$1, updated_at=now() "
                "where id = any($2::int[])",
                target, [r["id"] for r in plan["to_set"]],
            )
        result["ok"] = True
    finally:
        await conn.close()

    print(f"Agent {args.workflow_id} ({result.get('workflow_name')}): "
          f"{result['numbers']} numbers, {result['to_set']} to change, "
          f"{result['already']} already set, {result['other_agent']} on another agent"
          + (" (use --replace to move them)" if result["other_agent"] else ""))
    if not args.apply:
        print("Dry run: nothing written. Re-run with --apply.")
    print("RESULT " + json.dumps(result))
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
