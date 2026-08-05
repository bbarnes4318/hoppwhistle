from pathlib import Path
import importlib.util
import sys
import tempfile
import unittest


MODULE_PATH = Path(__file__).with_name("apply_transfer_duration_hotfix.py")
spec = importlib.util.spec_from_file_location("transfer_duration_hotfix", MODULE_PATH)
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
sys.modules[spec.name] = module
spec.loader.exec_module(module)


CALLBACK_SOURCE = '''def create_max_duration_callback(engine):
    """Return a callback that cancels the task when the hard call limit is exceeded."""

    async def handle_max_duration():
        logger.debug("Max call duration exceeded. Terminating call")
        await engine.end_call_with_reason(
            EndTaskReason.CALL_DURATION_EXCEEDED.value,
            abort_immediately=True,
        )

    return handle_max_duration
'''

CUSTOM_TOOLS_SOURCE = '''                # Initiate transfer via provider with inline TwiML
                try:
                    masked_destination = (
                        f"***{destination[-4:]}" if len(destination) > 4 else "***"
                    )
                    transfer_result = await provider.transfer_call()
                except Exception as e:
                    logger.error(f"Transfer provider failed: {e}")
                    self._engine.set_mute_pipeline(False)
                    await call_transfer_manager.remove_transfer_context(transfer_id)

            except Exception as e:
                logger.error(
                    f"Transfer call tool '{function_name}' execution failed: {e}"
                )
                self._engine.set_mute_pipeline(False)

        action = result.get("action", "")
        status = result.get("status", "")

        logger.info(f"Handling transfer result: action={action}, status={status}")

        if action == "destination_answered":
            pass
'''


class TransferDurationHotfixTests(unittest.TestCase):
    def test_callbacks_patch_disarms_timeout_only_during_handoff(self):
        patched, changed = module.patch_callbacks(CALLBACK_SOURCE)
        self.assertTrue(changed)
        self.assertIn(module.HOTFIX_MARKER, patched)
        self.assertIn('_transfer_handoff_started', patched)
        self.assertIn('CALL_DURATION_EXCEEDED', patched)

    def test_custom_tools_patch_sets_and_resets_handoff_marker(self):
        patched, changed = module.patch_custom_tools(CUSTOM_TOOLS_SOURCE)
        self.assertTrue(changed)
        self.assertIn('self._engine._transfer_handoff_started = True', patched)
        self.assertGreaterEqual(
            patched.count('self._engine._transfer_handoff_started = False'),
            3,
        )

    def test_patch_is_idempotent(self):
        callback_once, _ = module.patch_callbacks(CALLBACK_SOURCE)
        callback_twice, changed = module.patch_callbacks(callback_once)
        self.assertFalse(changed)
        self.assertEqual(callback_once, callback_twice)

        tools_once, _ = module.patch_custom_tools(CUSTOM_TOOLS_SOURCE)
        tools_twice, changed = module.patch_custom_tools(tools_once)
        self.assertFalse(changed)
        self.assertEqual(tools_once, tools_twice)

    def test_source_drift_fails_closed(self):
        with self.assertRaises(module.PatchError):
            module.patch_callbacks('async def different_callback():\n    pass\n')
        with self.assertRaises(module.PatchError):
            module.patch_custom_tools('async def different_transfer():\n    pass\n')

    def test_dry_run_does_not_write_and_apply_creates_backup(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'pipecat_engine_callbacks.py'
            path.write_text(CALLBACK_SOURCE, encoding='utf-8')

            result = module.patch_file(path, module.patch_callbacks, apply=False)
            self.assertTrue(result.changed)
            self.assertEqual(path.read_text(encoding='utf-8'), CALLBACK_SOURCE)

            result = module.patch_file(path, module.patch_callbacks, apply=True)
            self.assertTrue(result.changed)
            self.assertIn(module.HOTFIX_MARKER, path.read_text(encoding='utf-8'))
            backup = path.with_suffix(path.suffix + '.bak-transfer-duration')
            self.assertEqual(backup.read_text(encoding='utf-8'), CALLBACK_SOURCE)


if __name__ == '__main__':
    unittest.main()
