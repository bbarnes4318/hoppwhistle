#!/usr/bin/env python3
"""Verify our own DIDs as Twilio caller IDs, so the trunk accepts them.

Twilio refuses a call on the Elastic SIP Trunk (403, X-Twilio-Error 32204)
unless its caller ID is a Twilio number or a Verified Caller ID on the account.
Verifying is free: Twilio calls the number and waits for a six-digit code.

These DIDs ring into FreeSWITCH, so this script does both halves:

  1. asks Twilio to verify a number (POST .../OutgoingCallerIds.json) and gets
     the code back;
  2. stores it with ``hash insert/twverify/<10 digits>/<code>`` in FreeSWITCH.
     inbound_route.lua answers Twilio's call on that DID, keys in the code and
     clears it. Every other call on the DID routes as it always has.

Then it asks Twilio whether the number is now verified, and records the result.

Credentials: ``AccountSid:AuthToken`` on one line of a root-only file. Nothing
is printed but the account SID.

    # which numbers, and which are already verified (changes nothing)
    python3 verify_caller_ids.py --auth-file /root/twilio-api.cred --from-dograh
    # verify ONE number first and check it worked
    python3 verify_caller_ids.py --auth-file /root/twilio-api.cred --from-dograh --apply --limit 1
    # then the rest, a few at a time; safe to stop and re-run
    python3 verify_caller_ids.py --auth-file /root/twilio-api.cred --from-dograh --apply --limit 5000 --concurrency 4
"""

from __future__ import annotations

import argparse
import base64
import json
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Callable, Dict, Iterable, List, Optional, Set, Tuple

API = "https://api.twilio.com/2010-04-01"
DEFAULT_FS = "hopwhistle-freeswitch-dev"
DEFAULT_DOGRAH_DB = "dograh-postgres-1"
CALL_DELAY = 10  # seconds between Twilio's answer to us and its call, for the hash insert
WAIT_FOR_RESULT = 120


def read_credentials(text: str) -> Tuple[str, str]:
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        sid, sep, token = line.partition(":")
        if sep and re.fullmatch(r"AC[0-9a-fA-F]{32}", sid) and token:
            return sid, token
        break
    raise ValueError("expected 'ACxxxxxxxx:auth_token' on the first line")


def to_e164(raw: str) -> Optional[str]:
    digits = re.sub(r"\D", "", raw or "")
    if len(digits) == 10:
        digits = "1" + digits
    if len(digits) == 11 and digits.startswith("1"):
        return "+" + digits
    return None


def unique_numbers(raw: Iterable[str]) -> List[str]:
    seen, out = set(), []
    for item in raw:
        e164 = to_e164(item)
        if e164 and e164 not in seen:
            seen.add(e164)
            out.append(e164)
    return out


class Twilio:
    def __init__(self, sid: str, token: str, opener: Callable = urllib.request.urlopen):
        self.sid = sid
        self._auth = "Basic " + base64.b64encode(f"{sid}:{token}".encode()).decode()
        self._open = opener

    def _request(self, path: str, data: Optional[Dict[str, str]] = None) -> dict:
        url = path if path.startswith("https://") else f"{API}/Accounts/{self.sid}/{path}"
        body = urllib.parse.urlencode(data).encode() if data is not None else None
        req = urllib.request.Request(url, data=body, headers={"Authorization": self._auth})
        try:
            with self._open(req, timeout=30) as resp:
                return json.loads(resp.read().decode() or "{}")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode(errors="replace")
            try:
                parsed = json.loads(detail)
                detail = f"{parsed.get('code')}: {parsed.get('message')}"
            except ValueError:
                pass
            raise RuntimeError(f"Twilio HTTP {exc.code} {detail}") from None

    def verified(self) -> Set[str]:
        out: Set[str] = set()
        page: Optional[str] = "OutgoingCallerIds.json?PageSize=1000"
        while page:
            data = self._request(page)
            out.update(c["phone_number"] for c in data.get("outgoing_caller_ids", []))
            nxt = data.get("next_page_uri")
            page = f"https://api.twilio.com{nxt}" if nxt else None
        return out

    def is_verified(self, e164: str) -> bool:
        data = self._request("OutgoingCallerIds.json?" + urllib.parse.urlencode({"PhoneNumber": e164}))
        return any(c.get("phone_number") == e164 for c in data.get("outgoing_caller_ids", []))

    def request_validation(self, e164: str) -> str:
        data = self._request(
            "OutgoingCallerIds.json",
            {"PhoneNumber": e164, "FriendlyName": f"Dograh CID {e164}", "CallDelay": str(CALL_DELAY)},
        )
        code = str(data.get("validation_code") or "")
        if not re.fullmatch(r"\d+", code):
            raise RuntimeError(f"Twilio returned no validation code: {data}")
        return code


