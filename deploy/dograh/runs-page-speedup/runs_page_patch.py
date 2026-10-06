#!/usr/bin/env python3
"""Stop Dograh's call-results lists from loading every call's full log.

Dograh's results lists -- a voice agent's runs page, a campaign's runs table and
"Agent Runs" (usage) -- each fetch one page of 50 calls. The query behind each
one is ``select(WorkflowRunModel)``, which pulls EVERY column of every row,
including:

* ``workflow_runs.logs`` -- the call's full event log (transcript, realtime
  feedback events, tool calls). Hundreds of KB per call; nothing on a list page
  reads it.
* ``workflow_runs.annotations`` -- also unread by the lists.
* through ``joinedload(workflow)`` / ``joinedload(definition)``, the agent's whole
  graph JSON (``workflow_definition`` / ``workflow_json``) once PER ROW, when the
  list only shows the agent's name and version number.

So one page was tens of MB out of Postgres, json-parsed in Python, before any
of it was thrown away. Once campaigns had run for a while the page took
minutes, and usually hit the proxy timeout before it finished.

This patch adds load options to those three queries only: defer ``logs`` and
``annotations``, and load just ``name`` / ``version_number`` from the joined
agent rows. The response each endpoint returns is byte-for-byte the same; the
columns it never read are simply not fetched.

Dry run by default. Patches staged copies of the files (never the container):

    python3 runs_page_patch.py --dir /opt/dograh-patches/runs-page-speedup
    python3 runs_page_patch.py --dir /opt/dograh-patches/runs-page-speedup --apply

Each file is patched independently and fail-closed: if the code it expects is
not there (a different Dograh release), that file is left untouched and
reported, never half-edited.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Tuple

MARKER = "HOPWHISTLE_RUNS_PAGE_SPEEDUP_V1"

IMPORTS = (
    f"# {MARKER}: results lists load only the columns they show.\n"
    "from sqlalchemy.orm import defer as _hw_defer  # noqa: E402\n"
    "from api.db.models import WorkflowDefinitionModel as _HwDefinition  # noqa: E402\n"
    "from api.db.models import WorkflowModel as _HwWorkflow  # noqa: E402\n"
    "from api.db.models import WorkflowRunModel as _HwRun  # noqa: E402\n"
)

SKIP_HEAVY = "_hw_defer(_HwRun.logs), _hw_defer(_HwRun.annotations)"

# ── api/db/workflow_run_client.py :: get_workflow_runs_by_workflow_id ─────────
WORKFLOW_RUNS_OLD = "base_query.order_by(order_clause).limit(limit).offset(offset)"
WORKFLOW_RUNS_NEW = (
    f"base_query.options({SKIP_HEAVY})"
    ".order_by(order_clause).limit(limit).offset(offset)"
)

# ── api/db/campaign_client.py :: get_campaign_runs_paginated ──────────────────
CAMPAIGN_RUNS_OLD = """                base_query.options(
                    joinedload(WorkflowRunModel.workflow),
                    joinedload(WorkflowRunModel.definition),
                )
"""
CAMPAIGN_RUNS_NEW = """                base_query.options(
                    joinedload(WorkflowRunModel.workflow).load_only(_HwWorkflow.name),
                    joinedload(WorkflowRunModel.definition).load_only(
                        _HwDefinition.version_number
                    ),
                    _hw_defer(_HwRun.logs),
                    _hw_defer(_HwRun.annotations),
                )
"""

# ── api/db/organization_usage_client.py :: get_usage_history ──────────────────
USAGE_RUNS_OLD = "query.options(joinedload(WorkflowRunModel.workflow))"
USAGE_RUNS_NEW = (
    "query.options(\n"
    "                    joinedload(WorkflowRunModel.workflow).load_only(_HwWorkflow.name),\n"
    "                    _hw_defer(_HwRun.logs),\n"
    "                    _hw_defer(_HwRun.annotations),\n"
    "                )"
)

# Container path -> (staged file name, [(old, new, label)])
TARGETS: Dict[str, Tuple[str, List[Tuple[str, str, str]]]] = {
    "/app/api/db/workflow_run_client.py": (
        "workflow_run_client.py",
        [(WORKFLOW_RUNS_OLD, WORKFLOW_RUNS_NEW, "agent runs page query")],
    ),
    "/app/api/db/campaign_client.py": (
        "campaign_client.py",
        [(CAMPAIGN_RUNS_OLD, CAMPAIGN_RUNS_NEW, "campaign runs query")],
    ),
    "/app/api/db/organization_usage_client.py": (
        "organization_usage_client.py",
        [(USAGE_RUNS_OLD, USAGE_RUNS_NEW, "usage runs query")],
    ),
}


class PatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class PatchResult:
    path: str
    state: str  # would_change | changed | already_patched | refused
    detail: str = ""


_ORM_IMPORT = re.compile(r"^from sqlalchemy\.orm import [^(\\\n]+\n", re.M)


def add_imports(text: str) -> str:
    """Insert IMPORTS right after the module's single-line sqlalchemy.orm import."""
    match = _ORM_IMPORT.search(text)
    if match is None:
        raise PatchError("no single-line 'from sqlalchemy.orm import ...' to anchor the imports on")
    return text[: match.end()] + IMPORTS + text[match.end():]


def patch_text(text: str, edits: List[Tuple[str, str, str]]) -> Tuple[str, bool]:
    """Apply ``edits`` (each anchor must occur exactly once). Idempotent."""
    if MARKER in text:
        return text, False
    for old, new, label in edits:
        count = text.count(old)
        if count != 1:
            raise PatchError(
                f"{label}: expected the original code exactly once, found it {count} times "
                "(a different Dograh release)"
            )
        text = text.replace(old, new, 1)
    return add_imports(text), True


def patch_file(path: str, edits: List[Tuple[str, str, str]], apply: bool) -> PatchResult:
    if not os.path.isfile(path):
        return PatchResult(path, "refused", "file not found")
    with open(path, encoding="utf-8") as handle:
        original = handle.read()
    try:
        patched, changed = patch_text(original, edits)
        if changed:
            compile(patched, path, "exec")
    except (PatchError, SyntaxError) as exc:
        return PatchResult(path, "refused", str(exc))
    if not changed:
        return PatchResult(path, "already_patched")
    if not apply:
        return PatchResult(path, "would_change")
    backup = path + ".bak-runs-page"
    if not os.path.exists(backup):
        shutil.copy2(path, backup)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(patched)
    return PatchResult(path, "changed")


def patch_dir(directory: str, apply: bool,
              on_result: Optional[Callable[[PatchResult], None]] = None) -> List[PatchResult]:
    results = []
    for _, (name, edits) in TARGETS.items():
        result = patch_file(os.path.join(directory, name), edits, apply)
        results.append(result)
        if on_result:
            on_result(result)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dir", required=True, help="directory holding the staged copies")
    parser.add_argument("--apply", action="store_true", help="write the changes (default: dry run)")
    args = parser.parse_args()

    results = patch_dir(args.dir, args.apply)
    for r in results:
        print(f"{'APPLY' if args.apply else 'DRY_RUN'} {r.path}: {r.state}" + (f" -- {r.detail}" if r.detail else ""))
    return 2 if all(r.state == "refused" for r in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
