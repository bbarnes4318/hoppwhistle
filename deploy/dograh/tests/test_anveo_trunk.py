"""Tests for the Anveo trunk installer and caller-ID pool script's pure pieces.

Run:  python deploy/dograh/tests/test_anveo_trunk.py
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "anveo-trunk"))

from install_anveo_trunk import (  # noqa: E402
    MARK_BEGIN,
    credentials_from,
    extensions_block,
    pjsip_block,
    redact,
    replace_block,
    ten_digits,
    valid_host,
    valid_prefix,
)
from set_caller_id_pool import DEFAULT_NUMBERS, parse_numbers, to_e164  # noqa: E402


def test_host_and_prefix_validation():
    assert valid_host("sbc.anveo.com") and valid_host("sbc.anveo.com:5060") and valid_host("1.2.3.4")
    assert not valid_host("sip:sbc.anveo.com") and not valid_host("sbc.anveo.com;transport=tcp")
    assert valid_prefix("012345") and not valid_prefix("01a") and not valid_prefix("")


def test_pjsip_block_ip_auth_only():
    block = pjsip_block("sbc.anveo.com", None, None)
    assert "contact=sip:sbc.anveo.com" in block and "from_domain=sbc.anveo.com" in block
    assert "outbound_auth" not in block and block.startswith(MARK_BEGIN)


def test_pjsip_block_with_credentials_is_redacted():
    creds = credentials_from({"ANVEO_SIP_USERNAME": "u1", "ANVEO_SIP_PASSWORD": "s3cret"})
    block = pjsip_block("sbc.anveo.com:5060", "anveo.com", creds)
    assert "outbound_auth=anveo-auth" in block and "realm=anveo.com" in block
    assert "from_domain=anveo.com" in block
    assert "s3cret" in block and "s3cret" not in redact(block)
    assert credentials_from({"ANVEO_SIP_USERNAME": "u1"}) is None


def test_test_context_dials_with_prefix():
    block = extensions_block("012345")
    assert "Dial(PJSIP/0123451${HW_TO}@anveo,60)" in block
    assert "[anveo-no-inbound]" in block


def test_block_replace_is_idempotent_and_reversible():
    base = "[general]\nfoo=bar\n"
    once = replace_block(base, pjsip_block("sbc.anveo.com", None, None))
    assert replace_block(once, pjsip_block("sbc.anveo.com", None, None)) == once
    assert replace_block(once, None) == base


def test_number_normalisation():
    assert ten_digits("+1 (865) 280-9894") == "8652809894" and ten_digits("12345") is None
    assert to_e164("865-280-9894") == "+18652809894" and to_e164("0652809894") is None
    assert parse_numbers(["+1(865)2809894, 8652809893", "18652809893"]) == ["+18652809894", "+18652809893"]
    assert DEFAULT_NUMBERS == ["+18652809894", "+18652809893", "+18652809892"]


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
