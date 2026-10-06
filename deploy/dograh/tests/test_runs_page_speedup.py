"""Tests for the Dograh results-page speedup patcher and its override edit.

Run:  python deploy/dograh/tests/test_runs_page_speedup.py
"""

from __future__ import annotations

import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "runs-page-speedup"))
sys.path.insert(0, os.path.join(HERE, "..", "vonage-trunk"))

from runs_page_patch import (  # noqa: E402
    MARKER,
    TARGETS,
    PatchError,
    patch_dir,
    patch_text,
)
from runs_page_indexes import INDEXES  # noqa: E402
from setup_vonage import add_mount_and_env  # noqa: E402

# Excerpts of the upstream Dograh files, as shipped (anchors verbatim).
WORKFLOW_RUN_CLIENT = '''import uuid

from sqlalchemy import Float, cast, func
from sqlalchemy.future import select
from sqlalchemy.orm import joinedload, selectinload

from api.db.models import WorkflowRunModel


class WorkflowRunClient:
    async def get_workflow_runs_by_workflow_id(self, base_query, order_clause, session, limit, offset):
        result = await session.execute(
            base_query.order_by(order_clause).limit(limit).offset(offset)
        )
        return result
'''

CAMPAIGN_CLIENT = """import json

from sqlalchemy.future import select
from sqlalchemy.orm import joinedload

from api.db.models import WorkflowRunModel


class CampaignClient:
    async def get_campaign_runs_paginated(self, base_query, order_clause, session, limit, offset):
        async with session:
            result = await session.execute(
                base_query.options(
                    joinedload(WorkflowRunModel.workflow),
                    joinedload(WorkflowRunModel.definition),
                )
                .order_by(order_clause)
                .limit(limit)
                .offset(offset)
            )
            return result
"""

USAGE_CLIENT = '''from sqlalchemy import Date, and_, cast, func, select
from sqlalchemy.orm import joinedload

from api.db.models import WorkflowRunModel


class OrganizationUsageClient:
    async def get_usage_history(self, query, order_clause, session, limit, offset):
        results = await session.execute(
            query.options(joinedload(WorkflowRunModel.workflow))
            .order_by(order_clause, WorkflowRunModel.id.desc())
            .limit(limit)
            .offset(offset)
        )
        return results
'''

SOURCES = {
    "workflow_run_client.py": WORKFLOW_RUN_CLIENT,
    "campaign_client.py": CAMPAIGN_CLIENT,
    "organization_usage_client.py": USAGE_CLIENT,
}


def _edits(name):
    return next(edits for n, edits in TARGETS.values() if n == name)


def test_each_file_patches_compiles_and_drops_the_heavy_columns():
    for name, source in SOURCES.items():
        out, changed = patch_text(source, _edits(name))
        assert changed, name
        compile(out, name, "exec")
        assert MARKER in out
        assert "_hw_defer(_HwRun.logs)" in out and "_hw_defer(_HwRun.annotations)" in out, name
        # imports land after the sqlalchemy.orm import, before first use
        assert out.index("from sqlalchemy.orm import defer as _hw_defer") < out.index("class ")
    campaign, _ = patch_text(CAMPAIGN_CLIENT, _edits("campaign_client.py"))
    assert "load_only(_HwWorkflow.name)" in campaign and "_HwDefinition.version_number" in campaign
    usage, _ = patch_text(USAGE_CLIENT, _edits("organization_usage_client.py"))
    assert "load_only(_HwWorkflow.name)" in usage


def test_patch_is_idempotent():
    for name, source in SOURCES.items():
        once, _ = patch_text(source, _edits(name))
        twice, changed = patch_text(once, _edits(name))
        assert not changed and twice == once, name


def test_unknown_release_is_refused_not_half_patched():
    drifted = WORKFLOW_RUN_CLIENT.replace(".limit(limit).offset(offset)", ".offset(offset).limit(limit)")
    try:
        patch_text(drifted, _edits("workflow_run_client.py"))
    except PatchError as exc:
        assert "different Dograh release" in str(exc)
    else:
        raise AssertionError("drifted source was patched")
    no_orm_import = USAGE_CLIENT.replace("from sqlalchemy.orm import joinedload\n", "")
    try:
        patch_text(no_orm_import, _edits("organization_usage_client.py"))
    except PatchError:
        pass
    else:
        raise AssertionError("patched without an import anchor")


def test_patch_dir_dry_run_then_apply_keeps_a_backup_and_skips_refused_files():
    with tempfile.TemporaryDirectory() as tmp:
        for name, source in SOURCES.items():
            body = source if name != "organization_usage_client.py" else "x = 1\n"
            with open(os.path.join(tmp, name), "w", encoding="utf-8") as fh:
                fh.write(body)
        states = {os.path.basename(r.path): r.state for r in patch_dir(tmp, apply=False)}
        assert states == {"workflow_run_client.py": "would_change", "campaign_client.py": "would_change",
                          "organization_usage_client.py": "refused"}
        with open(os.path.join(tmp, "campaign_client.py"), encoding="utf-8") as fh:
            assert MARKER not in fh.read()  # dry run wrote nothing
        states = {os.path.basename(r.path): r.state for r in patch_dir(tmp, apply=True)}
        assert states["campaign_client.py"] == "changed"
        assert states["organization_usage_client.py"] == "refused"
        with open(os.path.join(tmp, "campaign_client.py.bak-runs-page"), encoding="utf-8") as fh:
            assert fh.read() == CAMPAIGN_CLIENT
        with open(os.path.join(tmp, "organization_usage_client.py"), encoding="utf-8") as fh:
            assert fh.read() == "x = 1\n"
        states = {os.path.basename(r.path): r.state for r in patch_dir(tmp, apply=True)}
        assert states["campaign_client.py"] == "already_patched"


def test_indexes_match_dograhs_order_by():
    # Dograh orders by created_at DESC NULLS LAST; an index without NULLS LAST
    # cannot serve that sort.
    for name, definition in INDEXES:
        assert name.startswith("hw_idx_workflow_runs_")
        assert "created_at DESC NULLS LAST" in definition, name


OVERRIDE = """services:
  api:
    volumes:
      - /opt/dograh-patches/campaign_call_dispatcher.py:/app/api/services/campaign/campaign_call_dispatcher.py:ro
    environment:
      DOGRAH_STATE_CID_POLICY: "strict"
"""


def test_mounts_are_added_to_the_api_service_without_touching_env():
    out = OVERRIDE
    for container_path, (name, _) in TARGETS.items():
        out = add_mount_and_env(out, "api", f"/opt/dograh-patches/runs-page-speedup/{name}:{container_path}:ro", {})
    for container_path, (name, _) in TARGETS.items():
        assert f"      - /opt/dograh-patches/runs-page-speedup/{name}:{container_path}:ro" in out
    assert "campaign_call_dispatcher.py" in out and 'DOGRAH_STATE_CID_POLICY: "strict"' in out
    # re-running adds nothing
    again = out
    for container_path, (name, _) in TARGETS.items():
        again = add_mount_and_env(again, "api", f"/opt/dograh-patches/runs-page-speedup/{name}:{container_path}:ro", {})
    assert again == out


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
