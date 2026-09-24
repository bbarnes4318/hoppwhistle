#!/usr/bin/env python3
"""Give Dograh's Asterisk a Twilio Elastic SIP Trunk for outbound AI calls.

Dograh places AI calls through ARI on `dograh-asterisk`, which dials
``PJSIP/<number>@fractel`` today. This adds a second PJSIP trunk, ``twilio``,
pointed at a Twilio Elastic SIP Trunking termination URI (for example
``pvn.pstn.twilio.com``). A Dograh telephony configuration then sends calls to
Twilio by dialling ``PJSIP/{number}@twilio`` instead. Everything else stays as
it is: the campaigns, the state-matched caller-ID pool and the transfers.

Twilio authenticates a trunk by source IP (the trunk's IP Access Control List
must contain this host's public IP) and/or by a credential list. For the
second, put ``username:password`` on one line in a root-only file and pass
``--auth-file``; the password is never typed on a command line or printed.

The block is written between markers into the host file mounted at
``/etc/asterisk/pjsip.conf``, in place, and only ``module reload
res_pjsip.so`` is run, which leaves calls in progress alone.

Usage (on the host, as root):

    python3 install_twilio_trunk.py --termination pvn.pstn.twilio.com            # dry run
    python3 install_twilio_trunk.py --termination pvn.pstn.twilio.com --apply
    python3 install_twilio_trunk.py --termination pvn.pstn.twilio.com \\
        --auth-file /root/twilio-sip.cred --apply
    python3 install_twilio_trunk.py --status
    python3 install_twilio_trunk.py --rollback --apply
    python3 install_twilio_trunk.py --test-call +15551234567 --caller-id +18652757300
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import List, Optional, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "direct-transfer"))

from install_direct_transfer import asterisk, host_path_for, run, write_in_place  # noqa: E402

MARK_BEGIN = "; >>> HOPWHISTLE TWILIO TRUNK (managed by install_twilio_trunk.py) >>>"
MARK_END = "; <<< HOPWHISTLE TWILIO TRUNK <<<"
ENDPOINT = "twilio"
DEFAULT_CONTAINER = "dograh-asterisk"
DIAL_TEMPLATE = "PJSIP/{number}@" + ENDPOINT

_HOST_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$")


def valid_termination(host: str) -> bool:
    """A Twilio termination URI is a bare hostname such as pvn.pstn.twilio.com."""
    return bool(_HOST_RE.match(host.lower())) and host.lower().endswith(".pstn.twilio.com")


def read_credentials(text: str) -> Tuple[str, str]:
    """``username:password`` on the first non-empty line."""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        user, sep, password = line.partition(":")
        if not sep or not user or not password:
            break
        if any(ch in user + password for ch in "\r\n;"):
            raise ValueError("credentials may not contain ';' or line breaks")
        return user, password
    raise ValueError("expected 'username:password' on the first line")


def pjsip_block(termination: str, credentials: Optional[Tuple[str, str]]) -> str:
    lines = [
        MARK_BEGIN,
        "; Outbound AI calls to Twilio Elastic SIP Trunking. See",
        "; deploy/dograh/twilio-trunk/README.md.",
        f"[{ENDPOINT}]",
        "type=aor",
        f"contact=sip:{termination}",
        "qualify_frequency=60",
        "",
        f"[{ENDPOINT}]",
        "type=endpoint",
        f"aors={ENDPOINT}",
        "context=twilio-no-inbound",
        "disallow=all",
        "allow=ulaw",
        "direct_media=no",
        "rtp_symmetric=yes",
        "force_rport=yes",
        "rewrite_contact=yes",
        "dtmf_mode=rfc4733",
        f"from_domain={termination}",
        # The campaign's caller ID goes out in From and P-Asserted-Identity.
        "send_pai=yes",
        "trust_id_outbound=yes",
    ]
    if credentials:
        lines.append(f"outbound_auth={ENDPOINT}-auth")
        user, password = credentials
        lines += [
            "",
            f"[{ENDPOINT}-auth]",
            "type=auth",
            "auth_type=userpass",
            f"username={user}",
            f"password={password}",
        ]
    lines.append(MARK_END)
    return "\n".join(lines) + "\n"


def extensions_block() -> str:
    """Test-call context: ``<to>*<caller id>`` dials the trunk with that caller ID."""
    return "\n".join(
        [
            MARK_BEGIN,
            "[twilio-test]",
            "exten => _+X.,1,Set(HW_TO=${CUT(EXTEN,*,1)})",
            " same => n,Set(CALLERID(num)=${CUT(EXTEN,*,2)})",
            " same => n,Dial(PJSIP/${HW_TO}@" + ENDPOINT + ",60)",
            " same => n,Hangup()",
            "",
            "[twilio-no-inbound]",
            "exten => _X.,1,Hangup(21)",
            "exten => _+X.,1,Hangup(21)",
            "exten => s,1,Hangup(21)",
            MARK_END,
        ]
    ) + "\n"


def replace_block(text: str, block: Optional[str]) -> str:
    pattern = re.compile(r"\n?" + re.escape(MARK_BEGIN) + r".*?" + re.escape(MARK_END) + r"\n?", re.S)
    stripped = pattern.sub("", text)
    if block is None:
        return stripped
    if stripped and not stripped.endswith("\n"):
        stripped += "\n"
    return stripped + ("\n" if stripped else "") + block


def redact(block: str) -> str:
    return re.sub(r"^password=.*$", "password=(from --auth-file)", block, flags=re.M)


def status(container: str) -> bool:
    endpoint = asterisk(container, f"pjsip show endpoint {ENDPOINT}")
    aor = asterisk(container, f"pjsip show aor {ENDPOINT}")
    print(re.sub(r"(?im)^(\s*password\s*:).*$", r"\1 (hidden)", endpoint.strip()))
    print(aor.strip())
    if not re.search(rf"Endpoint:\s+{ENDPOINT}\b", endpoint):
        print(f"\nNOT OK: endpoint {ENDPOINT} is not loaded.")
        return False
    if re.search(r"Contact:\s+\S+\s+\S+\s+(Avail|Reachable)", aor):
        print("\nTwilio answers OPTIONS on the trunk: reachable.")
    else:
        print("\nThe contact is not showing Avail yet (qualify runs every 60s). A test call is the real check.")
    return True


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--termination", help="Twilio termination URI host, e.g. pvn.pstn.twilio.com")
    parser.add_argument("--auth-file", help="root-only file holding username:password (credential list)")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--test-call", metavar="E164", help="place one call to this number via the trunk")
    parser.add_argument("--caller-id", metavar="E164", help="caller ID for --test-call")
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    args = parser.parse_args(argv)

    running = run(["docker", "inspect", "-f", "{{.State.Running}}", args.container], check=False)
    if running.strip() != "true":
        print(f"REFUSED: container {args.container} is not running.")
        return 1

    if args.status:
        return 0 if status(args.container) else 1

    if args.test_call:
        number = re.sub(r"[^\d+]", "", args.test_call)
        cid = re.sub(r"[^\d+]", "", args.caller_id or "")
        if not re.fullmatch(r"\+\d{10,15}", number) or (cid and not re.fullmatch(r"\+\d{10,15}", cid)):
            print("REFUSED: use E.164 numbers, e.g. +15551234567.")
            return 1
        if not cid:
            print("REFUSED: --caller-id is required; Twilio rejects a call without a valid caller ID.")
            return 1
        print(asterisk(args.container,
                       f"channel originate Local/{number}*{cid}@twilio-test/n application Playback tt-monkeys").strip()
              or "originate sent")
        print("Your phone should ring and play a short recording. If it does not, check:\n"
              f"  docker logs --since 2m {args.container} 2>&1 | grep -iE 'twilio|40[0-9]|50[0-9]'")
        return 0

    mounts = json.loads(run(["docker", "inspect", "-f", "{{json .Mounts}}", args.container]))
    targets = {}
    for name in ("pjsip.conf", "extensions.conf"):
        host_path = host_path_for(mounts, f"/etc/asterisk/{name}")
        if not host_path or not os.path.isfile(host_path):
            print(f"REFUSED: /etc/asterisk/{name} is not a file on this host; a change would not survive a restart.")
            return 1
        targets[name] = host_path

    blocks = {"pjsip.conf": None, "extensions.conf": None}
    if not args.rollback:
        if not args.termination or not valid_termination(args.termination):
            print("REFUSED: --termination must be your Twilio termination URI, e.g. pvn.pstn.twilio.com")
            return 1
        credentials = None
        if args.auth_file:
            with open(args.auth_file, encoding="utf-8") as handle:
                credentials = read_credentials(handle.read())
        blocks = {
            "pjsip.conf": pjsip_block(args.termination.lower(), credentials),
            "extensions.conf": extensions_block(),
        }

    changes = {}
    for name, host_path in targets.items():
        with open(host_path, encoding="utf-8") as handle:
            current = handle.read()
        updated = replace_block(current, blocks[name])
        print(f"{name}: {host_path} ({'unchanged' if updated == current else 'would change'})")
        if updated != current:
            changes[name] = (host_path, current, updated)

    if not args.apply:
        print("\nDry run. Blocks that --apply would write:\n")
        for name in targets:
            print(f"-- {name}\n" + (redact(blocks[name]) if blocks[name] else "(removed)"))
        print("Nothing changed. Re-run with --apply.")
        return 0

    for name, (host_path, current, updated) in changes.items():
        backup = host_path + ".bak-hopwhistle-twilio"
        if not os.path.exists(backup):
            with open(backup, "w", encoding="utf-8") as handle:
                handle.write(current)
            os.chmod(backup, 0o600)
        write_in_place(host_path, updated)
        print(f"Wrote {host_path}")
    print(asterisk(args.container, "module reload res_pjsip.so").strip())
    print(asterisk(args.container, "dialplan reload").strip())

    if args.rollback:
        print("Rolled back. Point Dograh's dial template back at @fractel.")
        return 0
    print()
    ok = status(args.container)
    print(f"\nDograh dial template for Twilio:\n    {DIAL_TEMPLATE}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
