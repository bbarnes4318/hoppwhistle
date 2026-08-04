#!/usr/bin/env python3
"""Patch Dograh ARI transfer source so late AI teardown cannot drop a human handoff."""
from __future__ import annotations

import argparse
import ast
import re
import sys
from pathlib import Path

STRATEGIES_PATH = Path("api/services/telephony/providers/ari/strategies.py")
MARKER = "HOPWHISTLE_TRANSFER_LIFETIME_FIX_V1"

CONSTANT_ANCHOR = "from pipecat.serializers.call_strategies import HangupStrategy, TransferStrategy\n"
CONSTANT_BLOCK = """from pipecat.serializers.call_strategies import HangupStrategy, TransferStrategy\n\n\n# HOPWHISTLE_TRANSFER_LIFETIME_FIX_V1\n# A successful human handoff must outlive the AI pipeline. This marker protects\n# the caller channel from late CALL_DURATION_EXCEEDED / transport teardown work.\n_TRANSFER_HANDOFF_GUARD_PREFIX = \"ari:transfer_handoff_committed:\"\n_TRANSFER_HANDOFF_GUARD_TTL_SECONDS = 86400\n"""

CLASS_ANCHOR = """class ARIHangupStrategy(HangupStrategy):\n    \"\"\"Implements hangup for Asterisk ARI channels.\"\"\"\n\n"""
CLASS_BLOCK = CLASS_ANCHOR + """    async def _human_handoff_is_committed(self, channel_id: str) -> bool:\n        \"\"\"Return True when this caller is already bridged to a human.\"\"\"\n        redis = None\n        try:\n            import redis.asyncio as aioredis\n\n            from api.constants import REDIS_URL\n\n            redis = aioredis.from_url(REDIS_URL, decode_responses=True)\n            destination_channel_id = await redis.get(\n                f\"{_TRANSFER_HANDOFF_GUARD_PREFIX}{channel_id}\"\n            )\n            return bool(destination_channel_id)\n        except Exception as e:\n            logger.error(\n                f\"[ARI Hangup] Could not read human-handoff guard for {channel_id}: {e}\"\n            )\n            return False\n        finally:\n            if redis is not None:\n                try:\n                    close = getattr(redis, \"aclose\", None) or getattr(\n                        redis, \"close\", None\n                    )\n                    if close is not None:\n                        await close()\n                except Exception as e:\n                    logger.warning(\n                        f\"[ARI Hangup] Failed to close Redis guard client: {e}\"\n                    )\n\n"""

COMMIT_RE = re.compile(
    r'(?P<i>^[ \t]+)await redis\.setex\(\n'
    r'(?P=i)    f"ari:channel:\{destination_channel_id\}",\n'
    r'(?P=i)    3600,\n'
    r'(?P=i)    workflow_run_id,\n'
    r'(?P=i)\)\n',
    re.MULTILINE,
)

HANGUP_RE = re.compile(
    r'(?P<i>^[ \t]+)if not channel_id or not ari_endpoint:\n'
    r'(?P=i)    logger\.warning\(\n'
    r'(?P=i)        "Cannot hang up Asterisk channel: missing channel_id or ari_endpoint"\n'
    r'(?P=i)    \)\n'
    r'(?P=i)    return False\n\n',
    re.MULTILINE,
)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one source anchor, found {count}")
    return text.replace(old, new, 1)


def replace_regex_once(text: str, pattern: re.Pattern[str], repl, label: str) -> str:
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise RuntimeError(f"{label}: expected exactly one source anchor, found {len(matches)}")
    return pattern.sub(repl, text, count=1)


