"""Export Dograh AI voice call recordings for a date window.

Pulls every call run Dograh recorded between two dates (inclusive), writes a
manifest CSV of what it found, and downloads the audio next to it.

Dograh owns its own database and recording storage; nothing about these calls
lands in the Hopwhistle DB. So this runs where Dograh lives -- inside the
``dograh-api-1`` container on the Hetzner box, which already has DATABASE_URL,
asyncpg, and (when recordings are on S3/MinIO) the bucket credentials::

    docker cp deploy/dograh/export_recordings.py dograh-api-1:/tmp/dograh-rec/
    docker exec dograh-api-1 python /tmp/dograh-rec/export_recordings.py \
        --from 2026-08-25 --to 2026-09-01 --out /tmp/dograh-rec/out

``get-dograh-recordings.sh`` in the repo root does all of that and copies the
result off the container; prefer it. This module is the part that knows Dograh.

Schema discovery: Dograh's schema moves between releases, so nothing here is
hardcoded to one column. The exporter finds the table that carries a recording
reference plus a timestamp (``workflow_runs`` in every build seen so far),
picks the one with rows in the window, and reads the recording location out of
whichever column -- text or JSON -- actually holds it. If it finds nothing it
says what it looked at rather than reporting a clean empty run.

Read-only against the database. It only ever writes to --out.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
import re
import shutil
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, time, timedelta, timezone

RECORDING_RE = re.compile(r"recording|record_url|audio_url|audio_file", re.I)
TIME_PREFERENCE = ("created_at", "started_at", "start_time", "inserted_at", "updated_at")
TEXTY = {"text", "character varying", "character", "citext"}
JSONY = {"json", "jsonb"}
TIMEY = {"timestamp with time zone", "timestamp without time zone"}

TO_NUMBER_KEYS = (
    "call_to", "to_number", "to_phone_number", "callee", "callee_number",
    "destination", "destination_number", "phone_number", "phone", "to",
)
FROM_NUMBER_KEYS = (
    "caller_number", "from_number", "from_phone_number", "caller", "caller_id", "from",
)
DURATION_KEYS = ("duration_seconds", "call_duration", "duration", "seconds")
LOCATION_KEYS = (
    "signed_url", "presigned_url", "download_url", "url", "uri", "public_url",
    "path", "file_path", "filepath", "location", "file", "filename",
    "s3_key", "object_key", "key",
)
DISPOSITION_KEYS = (
    "disposition", "call_disposition", "outcome", "call_outcome",
    "hangup_reason", "end_reason", "status",
)
# Transcripts and prompt dumps are large and are not what a recording pull is
# for; they would swamp the manifest.
MANIFEST_SKIP_RE = re.compile(r"transcript|prompt|messages|history|context_dump", re.I)

S3_BUCKET_ENV = ("S3_BUCKET_NAME", "AWS_S3_BUCKET", "S3_BUCKET", "AWS_BUCKET_NAME", "MINIO_BUCKET")
S3_ENDPOINT_ENV = ("AWS_ENDPOINT_URL", "AWS_ENDPOINT_URL_S3", "S3_ENDPOINT_URL", "S3_ENDPOINT", "MINIO_ENDPOINT")


# --------------------------------------------------------------------------
# pure helpers (unit-tested in tests/test_export_recordings.py)
# --------------------------------------------------------------------------

def parse_day(text: str) -> date:
    """Accept 2026-08-25, 8/25/2026 and 08/25/2026. Year is always required."""
    raw = (text or "").strip()
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m-%d-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise SystemExit(
        f"Could not read '{text}' as a date. Use 2026-08-25 or 8/25/2026 "
        "(the year is required)."
    )


def resolve_zone(name: str):
    """Return a tzinfo for --tz. 'utc' and fixed +HH:MM offsets need no tzdata."""
    label = (name or "utc").strip()
    if label.lower() in ("utc", "z", "gmt"):
        return timezone.utc
    match = re.fullmatch(r"([+-])(\d{2}):?(\d{2})", label)
    if match:
        sign = 1 if match.group(1) == "+" else -1
        return timezone(sign * timedelta(hours=int(match.group(2)), minutes=int(match.group(3))))
    try:
        from zoneinfo import ZoneInfo

        return ZoneInfo(label)
    except Exception as exc:  # no tzdata in the image, or a bad name
        raise SystemExit(
            f"Cannot use --tz {label}: {exc}. Pass --tz utc or a fixed offset "
            "like --tz -04:00 (US Eastern in August)."
        )


def window_bounds(from_day: date, to_day: date, tz) -> tuple[datetime, datetime]:
    """Both dates inclusive: the window ends at midnight after --to."""
    if to_day < from_day:
        raise SystemExit(f"--to ({to_day}) is before --from ({from_day}).")
    start = datetime.combine(from_day, time.min, tzinfo=tz)
    end = datetime.combine(to_day + timedelta(days=1), time.min, tzinfo=tz)
    return start.astimezone(timezone.utc), end.astimezone(timezone.utc)


def classify_location(value):
    """Work out how to fetch a recording reference.

    Returns (kind, normalized) where kind is url | s3 | path | key, or
    (None, '') when there is nothing to fetch.
    """
    if value is None or isinstance(value, (dict, list, tuple)):
        return None, ""
    text = str(value).strip().strip('"')
    if not text or text.lower() in ("none", "null", "nan"):
        return None, ""
    low = text.lower()
    if low.startswith(("http://", "https://")):
        return "url", text
    if low.startswith("s3://"):
        return "s3", text
    if low.startswith("file://"):
        return "path", text[7:]
    if text.startswith("/"):
        return "path", text
    return "key", text.lstrip("./")


def split_s3_uri(uri: str) -> tuple[str, str]:
    rest = uri[5:] if uri.lower().startswith("s3://") else uri
    bucket, _, key = rest.partition("/")
    return bucket, key


def key_from_url(url: str, bucket: str) -> str:
    """The object key inside a storage URL, path-style or virtual-hosted."""
    path = urllib.parse.urlsplit(url).path.lstrip("/")
    if bucket and (path == bucket or path.startswith(bucket + "/")):
        path = path[len(bucket):].lstrip("/")
    return path


def audio_extension(location: str) -> str:
    base = location.split("?", 1)[0].rstrip("/")
    _, ext = os.path.splitext(os.path.basename(base))
    if ext and 1 < len(ext) <= 5 and re.fullmatch(r"\.[A-Za-z0-9]+", ext):
        return ext.lower()
    return ".wav"


def digits(value) -> str:
    return re.sub(r"\D", "", str(value or ""))


def audio_filename(started_at, run_id, phone, location: str) -> str:
    stamp = started_at.strftime("%Y-%m-%d_%H%M%S") if started_at else "undated"
    who = digits(phone) or "unknown"
    return f"{stamp}_run{run_id}_{who}{audio_extension(location)}"


def dig(blob, keys):
    """First value under any of `keys`, searched case-insensitively and nested."""
    wanted = [k.lower() for k in keys]
    stack = [blob]
    seen = 0
    while stack and seen < 400:
        current = stack.pop(0)
        seen += 1
        if isinstance(current, str):
            stripped = current.strip()
            if stripped.startswith(("{", "[")):
                try:
                    stack.append(json.loads(stripped))
                except (ValueError, TypeError):
                    pass
            continue
        if isinstance(current, dict):
            lowered = {str(k).lower(): v for k, v in current.items()}
            for key in wanted:
                value = lowered.get(key)
                if value not in (None, "", [], {}):
                    return value
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return None


def dig_recording(blob):
    """Find a recording-looking value anywhere in a JSON blob."""
    stack = [blob]
    seen = 0
    while stack and seen < 400:
        current = stack.pop(0)
        seen += 1
        if isinstance(current, str):
            stripped = current.strip()
            if stripped.startswith(("{", "[")):
                try:
                    stack.append(json.loads(stripped))
                except (ValueError, TypeError):
                    pass
            continue
        if isinstance(current, dict):
            for key, value in current.items():
                if not RECORDING_RE.search(str(key)):
                    continue
                if classify_location(value)[0]:
                    return value
                # {"recording": {"url": ...}} — the location is one level in.
                inner = dig(value, LOCATION_KEYS)
                if classify_location(inner)[0]:
                    return inner
            stack.extend(current.values())
        elif isinstance(current, list):
            stack.extend(current)
    return None


def pick_time_column(columns: dict) -> str | None:
    timestamps = [name for name, kind in columns.items() if kind in TIMEY]
    for preferred in TIME_PREFERENCE:
        if preferred in timestamps:
            return preferred
    return timestamps[0] if timestamps else None


def recording_columns(columns: dict) -> list:
    return [
        name
        for name, kind in columns.items()
        if RECORDING_RE.search(name) and (kind in TEXTY or kind in JSONY)
    ]


def json_columns(columns: dict) -> list:
    return [name for name, kind in columns.items() if kind in JSONY]


def rank_tables(tables: dict) -> list:
    """Tables that could hold recorded calls, best guess first.

    workflow_runs is Dograh's call-run table in every build seen so far; the
    rest are here so a renamed table still gets found.
    """
    candidates = []
    for table, columns in tables.items():
        if not pick_time_column(columns):
            continue
        if not (recording_columns(columns) or json_columns(columns)):
            continue
        known = table in ("workflow_runs", "calls", "call_runs", "call_logs")
        candidates.append((0 if table == "workflow_runs" else (1 if known else 2), table))
    return [table for _, table in sorted(candidates)]


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

async def load_schema(conn) -> dict:
    rows = await conn.fetch(
        "select table_name, column_name, data_type from information_schema.columns "
        "where table_schema = 'public' order by table_name, ordinal_position"
    )
    tables: dict = {}
    for row in rows:
        tables.setdefault(row["table_name"], {})[row["column_name"]] = row["data_type"]
    return tables


async def count_in_window(conn, table, time_column, start, end) -> int:
    return await conn.fetchval(
        f'select count(*) from public."{table}" where "{time_column}" >= $1 and "{time_column}" < $2',
        start,
        end,
    )


async def choose_source(conn, tables, start, end):
    """The table with rows in the window, preferring Dograh's own run table."""
    tried = []
    for table in rank_tables(tables):
        time_column = pick_time_column(tables[table])
        try:
            found = await count_in_window(conn, table, time_column, start, end)
        except Exception as exc:  # a view we cannot read, a permission wall
            tried.append((table, time_column, f"unreadable: {exc}"))
            continue
        tried.append((table, time_column, f"{found} rows in window"))
        if found:
            return table, time_column, tried
    return None, None, tried


