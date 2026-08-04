#!/usr/bin/env python3
"""Apply the Dograh transferred-call duration hotfix to staged source copies.

This script is intentionally dry-run by default. It patches only two Dograh
workflow files copied from the running image:

* pipecat_engine_callbacks.py
* pipecat_engine_custom_tools.py

The normal AI max-call timer remains active while the AI owns the call. Once a
transfer attempt has started, the timer is suspended until that attempt either
fails (timer re-enabled) or succeeds (timer remains disabled because the human
handoff owns the PSTN call).
"""

from __future__ import annotations

import argparse
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

HOTFIX_MARKER = "HOPWHISTLE_TRANSFER_DURATION_HOTFIX_V1"


class PatchError(RuntimeError):
    pass


@dataclass(frozen=True)
class PatchResult:
    path: Path
    changed: bool


CALLBACK_OLD = '''    async def handle_max_duration():
        logger.debug("Max call duration exceeded. Terminating call")
        await engine.end_call_with_reason(
            EndTaskReason.CALL_DURATION_EXCEEDED.value,
            abort_immediately=True,
        )
'''

CALLBACK_NEW = f'''    async def handle_max_duration():
        # {HOTFIX_MARKER}
        # The AI timer belongs to the AI portion of the call. After a transfer
        # attempt starts, allowing this callback to terminate the original ARI
        # channel can drop the customer and the connected human agent at the
        # workflow's configured limit (300 seconds by default).
        if getattr(engine, "_transfer_handoff_started", False):
            logger.info(
                "Max call duration reached after transfer handoff started; "
                "leaving the transferred PSTN call intact"
            )
            return

        logger.debug("Max call duration exceeded. Terminating call")
        await engine.end_call_with_reason(
            EndTaskReason.CALL_DURATION_EXCEEDED.value,
            abort_immediately=True,
        )
'''

TRANSFER_START_OLD = '''                # Initiate transfer via provider with inline TwiML
                try:
                    masked_destination = (
'''

TRANSFER_START_NEW = f'''                # {HOTFIX_MARKER}
                # Disarm the AI max-duration callback before originating the
                # transfer leg. A transfer may begin near the configured hard
                # limit, and the callback must not race the successful bridge
                # swap and hang up the original customer channel.
                self._engine._transfer_handoff_started = True

                # Initiate transfer via provider with inline TwiML
                try:
                    masked_destination = (
'''

PROVIDER_FAILURE_OLD = '''                except Exception as e:
                    logger.error(f"Transfer provider failed: {e}")
                    self._engine.set_mute_pipeline(False)
                    await call_transfer_manager.remove_transfer_context(transfer_id)
'''

PROVIDER_FAILURE_NEW = '''                except Exception as e:
                    logger.error(f"Transfer provider failed: {e}")
                    self._engine._transfer_handoff_started = False
                    self._engine.set_mute_pipeline(False)
                    await call_transfer_manager.remove_transfer_context(transfer_id)
'''

OUTER_FAILURE_OLD = '''            except Exception as e:
                logger.error(
                    f"Transfer call tool '{function_name}' execution failed: {e}"
                )
                self._engine.set_mute_pipeline(False)
'''

OUTER_FAILURE_NEW = '''            except Exception as e:
                logger.error(
                    f"Transfer call tool '{function_name}' execution failed: {e}"
                )
                self._engine._transfer_handoff_started = False
                self._engine.set_mute_pipeline(False)
'''

RESULT_HANDLER_OLD = '''        action = result.get("action", "")
        status = result.get("status", "")

        logger.info(f"Handling transfer result: action={action}, status={status}")

        if action == "destination_answered":
'''

RESULT_HANDLER_NEW = f'''        action = result.get("action", "")
        status = result.get("status", "")

        logger.info(f"Handling transfer result: action={{action}}, status={{status}}")

        # {HOTFIX_MARKER}
        # A failed or timed-out transfer returns ownership to the AI, so the
        # normal duration policy is re-enabled. A successful handoff leaves the
        # marker set and the AI timer can no longer tear down the human call.
        if action == "transfer_failed":
            self._engine._transfer_handoff_started = False

        if action == "destination_answered":
'''


def replace_exact(text: str, old: str, new: str, label: str) -> tuple[str, bool]:
    if new in text:
        return text, False
    count = text.count(old)
    if count != 1:
        raise PatchError(
            f"{label}: expected exactly one source anchor, found {count}; "
            "refusing to patch a different Dograh revision"
        )
    return text.replace(old, new, 1), True


def patch_callbacks(text: str) -> tuple[str, bool]:
    return replace_exact(
        text,
        CALLBACK_OLD,
        CALLBACK_NEW,
        "pipecat_engine_callbacks.py",
    )


def patch_custom_tools(text: str) -> tuple[str, bool]:
    changed = False
    for old, new, label in (
        (TRANSFER_START_OLD, TRANSFER_START_NEW, "transfer start"),
        (PROVIDER_FAILURE_OLD, PROVIDER_FAILURE_NEW, "provider failure reset"),
        (OUTER_FAILURE_OLD, OUTER_FAILURE_NEW, "outer failure reset"),
        (RESULT_HANDLER_OLD, RESULT_HANDLER_NEW, "transfer result reset"),
    ):
        text, did_change = replace_exact(text, old, new, label)
        changed = changed or did_change
    return text, changed


def patch_file(path: Path, patcher, apply: bool) -> PatchResult:
    if not path.is_file():
        raise PatchError(f"Required source file not found: {path}")
    original = path.read_text(encoding="utf-8")
    patched, changed = patcher(original)
    if changed and apply:
        backup = path.with_suffix(path.suffix + ".bak-transfer-duration")
        if not backup.exists():
            shutil.copy2(path, backup)
        path.write_text(patched, encoding="utf-8")
    return PatchResult(path=path, changed=changed)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--callbacks-file",
        required=True,
        type=Path,
        help="Staged pipecat_engine_callbacks.py copied from dograh-api",
    )
    parser.add_argument(
        "--custom-tools-file",
        required=True,
        type=Path,
        help="Staged pipecat_engine_custom_tools.py copied from dograh-api",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write changes. Without this flag the command is a dry run.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        results = [
            patch_file(args.callbacks_file, patch_callbacks, args.apply),
            patch_file(args.custom_tools_file, patch_custom_tools, args.apply),
        ]
    except PatchError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    mode = "APPLIED" if args.apply else "DRY_RUN"
    for result in results:
        state = "would_change" if result.changed and not args.apply else (
            "changed" if result.changed else "already_patched"
        )
        print(f"{mode} {result.path}: {state}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
