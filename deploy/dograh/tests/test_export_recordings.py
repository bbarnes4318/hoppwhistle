"""Tests for the pure pieces of the Dograh recording export.

Run locally (no DB needed):  python -m pytest deploy/dograh/tests -q
Or plain:                    python deploy/dograh/tests/test_export_recordings.py
"""

from __future__ import annotations

import os
import sys
from datetime import date, datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from export_recordings import (  # noqa: E402
    audio_filename,
    duration_of,
    field,
    find_recording,
    classify_location,
    dig,
    dig_recording,
    key_from_url,
    normalize_argv,
    parse_day,
    pick_time_column,
    rank_tables,
    recording_columns,
    resolve_zone,
    split_s3_uri,
    window_bounds,
)


def test_both_date_formats_read_the_same_day():
    assert parse_day("2026-08-25") == date(2026, 8, 25)
    assert parse_day("8/25/2026") == date(2026, 8, 25)
    assert parse_day(" 08/25/2026 ") == date(2026, 8, 25)


def test_window_includes_the_last_day():
    start, end = window_bounds(date(2026, 8, 25), date(2026, 9, 1), timezone.utc)
    assert start == datetime(2026, 8, 25, tzinfo=timezone.utc)
    # A call at 23:59 on 9/1 is in the window; midnight on 9/2 is not.
    assert end == datetime(2026, 9, 2, tzinfo=timezone.utc)


def test_window_shifts_with_the_zone():
    eastern = resolve_zone("-04:00")
    start, end = window_bounds(date(2026, 8, 25), date(2026, 9, 1), eastern)
    assert start == datetime(2026, 8, 25, 4, tzinfo=timezone.utc)
    assert end == datetime(2026, 9, 2, 4, tzinfo=timezone.utc)


def test_utc_and_offset_zones_need_no_tzdata():
    assert resolve_zone("utc") is timezone.utc
    assert resolve_zone("+05:30").utcoffset(None) == timedelta(hours=5, minutes=30)


def test_recording_locations_are_classified():
    assert classify_location("https://x/rec.mp3?sig=1") == ("url", "https://x/rec.mp3?sig=1")
    assert classify_location("s3://bucket/2026/08/25/a.wav")[0] == "s3"
    assert classify_location("/app/recordings/a.wav") == ("path", "/app/recordings/a.wav")
    assert classify_location("recordings/a.wav") == ("key", "recordings/a.wav")
    assert classify_location("./recordings/a.wav") == ("key", "recordings/a.wav")


def test_empty_recording_values_are_not_locations():
    for value in (None, "", "  ", "None", "null", "NaN"):
        assert classify_location(value) == (None, "")


def test_s3_uri_splits_into_bucket_and_key():
    assert split_s3_uri("s3://dograh-recordings/2026/08/a.wav") == (
        "dograh-recordings",
        "2026/08/a.wav",
    )


def test_key_comes_out_of_both_url_shapes():
    assert key_from_url("https://s3.eu/dograh-rec/2026/a.wav?X=1", "dograh-rec") == "2026/a.wav"
    assert key_from_url("https://dograh-rec.s3.eu/2026/a.wav", "dograh-rec") == "2026/a.wav"


def test_audio_filename_is_sortable_and_names_the_call():
    started = datetime(2026, 8, 25, 14, 3, 9, tzinfo=timezone.utc)
    assert (
        audio_filename(started, 8814, "+18655551212", "s3://b/x.mp3")
        == "2026-08-25_140309_run8814_18655551212.mp3"
    )
    # Unknown extension falls back to wav, and a missing number still names a file.
    assert audio_filename(started, 8814, None, "s3://b/x").endswith("_run8814_unknown.wav")


def test_metadata_is_found_inside_nested_json_context():
    context = {"initial_context": {"call_to": "+18655551212", "meta": {"duration": 42}}}
    assert dig(context, ("call_to", "to_number")) == "+18655551212"
    assert dig(context, ("duration",)) == 42
    assert dig(context, ("nothing_here",)) is None