def _commit_replacement(match: re.Match[str]) -> str:
    indent = match.group("i")
    return match.group(0) + (
        f"{indent}# Commit ownership of the live caller/destination bridge before\n"
        f"{indent}# tearing down Dograh's external-media leg. Any late AI\n"
        f"{indent}# timeout/hangup callback must not delete the caller leg.\n"
        f"{indent}await redis.setex(\n"
        f"{indent}    f\"{{_TRANSFER_HANDOFF_GUARD_PREFIX}}{{channel_id}}\",\n"
        f"{indent}    _TRANSFER_HANDOFF_GUARD_TTL_SECONDS,\n"
        f"{indent}    destination_channel_id,\n"
        f"{indent})\n"
        f"{indent}workflow_run.gathered_context[\n"
        f"{indent}    \"transfer_handoff_committed\"\n"
        f"{indent}] = True\n"
        f"{indent}await db_client.update_workflow_run(\n"
        f"{indent}    run_id=int(workflow_run_id),\n"
        f"{indent}    gathered_context=workflow_run.gathered_context,\n"
        f"{indent})\n"
        f"{indent}logger.info(\n"
        f"{indent}    f\"[ARI Transfer] Human handoff committed: caller={{channel_id}}, \"\n"
        f"{indent}    f\"destination={{destination_channel_id}}; late AI hangup is disabled\"\n"
        f"{indent})\n"
    )


def _hangup_replacement(match: re.Match[str]) -> str:
    indent = match.group("i")
    return match.group(0) + (
        f"{indent}if await self._human_handoff_is_committed(channel_id):\n"
        f"{indent}    logger.warning(\n"
        f"{indent}        f\"[ARI Hangup] Suppressed late AI hangup for transferred caller {{channel_id}}\"\n"
        f"{indent}    )\n"
        f"{indent}    return True\n\n"
    )


def apply_patch(source: str) -> str:
    if MARKER in source:
        verify_source(source)
        return source
    patched = replace_once(source, CONSTANT_ANCHOR, CONSTANT_BLOCK, "constants")
    patched = replace_regex_once(patched, COMMIT_RE, _commit_replacement, "handoff commit")
    patched = replace_once(patched, CLASS_ANCHOR, CLASS_BLOCK, "hangup helper")
    patched = replace_regex_once(patched, HANGUP_RE, _hangup_replacement, "hangup guard")
    verify_source(patched)
    return patched


def verify_source(source: str) -> None:
    required = (
        MARKER,
        "_TRANSFER_HANDOFF_GUARD_PREFIX",
        "transfer_handoff_committed",
        "_human_handoff_is_committed",
        "Suppressed late AI hangup",
    )
    missing = [item for item in required if item not in source]
    if missing:
        raise RuntimeError(f"patched source is missing: {', '.join(missing)}")
    add_index = source.index("Added destination")
    commit_index = source.index("Human handoff committed")
    remove_index = source.index("Remove external media channel from bridge")
    guard_index = source.index("await self._human_handoff_is_committed(channel_id)")
    delete_index = source.index('endpoint = f"{ari_endpoint}/ari/channels/{channel_id}"')
    if not (add_index < commit_index < remove_index):
        raise RuntimeError("handoff marker must be committed after bridge add and before AI media removal")
    if guard_index > delete_index:
        raise RuntimeError("handoff guard must run before ARI channel deletion")
    ast.parse(source)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.check == args.apply:
        parser.error("choose exactly one of --check or --apply")
    path = args.root / STRATEGIES_PATH
    if not path.is_file():
        raise FileNotFoundError(f"Dograh ARI strategy source not found: {path}")
    source = path.read_text(encoding="utf-8")
    if args.check:
        verify_source(source)
        print(f"TRANSFER_LIFETIME_FIX_OK {path}")
        return 0
    patched = apply_patch(source)
    if patched == source:
        print(f"TRANSFER_LIFETIME_FIX_ALREADY_APPLIED {path}")
    else:
        path.write_text(patched, encoding="utf-8")
        print(f"TRANSFER_LIFETIME_FIX_APPLIED {path}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"TRANSFER_LIFETIME_FIX_FAILED: {exc}", file=sys.stderr)
        raise