async def window_context(conn, table, time_column):
    """What the table does hold, for when the window comes back empty."""
    row = await conn.fetchrow(
        f'select min("{time_column}") as first, max("{time_column}") as last, count(*) as total '
        f'from public."{table}"'
    )
    recent = await conn.fetch(
        f'select date_trunc(\'day\', "{time_column}") as day, count(*) as runs '
        f'from public."{table}" group by 1 order by 1 desc limit 14'
    )
    return row, recent


async def workflow_names(conn, tables) -> dict:
    if "workflows" not in tables:
        return {}
    columns = tables["workflows"]
    label = next((c for c in ("name", "title", "workflow_name") if c in columns), None)
    if not label or "id" not in columns:
        return {}
    rows = await conn.fetch(f'select id, "{label}" as label from public.workflows')
    return {row["id"]: row["label"] for row in rows}


# --------------------------------------------------------------------------
# row -> manifest entry
# --------------------------------------------------------------------------

def field(row, keys):
    """Pull a value from the row itself, then from any JSON column on it."""
    lowered = {str(k).lower(): v for k, v in row.items()}
    for key in keys:
        value = lowered.get(key)
        if value not in (None, "", [], {}):
            return value
    for value in row.values():
        if isinstance(value, (dict, list)) or (
            isinstance(value, str) and value.strip().startswith(("{", "["))
        ):
            found = dig(value, keys)
            if found not in (None, "", [], {}):
                return found
    return None