def test_recording_reference_is_found_by_key_name():
    assert dig_recording({"a": {"recording_url": "https://x/r.wav"}}) == "https://x/r.wav"
    # A recording key with nothing behind it is not a hit.
    assert dig_recording({"recording_url": None, "b": {"audio_url": "s3://k/a.wav"}}) == "s3://k/a.wav"
    assert dig_recording({"transcript": "no audio here"}) is None


def test_recording_object_yields_the_location_inside_it():
    assert dig_recording({"recording": {"url": "https://x/r.wav", "size": 12}}) == "https://x/r.wav"
    assert dig_recording({"recording_meta": {"s3_key": "2026/08/a.wav"}}) == "2026/08/a.wav"
    # An object with nothing fetchable in it is not a hit.
    assert dig_recording({"recording": {"size": 12}}) is None


def test_an_object_is_never_itself_a_location():
    assert classify_location({"url": "https://x/r.wav"}) == (None, "")
    assert classify_location(["https://x/r.wav"]) == (None, "")


def test_json_encoded_context_is_still_searched():
    assert dig('{"call_to": "+18655551212"}', ("call_to",)) == "+18655551212"


def test_created_at_wins_over_other_timestamps():
    columns = {
        "id": "integer",
        "updated_at": "timestamp with time zone",
        "created_at": "timestamp with time zone",
    }
    assert pick_time_column(columns) == "created_at"
    assert pick_time_column({"id": "integer"}) is None


def test_recording_columns_match_by_name_and_type():
    columns = {
        "recording_url": "text",
        "recording_meta": "jsonb",
        "recording_enabled": "boolean",
        "transcript": "text",
    }
    assert recording_columns(columns) == ["recording_url", "recording_meta"]


def test_dograh_run_table_is_tried_first():
    tables = {
        "audit_log": {"created_at": "timestamp with time zone", "note": "text"},
        "call_logs": {"created_at": "timestamp with time zone", "recording_url": "text"},
        "workflow_runs": {"created_at": "timestamp with time zone", "gathered_context": "jsonb"},
    }
    ranked = rank_tables(tables)
    assert ranked[0] == "workflow_runs"
    assert "call_logs" in ranked
    # No recording reference anywhere on it, so it is never a source.
    assert "audit_log" not in ranked


def test_row_metadata_comes_from_columns_or_context():
    row = {
        "id": 1,
        "initial_context": {"call_to": "+18655551212", "caller_number": "+18595550000"},
    }
    assert field(row, ("to_number", "call_to")) == "+18655551212"
    assert field(row, ("from_number", "caller_number")) == "+18595550000"
    assert field(row, ("nothing",)) is None


def test_duration_falls_back_to_the_timestamps():
    started = datetime(2026, 8, 25, 14, 0, 0, tzinfo=timezone.utc)
    row = {"created_at": started, "ended_at": started + timedelta(seconds=95)}
    assert duration_of(row) == 95.0
    assert duration_of({"duration": "12.34"}) == 12.3
    assert duration_of({"id": 1}) is None


def test_recording_is_found_on_the_column_then_in_context():
    row = {"id": 1, "recording_url": "https://x/r.wav"}
    assert find_recording(row, ["recording_url"]) == ("recording_url", "url", "https://x/r.wav")
    # Column present but empty: the context still carries it.
    nested = {"id": 1, "recording_url": None, "gathered_context": {"recording_url": "s3://b/r.wav"}}
    column, kind, location = find_recording(nested, ["recording_url"])
    assert (kind, location) == ("s3", "s3://b/r.wav")
    assert find_recording({"id": 1}, []) == (None, None, "")


def test_negative_tz_offset_survives_argparse():
    assert normalize_argv(["--tz", "-04:00", "--out", "/x"]) == ["--tz=-04:00", "--out", "/x"]
    # A normal value is left exactly as it was.
    assert normalize_argv(["--tz", "utc"]) == ["--tz", "utc"]
    assert normalize_argv(["--from", "2026-08-25"]) == ["--from", "2026-08-25"]


if __name__ == "__main__":
    failures = 0
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"ok   {name}")
            except AssertionError as exc:
                failures += 1
                print(f"FAIL {name}: {exc}")
    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)
