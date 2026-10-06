"""Tests for the caller-ID trunk patch, against a stand-in of the deployed provider.py.

Run:  python deploy/dograh/tests/test_caller_trunk_patch.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ari-trunk"))

from apply_caller_trunk_patch import MARKER, PatchError, patch_file, patch_source  # noqa: E402

# The shape of the deployed provider.py (lines 27-36, 80-124, 472-499).
STAND_IN = '''"""ARI provider."""
import os
from typing import Any, Dict, Optional


def _pjsip_endpoint(number: str) -> str:
    trunk = os.environ.get("ARI_PJSIP_DEFAULT_TRUNK", "").strip()
    if trunk:
        return f"PJSIP/{number}@{trunk}"
    return f"PJSIP/{number}"


class ARIProvider:
    async def initiate_call(self, to_number: str, from_number: Optional[str] = None):
        if to_number.startswith("SIP/") or to_number.startswith("PJSIP/"):
            sip_endpoint = to_number
        else:
            # Default to PJSIP technology
            sip_endpoint = _pjsip_endpoint(to_number)
        params = {"endpoint": sip_endpoint}
        if from_number:
            params["callerId"] = from_number
        return params

    async def transfer_call(self, destination: str, **kwargs):
        if destination.startswith("SIP/") or destination.startswith("PJSIP/"):
            sip_endpoint = destination
        else:
            sip_endpoint = _pjsip_endpoint(destination)
        params = {"endpoint": sip_endpoint}
        transfer_caller_id = kwargs.get("caller_id")
        if transfer_caller_id:
            params["callerId"] = transfer_caller_id
        return params
'''

ROUTES = "vonage/nanp11:+12017785210, +12019404210,12019774210"


def load(source):
    namespace = {}
    exec(compile(source, "provider.py", "exec"), namespace)
    return namespace["ARIProvider"]()


def call(provider, to, caller):
    return asyncio.run(provider.initiate_call(to, caller))


def with_env(**env):
    saved = {k: os.environ.get(k) for k in env}
    for k, v in env.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    return saved


def restore(saved):
    with_env(**saved)


def test_vonage_caller_goes_to_vonage_without_plus_others_unchanged():
    saved = with_env(ARI_PJSIP_DEFAULT_TRUNK="fractel", DOGRAH_ARI_CALLER_TRUNKS=ROUTES)
    try:
        p = load(patch_source(STAND_IN))
        assert call(p, "+15551234567", "+12017785210") == {
            "endpoint": "PJSIP/15551234567@vonage", "callerId": "12017785210"}
        assert call(p, "+15551234567", "12019774210")["endpoint"] == "PJSIP/15551234567@vonage"
        # A FracTEL number is dialled exactly as before.
        assert call(p, "+15551234567", "+18652757300") == {
            "endpoint": "PJSIP/+15551234567@fractel", "callerId": "+18652757300"}
        assert call(p, "+15551234567", None) == {"endpoint": "PJSIP/+15551234567@fractel"}
        # Transfers are untouched, whatever the caller ID.
        t = asyncio.run(p.transfer_call("+14233398241", caller_id="+12017785210"))
        assert t == {"endpoint": "PJSIP/+14233398241@fractel", "callerId": "+12017785210"}
    finally:
        restore(saved)


def test_unset_or_malformed_routes_change_nothing():
    for value in (None, "", "garbage", "vonage", ":+12017785210", "bad trunk/nanp11:+12017785210"):
        saved = with_env(ARI_PJSIP_DEFAULT_TRUNK="fractel", DOGRAH_ARI_CALLER_TRUNKS=value)
        try:
            p = load(patch_source(STAND_IN))
            assert call(p, "+15551234567", "+12017785210") == {
                "endpoint": "PJSIP/+15551234567@fractel", "callerId": "+12017785210"}, value
        finally:
            restore(saved)


def test_multiple_trunks_and_default_format():
    saved = with_env(ARI_PJSIP_DEFAULT_TRUNK="fractel",
                     DOGRAH_ARI_CALLER_TRUNKS="vonage/nanp11:+12017785210;twilio:+18005550100")
    try:
        p = load(patch_source(STAND_IN))
        assert call(p, "+15551234567", "+18005550100") == {
            "endpoint": "PJSIP/+15551234567@twilio", "callerId": "+18005550100"}
        assert call(p, "+15551234567", "+12017785210")["endpoint"] == "PJSIP/15551234567@vonage"
    finally:
        restore(saved)


def test_idempotent_and_refuses_other_releases():
    once = patch_source(STAND_IN)
    assert MARKER in once and patch_source(once) == once
    for bad in (STAND_IN.replace("_pjsip_endpoint(to_number)", "x(to_number)"),
                STAND_IN.replace("def _pjsip_endpoint(", "def other(")):
        try:
            patch_source(bad)
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
        assert open(path + ".bak-caller-trunk").read() == STAND_IN
        assert not patch_file(path, apply=True).changed


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
