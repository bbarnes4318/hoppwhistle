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
CONSTANT_BLOCK = """from pipecat.serializers.call_strategies import HangupStrategy, TransferStrategy\n\n\n# HOPWHISTLE_TRANSFER_LIFETIME_FIX_V1\n# A successful human handoff must outlive the AI pipeline. Ownership is stamped\n# directly on the live Asterisk caller channel so no Redis/database timeout can\n# later turn an AI lifecycle callback into a caller-to-agent disconnect.\n_TRANSFER_HANDOFF_CHANNEL_VAR = \"HOPWHISTLE_TRANSFER_HANDOFF_COMMITTED\"\n"""

CLASS_ANCHOR = """class ARIHangupStrategy(HangupStrategy):\n    \"\"\"Implements hangup for Asterisk ARI channels.\"\"\"\n\n"""
CLASS_BLOCK = CLASS_ANCHOR + """    async def _human_handoff_is_committed(\n        self,\n        channel_id: str,\n        ari_endpoint: str,\n        app_name: str,\n        app_password: str,\n    ):\n        \"\"\"Read the handoff ownership marker from the live Asterisk channel.\n\n        Returns True when human ownership is committed, False when the marker is\n        definitely absent, and None when ownership cannot be determined safely.\n        \"\"\"\n        try:\n            import aiohttp\n            from aiohttp import BasicAuth\n\n            endpoint = f\"{ari_endpoint}/ari/channels/{channel_id}/variable\"\n            auth = BasicAuth(app_name, app_password)\n            async with aiohttp.ClientSession() as session:\n                async with session.get(\n                    endpoint,\n                    auth=auth,\n                    params={\"variable\": _TRANSFER_HANDOFF_CHANNEL_VAR},\n                ) as response:\n                    if response.status == 200:\n                        payload = await response.json()\n                        return bool((payload or {}).get(\"value\"))\n                    if response.status == 404:\n                        return False\n                    error_text = await response.text()\n                    logger.error(\n                        f\"[ARI Hangup] Handoff ownership check failed for {channel_id}: \"\n                        f\"status={response.status}, response={error_text}\"\n                    )\n                    return None\n        except Exception as e:\n            logger.error(\n                f\"[ARI Hangup] Could not verify handoff ownership for {channel_id}: {e}\"\n            )\n            return None\n\n"""

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
    guard = (
        f"{indent}# The destination is now in the live bridge. Commit ownership on\n"
        f"{indent}# the Asterisk caller channel before any AI media teardown.\n"
        f"{indent}handoff_guard_url = (\n"
        f"{indent}    f\"{{ari_endpoint}}/ari/channels/{{channel_id}}/variable\"\n"
        f"{indent})\n"
        f"{indent}async with session.post(\n"
        f"{indent}    handoff_guard_url,\n"
        f"{indent}    auth=auth,\n"
        f"{indent}    params={{\n"
        f"{indent}        \"variable\": _TRANSFER_HANDOFF_CHANNEL_VAR,\n"
        f"{indent}        \"value\": destination_channel_id,\n"
        f"{indent}    }},\n"
        f"{indent}) as guard_response:\n"
        f"{indent}    if guard_response.status not in (200, 204):\n"
        f"{indent}        error_text = await guard_response.text()\n"
        f"{indent}        logger.error(\n"
        f"{indent}            f\"[ARI Transfer] Refusing unsafe handoff: could not \"\n"
        f"{indent}            f\"stamp caller {{channel_id}} ownership; \"\n"
        f"{indent}            f\"status={{guard_response.status}} response={{error_text}}\"\n"
        f"{indent}        )\n"
        f"{indent}        return False\n"
        f"{indent}try:\n"
        f"{indent}    workflow_run.gathered_context[\n"
        f"{indent}        \"transfer_handoff_committed\"\n"
        f"{indent}    ] = True\n"
        f"{indent}    await db_client.update_workflow_run(\n"
        f"{indent}        run_id=int(workflow_run_id),\n"
        f"{indent}        gathered_context=workflow_run.gathered_context,\n"
        f"{indent}    )\n"
        f"{indent}except Exception as e:\n"
        f"{indent}    logger.warning(\n"
        f"{indent}        f\"[ARI Transfer] Handoff is protected on-channel but \"\n"
        f"{indent}        f\"workflow audit persistence failed: {{e}}\"\n"
        f"{indent}    )\n"
        f"{indent}logger.info(\n"
        f"{indent}    f\"[ARI Transfer] Human handoff committed: caller={{channel_id}}, \"\n"
        f"{indent}    f\"destination={{destination_channel_id}}; late AI hangup is disabled\"\n"
        f"{indent})\n"
    )
    return guard + match.group(0)


def _hangup_replacement(match: re.Match[str]) -> str:
    indent = match.group("i")
    return match.group(0) + (
        f"{indent}handoff_state = await self._human_handoff_is_committed(\n"
        f"{indent}    channel_id, ari_endpoint, app_name, app_password\n"
        f"{indent})\n"
        f"{indent}if handoff_state is True:\n"
        f"{indent}    logger.warning(\n"
        f"{indent}        f\"[ARI Hangup] Suppressed late AI hangup for transferred caller {{channel_id}}\"\n"
        f"{indent}    )\n"
        f"{indent}    return True\n"
        f"{indent}if handoff_state is None:\n"
        f"{indent}    logger.error(\n"
        f"{indent}        f\"[ARI Hangup] Suppressed caller deletion because handoff \"\n"
        f"{indent}        f\"ownership could not be verified for {{channel_id}}\"\n"
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
        "_TRANSFER_HANDOFF_CHANNEL_VAR",
        "transfer_handoff_committed",
        "_human_handoff_is_committed",
        "Refusing unsafe handoff",
        "Suppressed late AI hangup",
        "Suppressed caller deletion because handoff",
    )
    missing = [item for item in required if item not in source]
    if missing:
        raise RuntimeError(f"patched source is missing: {', '.join(missing)}")
    add_index = source.index("Added destination")
    commit_index = source.index("Human handoff committed")
    mapping_index = source.index('f"ari:channel:{destination_channel_id}"')
    remove_index = source.index("Remove external media channel from bridge")
    guard_index = source.index("handoff_state = await self._human_handoff_is_committed")
    delete_index = source.index('endpoint = f"{ari_endpoint}/ari/channels/{channel_id}"')
    if not (add_index < commit_index < mapping_index < remove_index):
        raise RuntimeError(
            "handoff ownership must be committed immediately after bridge add and before AI media removal"
        )
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
