"""Tests for the ARI trunk patch, against a stand-in carrying the deployed lines.

Run:  python deploy/dograh/tests/test_ari_trunk_patch.py
"""

from __future__ import annotations

import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ari-trunk"))

from apply_ari_trunk_patch import MARKER, PatchError, patch_file, patch_source  # noqa: E402

# The shape of the deployed provider.py around lines 86-94 and 410-426.
STAND_IN = '''"""ARI provider."""
import json


class ARIProvider:
    def outbound(self, to_number):
        if to_number.startswith("SIP/") or to_number.startswith("PJSIP/"):
            sip_endpoint = to_number
        else:
            sip_endpoint = f"PJSIP/{to_number}@fractel" if "@" not in to_number else f"PJSIP/{to_number}"
        return {"endpoint": sip_endpoint}

    def transfer(self, destination):
        if destination.startswith("SIP/") or destination.startswith("PJSIP/"):
            sip_endpoint = destination
        else:
            sip_endpoint = f"PJSIP/{destination}@fractel" if "@" not in destination else f"PJSIP/{destination}"
        return {"endpoint": sip_endpoint}
'''


def load(source):
    namespace = {}
    exec(compile(source, "provider.py", "exec"), namespace)
    return namespace["ARIProvider"]()


def with_env(**env):
    saved = {k: os.environ.get(k) for k in env}
    os.environ.update({k: v for k, v in env.items() if v is not None})
    for k, v in env.items():
        if v is None:
            os.environ.pop(k, None)
    return saved


def restore(saved):
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def test_default_is_unchanged_fractel():
    saved = with_env(DOGRAH_ARI_TRUNK=None, DOGRAH_ARI_TRANSFER_TRUNK=None)
    try:
        p = load(patch_source(STAND_IN))
        assert p.outbound("+15551234567")["endpoint"] == "PJSIP/+15551234567@fractel"
        assert p.transfer("+14233398241")["endpoint"] == "PJSIP/+14233398241@fractel"
    finally:
        restore(saved)


def test_twilio_for_outbound_and_transfers_follow_unless_overridden():
    saved = with_env(DOGRAH_ARI_TRUNK="twilio", DOGRAH_ARI_TRANSFER_TRUNK=None)
    try:
        p = load(patch_source(STAND_IN))
        assert p.outbound("+15551234567")["endpoint"] == "PJSIP/+15551234567@twilio"
        assert p.transfer("+14233398241")["endpoint"] == "PJSIP/+14233398241@twilio"
        os.environ["DOGRAH_ARI_TRANSFER_TRUNK"] = "fractel"
        assert p.transfer("+14233398241")["endpoint"] == "PJSIP/+14233398241@fractel"
    finally:
        restore(saved)


def test_local_channel_is_dialled_as_written():
    p = load(patch_source(STAND_IN))
    dest = "Local/+18652757300*+15551234567@hopwhistle-transfer/n"
    assert p.transfer(dest)["endpoint"] == dest
    assert p.outbound("PJSIP/+1555@sbc")["endpoint"] == "PJSIP/+1555@sbc"


def test_idempotent_and_refuses_unknown_code():
    once = patch_source(STAND_IN)
    assert MARKER in once and patch_source(once) == once
    try:
        patch_source(STAND_IN.replace("@fractel", "@other"))
    except PatchError:
        pass
    else:
        raise AssertionError("patched code it did not recognise")


def test_file_apply_writes_backup():
    with tempfile.TemporaryDirectory() as d:
        path = os.path.join(d, "provider.py")
        open(path, "w").write(STAND_IN)
        assert patch_file(path, apply=False).changed and open(path).read() == STAND_IN
        assert patch_file(path, apply=True).changed
        assert open(path + ".bak-ari-trunk").read() == STAND_IN
        assert not patch_file(path, apply=True).changed


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