def fs_cli(container: str, command: str) -> str:
    return subprocess.run(
        ["docker", "exec", container, "fs_cli", "-x", command],
        capture_output=True, text=True, check=True,
    ).stdout.strip()


def dograh_numbers(container: str, config_id: int) -> List[str]:
    sql = (
        "select address_normalized from telephony_phone_numbers "
        f"where telephony_configuration_id = {int(config_id)} and is_active order by 1"
    )
    out = subprocess.run(
        ["docker", "exec", container, "sh", "-lc", f'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "{sql}"'],
        capture_output=True, text=True, check=True,
    ).stdout
    return out.splitlines()


def verify_one(
    twilio: Twilio,
    e164: str,
    store: Callable[[str, str], None],
    clear: Callable[[str], None],
    sleep: Callable[[float], None] = time.sleep,
    wait: int = WAIT_FOR_RESULT,
) -> Tuple[str, str]:
    """Returns (number, 'verified' | 'failed: why')."""
    key = re.sub(r"\D", "", e164)[-10:]
    try:
        code = twilio.request_validation(e164)
    except RuntimeError as exc:
        # 21450: already verified on this account.
        if "21450" in str(exc):
            return e164, "verified"
        return e164, f"failed: {exc}"
    store(key, code)
    try:
        waited = 0
        while waited < wait:
            sleep(5)
            waited += 5
            if twilio.is_verified(e164):
                return e164, "verified"
        return e164, "failed: Twilio did not mark it verified (did the call reach FreeSWITCH?)"
    finally:
        clear(key)


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--auth-file", required=True, help="file holding AccountSid:AuthToken")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--from-dograh", action="store_true", help="Dograh's active caller-ID pool")
    source.add_argument("--numbers-file", help="one number per line")
    parser.add_argument("--dograh-config", type=int, default=1, help="telephony_configuration_id (default 1)")
    parser.add_argument("--dograh-db", default=DEFAULT_DOGRAH_DB)
    parser.add_argument("--fs-container", default=DEFAULT_FS)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--limit", type=int, default=1, help="numbers to verify this run (default 1)")
    parser.add_argument("--concurrency", type=int, default=1)
    args = parser.parse_args(argv)

    with open(args.auth_file, encoding="utf-8") as handle:
        sid, token = read_credentials(handle.read())
    twilio = Twilio(sid, token)

    if args.from_dograh:
        raw = dograh_numbers(args.dograh_db, args.dograh_config)
    else:
        with open(args.numbers_file, encoding="utf-8") as handle:
            raw = handle.read().splitlines()
    numbers = unique_numbers(raw)
    done = twilio.verified()
    todo = [n for n in numbers if n not in done]
    print(f"Account {sid}: {len(numbers)} numbers, {len(numbers) - len(todo)} already verified, {len(todo)} to go.")

    if not args.apply:
        print("Dry run. Next up:", ", ".join(todo[:5]) or "(nothing)")
        print("Re-run with --apply --limit 1 to verify one and check it worked.")
        return 0

    batch = todo[: max(0, args.limit)]
    lock = threading.Lock()
    results = {"verified": 0, "failed": 0}

    def store(key: str, code: str) -> None:
        fs_cli(args.fs_container, f"hash insert/twverify/{key}/{code}")

    def clear(key: str) -> None:
        fs_cli(args.fs_container, f"hash delete/twverify/{key}")

    def run(e164: str) -> None:
        number, outcome = verify_one(twilio, e164, store, clear)
        with lock:
            results["verified" if outcome == "verified" else "failed"] += 1
            print(f"{number}: {outcome}", flush=True)

    with ThreadPoolExecutor(max_workers=max(1, args.concurrency)) as pool:
        list(pool.map(run, batch))

    print(f"\nThis run: {results['verified']} verified, {results['failed']} failed. "
          f"{len(todo) - len(batch)} not attempted yet.")
    return 0 if results["failed"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
