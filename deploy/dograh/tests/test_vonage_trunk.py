"""Tests for the Vonage trunk installer's pure pieces.

Run:  python deploy/dograh/tests/test_vonage_trunk.py
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vonage-trunk"))

from install_vonage_trunk import (  # noqa: E402
    MARK_BEGIN,
    credentials_from,
    extensions_block,
    pjsip_block,
    redact,
    replace_block,
    ten_digits,
    valid_host,
)


def test_host_validation():
    assert valid_host("sip.nexmo.com") and valid_host("sip-us.nexmo.com:5060")
    assert not valid_host("sip:sip.nexmo.com") and not valid_host("sip.nexmo.com;transport=tcp")


def test_ip_auth_block_has_no_credentials():
    block = pjsip_block("sip.nexmo.com", None, None)
    assert block.startswith(MARK_BEGIN)
    assert "contact=sip:sip.nexmo.com" in block and "from_domain=sip.nexmo.com" in block
    assert "context=vonage-no-inbound" in block and "outbound_auth" not in block


def test_credentials_both_or_neither_and_redacted():
    assert credentials_from({}) is None
    for half in ({"VONAGE_SIP_USERNAME": "key"}, {"VONAGE_SIP_PASSWORD": "secret"}):
        try:
            credentials_from(half)
        except ValueError:
            pass
        else:
            raise AssertionError("accepted only one of username/password")
    creds = credentials_from({"VONAGE_SIP_USERNAME": "key", "VONAGE_SIP_PASSWORD": "s3cret"})
    block = pjsip_block("sip.nexmo.com", "sip.nexmo.com", creds)
    assert "outbound_auth=vonage-auth" in block and "username=key" in block
    assert "s3cret" in block and "s3cret" not in redact(block)


def test_test_context_dials_without_plus():
    block = extensions_block()
    assert "Dial(PJSIP/1${HW_TO}@vonage,60)" in block
    assert "+" not in block.split("[vonage-no-inbound]")[0].split("Dial(")[1].split(",")[0]


def test_block_replace_is_idempotent_and_reversible():
    base = "[general]\nfoo=bar\n"
    once = replace_block(base, pjsip_block("sip.nexmo.com", None, None))
    assert replace_block(once, pjsip_block("sip.nexmo.com", None, None)) == once
    assert replace_block(once, None) == base


def test_ten_digits():
    assert ten_digits("+1 (555) 123-4567") == "5551234567"
    assert ten_digits("5551234567") == "5551234567"
    assert ten_digits("+442071234567") is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