def find_recording(row, rec_columns):
    for column in rec_columns:
        kind, location = classify_location(row.get(column))
        if kind:
            return column, kind, location
        blob = row.get(column)
        if isinstance(blob, (dict, list, str)):
            nested = dig_recording(blob)
            kind, location = classify_location(nested)
            if kind:
                return column, kind, location
    for column, value in row.items():
        if isinstance(value, (dict, list)) or (
            isinstance(value, str) and value.strip().startswith(("{", "["))
        ):
            nested = dig_recording(value)
            kind, location = classify_location(nested)
            if kind:
                return column, kind, location
    return None, None, ""


def duration_of(row):
    value = field(row, DURATION_KEYS)
    if value is not None:
        try:
            return round(float(value), 1)
        except (TypeError, ValueError):
            pass
    started = field(row, ("created_at", "started_at", "start_time"))
    ended = field(row, ("ended_at", "completed_at", "end_time", "finished_at"))
    if isinstance(started, datetime) and isinstance(ended, datetime):
        return round((ended - started).total_seconds(), 1)
    return None


def jsonable(value):
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, (dict, list)):
        return json.dumps(value, default=str)[:400]
    return value


# --------------------------------------------------------------------------
# fetching audio
# --------------------------------------------------------------------------

class Fetcher:
    def __init__(self, bucket, endpoint, search_dirs, timeout=120):
        self.bucket = bucket
        self.endpoint = endpoint
        self.search_dirs = search_dirs
        self.timeout = timeout
        self._s3 = None
        self.s3_error = None

    def s3(self):
        if self._s3 is None and self.s3_error is None:
            try:
                import boto3  # available in the dograh api image when S3 is configured

                self._s3 = boto3.client("s3", endpoint_url=self.endpoint or None)
            except Exception as exc:
                self.s3_error = f"no usable S3 client ({exc})"
        return self._s3

    def get(self, kind, location, destination) -> tuple[bool, str]:
        if kind == "url":
            return self._http(location, destination)
        if kind == "s3":
            bucket, key = split_s3_uri(location)
            return self._s3_get(bucket, key, destination)
        if kind == "path":
            return self._local(location, destination)
        if kind == "key":
            if self.bucket:
                ok, note = self._s3_get(self.bucket, location, destination)
                if ok:
                    return ok, note
                local_ok, local_note = self._local(location, destination)
                return (True, local_note) if local_ok else (False, note)
            return self._local(location, destination)
        return False, "no recording reference on this run"

    def _http(self, url, destination) -> tuple[bool, str]:
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "dograh-recording-export"})
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                with open(destination, "wb") as handle:
                    shutil.copyfileobj(response, handle)
            return True, ""
        except urllib.error.HTTPError as exc:
            # Dograh persists presigned URLs; they expire long before a
            # week-old run is exported. The object itself is still in the
            # bucket, so retry it as a key.
            if exc.code in (400, 401, 403, 404) and self.bucket:
                key = key_from_url(url, self.bucket)
                ok, note = self._s3_get(self.bucket, key, destination)
                if ok:
                    return True, f"stored URL returned HTTP {exc.code}; pulled from the bucket instead"
                return False, f"HTTP {exc.code} on the stored URL, and {note}"
            return False, f"HTTP {exc.code} on the stored URL"
        except Exception as exc:
            return False, f"download failed: {exc}"

    def _s3_get(self, bucket, key, destination) -> tuple[bool, str]:
        client = self.s3()
        if client is None:
            return False, self.s3_error or "no S3 client"
        if not bucket:
            return False, "no bucket configured (pass --s3-bucket)"
        try:
            client.download_file(bucket, key, destination)
            return True, ""
        except Exception as exc:
            return False, f"s3://{bucket}/{key} failed: {exc}"

    def _local(self, path, destination) -> tuple[bool, str]:
        candidates = [path] if path.startswith("/") else []
        base = path.lstrip("/")
        candidates += [os.path.join(directory, base) for directory in self.search_dirs]
        candidates += [os.path.join(directory, os.path.basename(base)) for directory in self.search_dirs]
        for candidate in candidates:
            if os.path.isfile(candidate):
                shutil.copy2(candidate, destination)
                return True, ""
        return False, f"not on this container: {path}"


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------

