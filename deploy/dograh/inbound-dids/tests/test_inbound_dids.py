"""Tests for the inbound DID importer's pure logic (no DB/Redis needed).

Run locally:  python -m pytest deploy/dograh/inbound-dids/tests -q
Or plain:     python deploy/dograh/inbound-dids/tests/test_inbound_dids.py
"""

from __future__ import annotations

import csv
import json
import os
import sys
import tempfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from import_inbound_dids import (  # noqa: E402
    BATCH_ORDER,
    E164_US,
    INBOUND_POOL_TAG,
    load_rows,
    merge_metadata,
)

REPO_CSV = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "dograh-inbound-numbers.csv"
)


def _write_csv(rows: list[dict]) -> str:
    fd, path = tempfile.mkstemp(suffix=".csv")
    with os.fdopen(fd, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["address", "npa", "batch"])
        w.writeheader()
        for r in rows:
            w.writerow(r)
    return path


def test_e164_pattern_rejects_the_normalization_trap():
    # The whole point: only +1 + 10 digits round-trips through Dograh's
    # normalize_telephony_address() when it is called with no country hint.
    assert E164_US.match("+19138999080")
    assert not E164_US.match("9138999080")  # would become +9138999080
    assert not E164_US.match("19138999080")
    assert not E164_US.match("913-899-9080")
    assert not E164_US.match("+1913899908")  # short
    assert not E164_US.match("+191389990801")  # long
    assert not E164_US.match("+11138999080")  # N11 area code


def test_live_batch_is_ordered_first():
    path = _write_csv(
        [
            {"address": "+12125551000", "npa": "212", "batch": "book207-new"},
            {"address": "+12125551001", "npa": "212", "batch": "live-since-aug22"},
            {"address": "+12125551002", "npa": "212", "batch": "book207-new"},
            {"address": "+12125551003", "npa": "212", "batch": "live-since-aug22"},
        ]
    )
    try:
        valid, rejected = load_rows(path)
    finally:
        os.unlink(path)
    assert rejected == []
    assert [r["address"] for r in valid] == [
        "+12125551001",
        "+12125551003",  # live first, CSV order preserved within the batch
        "+12125551000",
        "+12125551002",
    ]


def test_canary_slice_takes_a_live_number():
    # --limit 1 must pick a live-since-aug22 number, not a cold book207 one:
    # only live numbers can generate a callback before the SBC pool cutover.
    path = _write_csv(
        [
            {"address": "+12125551000", "npa": "212", "batch": "book207-new"},
            {"address": "+12125551001", "npa": "212", "batch": "live-since-aug22"},
        ]
    )
    try:
        valid, _ = load_rows(path)
    finally:
        os.unlink(path)
    assert valid[0]["batch"] == "live-since-aug22"


def test_malformed_and_duplicate_rows_are_reported_not_coerced():
    path = _write_csv(
        [
            {"address": "9138999080", "npa": "913", "batch": "live-since-aug22"},
            {"address": "+12125551001", "npa": "212", "batch": "live-since-aug22"},
            {"address": "+12125551001", "npa": "212", "batch": "book207-new"},
            {"address": "", "npa": "", "batch": ""},
        ]
    )
    try:
        valid, rejected = load_rows(path)
    finally:
        os.unlink(path)
    assert [r["address"] for r in valid] == ["+12125551001"]
    reasons = {r["reason"] for r in rejected}
    assert reasons == {"NOT_US_E164", "DUPLICATE_IN_CSV"}


def test_metadata_merge_never_clobbers_the_state_cid_pool_tag():
    # Many of these DIDs are also state-matched outbound caller IDs. Overwriting
    # `pool` would break pool_state_inventory.py and the state-CID rollback path.
    existing = {"pool": "state_cid", "state": "KS", "npa": "913"}
    merged = merge_metadata(existing, "913", "live-since-aug22", "2026-08-26T00:00:00Z")
    assert merged["pool"] == "state_cid"
    assert merged["state"] == "KS"
    assert merged["inbound_pool"] == INBOUND_POOL_TAG
    assert merged["inbound_batch"] == "live-since-aug22"


def test_metadata_merge_accepts_json_string_and_null():
    merged = merge_metadata('{"pool": "state_cid"}', "212", "book207-new", "ts")
    assert merged["pool"] == "state_cid"
    assert merged["inbound_pool"] == INBOUND_POOL_TAG

    merged_null = merge_metadata(None, "212", "", "ts")
    assert merged_null["inbound_pool"] == INBOUND_POOL_TAG
    assert "inbound_batch" not in merged_null  # empty batch is not recorded
    assert json.dumps(merged_null)  # must be JSON-serializable for the ::json cast


def test_shipped_csv_is_clean_and_matches_expected_batches():
    valid, rejected = load_rows(REPO_CSV)
    assert rejected == [], f"shipped CSV has bad rows: {rejected[:5]}"
    assert len(valid) == 2777
    counts: dict[str, int] = {}
    for r in valid:
        counts[r["batch"]] = counts.get(r["batch"], 0) + 1
    assert counts == {"live-since-aug22": 1054, "book207-new": 1723}
    # every live number sorts ahead of every cold one
    first_cold = next(i for i, r in enumerate(valid) if r["batch"] == "book207-new")
    assert all(r["batch"] == "live-since-aug22" for r in valid[:first_cold])
    assert set(BATCH_ORDER) == {"live-since-aug22", "book207-new"}


def test_shipped_csv_npa_column_agrees_with_the_address():
    valid, _ = load_rows(REPO_CSV)
    mismatched = [r for r in valid if r["npa"] != r["address"][2:5]]
    assert mismatched == [], f"npa/address disagreement: {mismatched[:5]}"


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
