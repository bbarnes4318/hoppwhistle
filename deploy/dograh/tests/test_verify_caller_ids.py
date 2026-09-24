"""Tests for the Twilio caller-ID verifier, against a fake Twilio.

Run:  python deploy/dograh/tests/test_verify_caller_ids.py
"""

from __future__ import annotations

import io
import json
import os
import sys
import urllib.error
import urllib.parse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "twilio-trunk"))

from verify_caller_ids import Twilio, read_credentials, to_e164, unique_numbers, verify_one  # noqa: E402

SID = "AC" + "0" * 32


class FakeTwilio:
    """Just enough of the OutgoingCallerIds API. A number turns verified once
    the code Twilio issued for it has been stored (i.e. FreeSWITCH could answer)."""

    def __init__(self, verified=(), already=(), fail_with=None):
        self.verified = set(verified)
        self.already = set(already)
        self.fail_with = fail_with
        self.codes = {}
        self.posts = []

    def __call__(self, req, timeout=None):
        url = req.full_url
        assert req.headers["Authorization"].startswith("Basic ")
        if req.data is not None:
            form = dict(urllib.parse.parse_qsl(req.data.decode()))
            self.posts.append(form)
            number = form["PhoneNumber"]
            if self.fail_with or number in self.already:
                code, msg = self.fail_with or (21450, "Phone number already verified")
                raise urllib.error.HTTPError(url, 400, "Bad", {}, io.BytesIO(
                    json.dumps({"code": code, "message": msg}).encode()))
            self.codes[number] = "123456"
            return io.BytesIO(json.dumps({"validation_code": "123456", "phone_number": number}).encode())
        query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(url).query))
        rows = [{"phone_number": n} for n in sorted(self.verified)]
        if "PhoneNumber" in query:
            rows = [r for r in rows if r["phone_number"] == query["PhoneNumber"]]
        return io.BytesIO(json.dumps({"outgoing_caller_ids": rows, "next_page_uri": None}).encode())


def test_credentials():
    assert read_credentials(f"\n{SID}:tok\n") == (SID, "tok")
    for bad in ("", "user:pass", f"{SID}:"):
        try:
            read_credentials(bad)
        except ValueError:
            continue
        raise AssertionError(bad)


def test_numbers_normalised_and_deduplicated():
    assert to_e164("865-600-0288") == "+18656000288"
    assert to_e164("18656000288") == "+18656000288"
    assert to_e164("12345") is None
    assert unique_numbers(["8656000288", "+18656000288", "junk", "2125550100"]) == [
        "+18656000288", "+12125550100"]


def test_verified_when_freeswitch_answers():
    fake = FakeTwilio()
    stored, cleared = {}, []

    def store(key, code):
        stored[key] = code
        fake.verified.add("+1" + key)  # FreeSWITCH keyed the code in

    result = verify_one(Twilio(SID, "t", opener=fake), "+18656000288", store, cleared.append,
                        sleep=lambda s: None)
    assert result == ("+18656000288", "verified")
    assert stored == {"8656000288": "123456"}
    assert cleared == ["8656000288"], "the code must be cleared afterwards"
    assert fake.posts[0]["CallDelay"] == "10"


def test_failure_is_reported_and_code_still_cleared():
    fake = FakeTwilio()
    cleared = []
    number, outcome = verify_one(Twilio(SID, "t", opener=fake), "+18656000288",
                                 lambda k, c: None, cleared.append, sleep=lambda s: None, wait=10)
    assert outcome.startswith("failed:")
    assert cleared == ["8656000288"]


def test_already_verified_counts_as_verified():
    fake = FakeTwilio(already={"+18656000288"})
    assert verify_one(Twilio(SID, "t", opener=fake), "+18656000288", lambda k, c: None,
                      lambda k: None, sleep=lambda s: None)[1] == "verified"


def test_api_error_is_named():
    fake = FakeTwilio(fail_with=(20003, "Authenticate"))
    outcome = verify_one(Twilio(SID, "t", opener=fake), "+18656000288", lambda k, c: None,
                         lambda k: None, sleep=lambda s: None)[1]
    assert "20003" in outcome and outcome.startswith("failed:")


def test_verified_list():
    fake = FakeTwilio(verified={"+18656000288"})
    assert Twilio(SID, "t", opener=fake).verified() == {"+18656000288"}


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
