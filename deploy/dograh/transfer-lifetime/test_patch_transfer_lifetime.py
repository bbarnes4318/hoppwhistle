from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

PATCHER_PATH = Path(__file__).with_name("patch_transfer_lifetime.py")
SPEC = importlib.util.spec_from_file_location("patch_transfer_lifetime", PATCHER_PATH)
assert SPEC and SPEC.loader
patcher = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(patcher)

SOURCE = '''\
"""fixture"""
from loguru import logger
from pipecat.serializers.call_strategies import HangupStrategy, TransferStrategy


class ARIBridgeSwapStrategy(TransferStrategy):
    async def execute_transfer(self, context):
        channel_id = context["channel_id"]
        destination_channel_id = context["destination_channel_id"]
        workflow_run_id = context["workflow_run_id"]
        workflow_run = context["workflow_run"]
        db_client = context["db_client"]
        redis = context["redis"]
        logger.info(
            f"[ARI Transfer] Added destination {destination_channel_id} to bridge bridge"
        )
        await redis.setex(
            f"ari:channel:{destination_channel_id}",
            3600,
            workflow_run_id,
        )
        # Remove external media channel from bridge
        remove_url = "unused"
        return remove_url


class ARIHangupStrategy(HangupStrategy):
    """Implements hangup for Asterisk ARI channels."""

    async def execute_hangup(self, context):
        channel_id = context["channel_id"]
        ari_endpoint = context["ari_endpoint"]
        if not channel_id or not ari_endpoint:
            logger.warning(
                "Cannot hang up Asterisk channel: missing channel_id or ari_endpoint"
            )
            return False

        await self._terminate_external_pbx_if_any(channel_id)
        endpoint = f"{ari_endpoint}/ari/channels/{channel_id}"
        return endpoint
'''


class TransferLifetimePatchTests(unittest.TestCase):
    def test_patch_is_idempotent_and_ordered(self) -> None:
        patched = patcher.apply_patch(SOURCE)
        patcher.verify_source(patched)
        self.assertEqual(patcher.apply_patch(patched), patched)
        self.assertLess(
            patched.index("Human handoff committed"),
            patched.index("Remove external media channel from bridge"),
        )
        self.assertLess(
            patched.index("_human_handoff_is_committed(channel_id)"),
            patched.index("await self._terminate_external_pbx_if_any(channel_id)"),
        )
        self.assertLess(
            patched.index("await self._terminate_external_pbx_if_any(channel_id)"),
            patched.index('endpoint = f"{ari_endpoint}/ari/channels/{channel_id}"'),
        )

    def test_patch_fails_closed_on_upstream_drift(self) -> None:
        drifted = SOURCE.replace("await redis.setex(", "await redis.set(")
        with self.assertRaisesRegex(RuntimeError, "handoff commit"):
            patcher.apply_patch(drifted)


if __name__ == "__main__":
    unittest.main()
