"""Tests for the AI-callback kit's pure pieces.

Run:  python -m pytest deploy/dograh/tests -q
Or:   python deploy/dograh/tests/test_inbound_callback.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "inbound-callback")
)

from assign_inbound_agent import answered_numbers, plan_assignment, stasis_app_of  # noqa: E402
from install_inbound_callback import (  # noqa: E402
    CONTEXT,
    ENDPOINT,
    MARK_BEGIN,
    MARK_END,
    bridge_template,
    extensions_block,
    parse_result,
    pjsip_block,
    replace_block,
    udp_transport,
)

TRANSPORTS = """
Transport:  <TransportId........>  <Type>  <cos>  <tos>  <BindAddress....................>
==========================================================================================

Transport:  transport-tcp             tcp      0      0  0.0.0.0:5070
Transport:  transport-udp             udp      0      0  0.0.0.0:5070

Objects found: 2
"""


def test_pjsip_block_identifies_freeswitch_by_address():
    block = pjsip_block(["178.156.223.97", "127.0.0.1"], None)
    assert block.startswith(MARK_BEGIN) and block.rstrip().endswith(MARK_END)
    assert f"[{ENDPOINT}]\ntype=endpoint\ncontext={CONTEXT}" in block
    assert f"type=identify\nendpoint={ENDPOINT}\nmatch=178.156.223.97\nmatch=127.0.0.1" in block
    assert "transport=" not in block
    assert "transport=transport-udp" in pjsip_block(["1.2.3.4"], "transport-udp")


def test_extensions_block_hands_every_nanp_form_to_stasis_as_e164():
    block = extensions_block("dograh-abc123")
    assert f"[{CONTEXT}]" in block
    assert "exten => _+1NXXNXXXXXX,1," in block
    assert " same => n,Stasis(dograh-abc123)" in block
    assert "exten => _1NXXNXXXXXX,1,Goto(+${EXTEN},1)" in block
    assert "exten => _NXXNXXXXXX,1,Goto(+1${EXTEN},1)" in block


def test_extensions_block_refuses_an_unsafe_app_name():
    for bad in ("", "a,b", "x)\nexten => s,1,Dial(PJSIP/1@fractel"):
        try:
            extensions_block(bad)
        except ValueError:
            continue
        raise AssertionError(f"accepted {bad!r}")


def test_replace_block_is_idempotent_and_reversible():
    original = "[fractel]\ntype=endpoint\n"
    block = pjsip_block(["1.2.3.4"], None)
    once = replace_block(original, block)
    assert replace_block(once, block) == once
    assert replace_block(once, None) == original


def test_udp_transport_port():
    assert udp_transport(TRANSPORTS) == ("transport-udp", 5070, None)
    assert udp_transport(TRANSPORTS, "transport-tcp") is None
    assert udp_transport("nothing here") is None


def test_udp_transport_reports_a_specific_bind_address():
    bound = """
Transport:  transport-fractel         udp      0      0  5.161.18.25:5064
Transport:  transport-udp             udp      0      0  0.0.0.0:5062
"""
    assert udp_transport(bound) == ("transport-fractel", 5064, "5.161.18.25")
    assert udp_transport(bound, "transport-udp") == ("transport-udp", 5062, None)


def test_bridge_template_for_hopwhistle():
    assert bridge_template("178.156.223.97", 5070) == "sofia/external/{DID}@178.156.223.97:5070"


def test_parse_result_reads_the_last_result_line():
    assert parse_result('noise\nRESULT {"ok": true, "stasis_app": "a"}\n') == {
        "ok": True,
        "stasis_app": "a",
    }
    assert parse_result("no result") is None


def test_stasis_app_prefers_the_stasis_name():
    assert stasis_app_of({"app_name": "user", "stasis_app_name": "dograh-x"}) == "dograh-x"
    assert stasis_app_of('{"app_name": "user"}') == "user"
    assert stasis_app_of(None) is None


def test_plan_assignment():
    rows = [
        {"id": 1, "inbound_workflow_id": None},
        {"id": 2, "inbound_workflow_id": 15},
        {"id": 3, "inbound_workflow_id": 9},
    ]
    plan = plan_assignment(rows, 15, replace=False)
    assert [r["id"] for r in plan["to_set"]] == [1]
    assert [r["id"] for r in plan["already"]] == [2]
    assert [r["id"] for r in plan["other_agent"]] == [3]
    assert [r["id"] for r in plan_assignment(rows, 15, replace=True)["to_set"]] == [1, 3]
    # Clearing: everything not already empty is set to none.
    assert [r["id"] for r in plan_assignment(rows, None, replace=False)["to_set"]] == [2, 3]


def test_answered_numbers_are_what_the_agent_holds_after_the_run():
    rows = [
        {"id": 1, "address_normalized": "+18885550002", "inbound_workflow_id": None},
        {"id": 2, "address_normalized": "+18885550001", "inbound_workflow_id": 15},
        {"id": 3, "address_normalized": "+18885550003", "inbound_workflow_id": 9},
    ]
    plan = plan_assignment(rows, 15, replace=False)
    assert answered_numbers(plan, clear=False) == ["+18885550001", "+18885550002"]
    assert answered_numbers(plan, clear=True) == []


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print("ok")
