"""Tests for the Twilio Elastic SIP trunk installer's pure pieces.

Run:  python deploy/dograh/tests/test_twilio_trunk.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "twilio-trunk"))

from install_twilio_trunk import (  # noqa: E402
    DIAL_TEMPLATE,
    MARK_BEGIN,
    extensions_block,
    pjsip_block,
    read_credentials,
    redact,
    replace_block,
    valid_termination,
)


def test_termination_must_be_a_twilio_pstn_host():
    assert valid_termination("pvn.pstn.twilio.com")
    assert not valid_termination("pvn.pstn.twilio.com;evil")
    assert not valid_termination("example.com")
    assert not valid_termination("sip:pvn.pstn.twilio.com")


def test_block_without_credentials_relies_on_ip_acl():
    block = pjsip_block("pvn.pstn.twilio.com", None)
    assert "contact=sip:pvn.pstn.twilio.com" in block
    assert "from_domain=pvn.pstn.twilio.com" in block
    assert "outbound_auth" not in block and "password=" not in block


def test_block_with_credentials_and_redaction():
    block = pjsip_block("pvn.pstn.twilio.com", ("acct", "s3cret"))
    assert "outbound_auth=twilio-auth" in block and "password=s3cret" in block
    assert "s3cret" not in redact(block)


def test_credentials_file_parsing():
    assert read_credentials("\nacct:pa:ss\n") == ("acct", "pa:ss")
    for bad in ("", "nocolon", ":pw", "user:", "u:p;x"):
        try:
            read_credentials(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad!r}")


def test_idempotent_and_reversible():
    base = "[fractel]\ntype=endpoint\n"
    once = replace_block(base, pjsip_block("pvn.pstn.twilio.com", None))
    assert replace_block(once, pjsip_block("pvn.pstn.twilio.com", None)) == once
    assert once.count(MARK_BEGIN) == 1
    assert replace_block(once, None) == base


def test_test_context_and_dial_template():
    assert "[twilio-test]" in extensions_block()
    assert DIAL_TEMPLATE == "PJSIP/{number}@twilio"


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
