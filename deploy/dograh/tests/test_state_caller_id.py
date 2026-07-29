"""Tests for the state-matched caller-ID pieces that run on the Dograh side.

Run locally (no Redis/DB needed):  python -m pytest deploy/dograh/tests -q
Or plain:                          python deploy/dograh/tests/test_state_caller_id.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from areacode_state import (  # noqa: E402
    AREA_CODE_TO_STATE,
    normalize_us_e164,
    state_for_number,
)


def test_normalization_formats_equal():
    assert normalize_us_e164("(865) 555-1212") == "+18655551212"
    assert normalize_us_e164("18655551212") == "+18655551212"
    assert normalize_us_e164("+1 865 555 1212") == "+18655551212"
    assert normalize_us_e164("865-555-1212") == "+18655551212"


def test_short_or_malformed_rejected():
    assert normalize_us_e164("55512") is None
    assert normalize_us_e164("") is None
    assert normalize_us_e164(None) is None
    assert normalize_us_e164("0655551212") is None  # NPA can't start with 0
    assert normalize_us_e164("8650551212") is None  # NXX can't start with 0
    assert state_for_number("55512") == (None, "INVALID_NUMBER")


def test_non_us_rejected():
    assert state_for_number("+447911123456") == (None, "NON_US_DESTINATION")


def test_toll_free_non_geographic():
    for npa in ("800", "833", "844", "855", "866", "877", "888", "900"):
        st, reason = state_for_number(f"+1{npa}5551212")
        assert st is None and reason == "TOLL_FREE_OR_NON_GEOGRAPHIC", npa


def test_unknown_territory_npa():
    # Puerto Rico (787) is deliberately unsupported for state matching.
    assert state_for_number("+17875551212") == (
        None,
        "UNKNOWN_OR_UNSUPPORTED_AREA_CODE",
    )


def test_overlay_area_codes_map_to_same_state():
    overlays = {
        # overlay -> (established code in same market, state)
        "839": ("803", "SC"),
        "551": ("201", "NJ"),
        "224": ("847", "IL"),
        "223": ("717", "PA"),
        "240": ("301", "MD"),
    }
    for overlay, (established, state) in overlays.items():
        assert AREA_CODE_TO_STATE.get(overlay) == state, overlay
        assert AREA_CODE_TO_STATE.get(established) == state, established


def test_imported_pool_area_codes():
    expected = {
        "839": "SC", "551": "NJ", "423": "TN", "276": "VA", "251": "AL",
        "240": "MD", "231": "MI", "228": "MS", "224": "IL", "223": "PA",
        "216": "OH",
    }
    for npa, state in expected.items():
        assert AREA_CODE_TO_STATE.get(npa) == state, npa


def test_same_state_filter_logic():
    """Mirrors the dispatcher's allowed-list construction."""
    pool = ["+18392000722", "+14236444347", "+12166777926", "+19138999080"]
    dest_state, reason = state_for_number("+18655551212")  # TN
    assert (dest_state, reason) == ("TN", "OK")
    same_state = [n for n in pool if state_for_number(n)[0] == dest_state]
    assert same_state == ["+14236444347"]

    dest_state, _ = state_for_number("+13055551212")  # FL — no inventory
    same_state = [n for n in pool if state_for_number(n)[0] == dest_state]
    assert same_state == []  # strict policy must fail closed on this


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"PASS {name}")
            except AssertionError as e:
                failures += 1
                print(f"FAIL {name}: {e}")
    raise SystemExit(1 if failures else 0)