def normalize_argv(argv):
    """Let --tz take a negative offset.

    ``--tz -04:00`` is otherwise read by argparse as a missing value followed by
    an unknown flag, and US Eastern is the offset this gets run with most.
    """
    out = []
    skip = False
    for index, item in enumerate(argv):
        if skip:
            skip = False
            continue
        if item == "--tz" and index + 1 < len(argv) and argv[index + 1].startswith("-"):
            out.append(f"--tz={argv[index + 1]}")
            skip = True
        else:
            out.append(item)
    return out


def build_parser():
    parser = argparse.ArgumentParser(
        description="Export Dograh AI voice recordings for a date window."
    )
    parser.add_argument("--from", dest="from_day", required=True, help="first day, inclusive")
    parser.add_argument("--to", dest="to_day", required=True, help="last day, inclusive")
    parser.add_argument("--tz", default="utc", help="how to read those dates: utc (default), an offset like -04:00, or America/New_York")
    parser.add_argument("--out", default="/tmp/dograh-rec/out", help="output directory")
    parser.add_argument("--manifest-only", action="store_true", help="list the calls, download nothing")
    parser.add_argument("--limit", type=int, default=0, help="stop after N runs (a sample)")
    parser.add_argument("--table", help="force the source table instead of discovering it")
    parser.add_argument("--s3-bucket", default="", help="override the recordings bucket")
    parser.add_argument("--s3-endpoint", default="", help="override the S3/MinIO endpoint")
    parser.add_argument(
        "--recordings-dir",
        action="append",
        default=[],
        help="extra directory to look in for on-disk recordings (repeatable)",
    )
    parser.add_argument("--database-url", default="", help="override DATABASE_URL")
    return parser


def first_env(names):
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return ""


async def run(args) -> int:
    tz = resolve_zone(args.tz)
    start, end = window_bounds(parse_day(args.from_day), parse_day(args.to_day), tz)

    dsn = args.database_url or os.environ.get("DATABASE_URL", "")
    if not dsn:
        print("DATABASE_URL is not set. Run this inside the dograh api container, "
              "or pass --database-url.", file=sys.stderr)
        return 1
    dsn = dsn.replace("postgresql+asyncpg://", "postgresql://").replace("postgres+asyncpg://", "postgresql://")

    import asyncpg

    conn = await asyncpg.connect(dsn=dsn)
    try:
        tables = await load_schema(conn)
        if args.table:
            if args.table not in tables:
                print(f"No table '{args.table}' in this database.", file=sys.stderr)
                return 1
            table = args.table
            time_column = pick_time_column(tables[table])
            tried = [(table, time_column, "forced with --table")]
        else:
            table, time_column, tried = await choose_source(conn, tables, start, end)

        print("=============================================")
        print("Dograh recording export")
        print("=============================================")
        print(f"window   {args.from_day} through {args.to_day} inclusive ({args.tz})")
        print(f"         {start.isoformat()} .. {end.isoformat()} UTC")
        for name, column, note in tried:
            print(f"looked at {name}.{column}: {note}")

        if not table:
            print()
            print("No Dograh call runs in that window.")
            fallback = rank_tables(tables)
            if fallback:
                busiest = fallback[0]
                column = pick_time_column(tables[busiest])
                row, recent = await window_context(conn, busiest, column)
                print(f"\n{busiest} holds {row['total']} runs in total"
                      + (f", from {row['first']} to {row['last']} (UTC)." if row["first"] else "."))
                if recent:
                    print("most recent days with runs:")
                    for day in recent:
                        print(f"  {day['day'].date()}  {day['runs']}")
                print("\nIf those dates straddle the window, it is a timezone edge:")
                print("re-run with --tz -04:00 for US Eastern.")
            else:
                print("This database has no table carrying both a timestamp and a "
                      "recording reference — check that this is the Dograh database.")
            return 2

        columns = tables[table]
        rec_columns = recording_columns(columns)
        names = await workflow_names(conn, tables)

        rows = await conn.fetch(
            f'select * from public."{table}" where "{time_column}" >= $1 and "{time_column}" < $2 '
            f'order by "{time_column}"',
            start,
            end,
        )
        if args.limit:
            rows = rows[: args.limit]

        out_dir = os.path.abspath(args.out)
        audio_dir = os.path.join(out_dir, "audio")
        os.makedirs(audio_dir, exist_ok=True)

        fetcher = Fetcher(
            bucket=args.s3_bucket or first_env(S3_BUCKET_ENV),
            endpoint=args.s3_endpoint or first_env(S3_ENDPOINT_ENV),
            search_dirs=args.recordings_dir + ["/app/recordings", "/recordings", "/data/recordings", "/app"],
        )

        manifest_path = os.path.join(out_dir, "manifest.csv")
        header = [
            "run_id", "started_at_utc", f"started_at_local ({args.tz})", "workflow", "to_number",
            "from_number", "duration_seconds", "disposition", "recording_source",
            "recording_location", "audio_file", "status", "note",
        ]
        extra = [c for c in columns if not MANIFEST_SKIP_RE.search(c)]

        downloaded = failed = missing = 0
        print(f"\n{len(rows)} runs in the window. Writing to {out_dir}\n")

        with open(manifest_path, "w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(header + [f"raw.{c}" for c in extra])
            for row in rows:
                data = dict(row)
                run_id = data.get("id") or data.get("uuid") or data.get("run_id") or ""
                started = data.get(time_column)
                source, kind, location = find_recording(data, rec_columns)
                to_number = field(data, TO_NUMBER_KEYS)
                from_number = field(data, FROM_NUMBER_KEYS)
                workflow = names.get(data.get("workflow_id"), data.get("workflow_id") or "")

                audio_name = status = note = ""
                if not kind:
                    missing += 1
                    status, note = "no-recording", "no recording reference on this run"
                elif args.manifest_only:
                    status = "listed"
                else:
                    audio_name = audio_filename(started, run_id, to_number or from_number, location)
                    ok, note = fetcher.get(kind, location, os.path.join(audio_dir, audio_name))
                    if ok:
                        downloaded += 1
                        status = "downloaded"
                    else:
                        failed += 1
                        status = "failed"
                        audio_name = ""

                writer.writerow(
                    [
                        run_id,
                        started.isoformat() if isinstance(started, datetime) else started,
                        started.astimezone(tz).isoformat() if isinstance(started, datetime) else "",
                        workflow,
                        to_number or "",
                        from_number or "",
                        duration_of(data) or "",
                        field(data, DISPOSITION_KEYS) or "",
                        source or "",
                        location,
                        audio_name,
                        status,
                        note,
                    ]
                    + [jsonable(data.get(c)) for c in extra]
                )

        print(f"manifest      {manifest_path}  ({len(rows)} runs)")
        if args.manifest_only:
            print("audio         skipped (--manifest-only)")
            return 0
        print(f"downloaded    {downloaded}")
        if missing:
            print(f"no recording  {missing}  (the run has no recording reference — "
                  "recording off, or the call never connected)")
        if failed:
            print(f"failed        {failed}  (see the note column in the manifest)")
        print(f"audio         {audio_dir}")
        if downloaded == 0 and rows:
            print("\nNothing downloaded. Every row's note column says why; the usual "
                  "cause is the bucket not being reachable from this container "
                  "(pass --s3-bucket / --s3-endpoint).")
            return 1
        return 1 if failed else 0
    finally:
        await conn.close()


def main() -> int:
    return asyncio.run(run(build_parser().parse_args(normalize_argv(sys.argv[1:]))))


if __name__ == "__main__":
    sys.exit(main())
