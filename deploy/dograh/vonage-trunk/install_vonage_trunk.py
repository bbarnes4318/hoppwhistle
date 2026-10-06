#!/usr/bin/env python3
"""Give Dograh's Asterisk a Vonage SIP trunk for outbound AI calls.

Dograh places AI calls through ARI on `dograh-asterisk`, which dials
``PJSIP/<number>@fractel`` unless the ARI trunk patch (deploy/dograh/ari-trunk)
says otherwise. This adds a PJSIP trunk, ``vonage``, pointed at the same Vonage
SIP endpoint Hopwhistle's FreeSWITCH ``vonage`` gateway terminates to. With
``DOGRAH_ARI_TRUNK=vonage`` and ``DOGRAH_ARI_DIAL_FORMAT=nanp11`` Dograh dials
``PJSIP/1XXXXXXXXXX@vonage``. Vonage refuses a ``+`` in the dialled number.

The SIP server and credentials are read from the FreeSWITCH container's
environment (VONAGE_SIP_PROXY / _REALM / _USERNAME / _PASSWORD, written by
scripts/vonage-setup.ps1), so both trunks match. With no username and password
the trunk relies on this host's IP being authorised in the Vonage dashboard.
``--proxy`` overrides the server. The password is never printed.

The block is written between markers into the host files mounted at
``/etc/asterisk/pjsip.conf`` and ``extensions.conf``, in place, and only
``module reload res_pjsip.so`` and ``dialplan reload`` are run, which leave
calls in progress alone.

Usage (on the host, as root):

    python3 install_vonage_trunk.py                        # dry run
    python3 install_vonage_trunk.py --apply
    python3 install_vonage_trunk.py --status
    python3 install_vonage_trunk.py --test-call 5551234567 --caller-id 8655550100
    python3 install_vonage_trunk.py --rollback --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from typing import Dict, List, Optional, Tuple

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "direct-transfer"))

from install_direct_transfer import asterisk, host_path_for, run, write_in_place  # noqa: E402

MARK_BEGIN = "; >>> HOPWHISTLE VONAGE TRUNK (managed by install_vonage_trunk.py) >>>"
MARK_END = "; <<< HOPWHISTLE VONAGE TRUNK <<<"
ENDPOINT = "vonage"
DEFAULT_CONTAINER = "dograh-asterisk"
DEFAULT_FS_CONTAINER = "hopwhistle-freeswitch-dev"
DEFAULT_PROXY = "sip.nexmo.com"

_HOST_RE = re.compile(
    r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$"
)


def valid_host(host: str) -> bool:
    """A bare hostname or IPv4, optionally with :port. No scheme, no params."""
    return bool(_HOST_RE.match(host.lower()))


def fs_vonage_settings(fs_container: str) -> Dict[str, str]:
    """VONAGE_SIP_* from the FreeSWITCH container, so both trunks match."""
    out = run(["docker", "exec", fs_container, "printenv"], check=False)
    env = {}
    for line in out.splitlines():
        key, sep, value = line.partition("=")
        if sep and key.startswith("VONAGE_SIP_"):
            env[key] = value.strip()
    return env


def credentials_from(env: Dict[str, str]) -> Optional[Tuple[str, str]]:
    """Both or neither, like FreeSWITCH's vonage-gateway.sh."""
    user, password = env.get("VONAGE_SIP_USERNAME", ""), env.get("VONAGE_SIP_PASSWORD", "")
    if bool(user) != bool(password):
        raise ValueError("set both VONAGE_SIP_USERNAME and VONAGE_SIP_PASSWORD, or neither")
    if not user:
        return None
    if any(ch in user + password for ch in "\r\n;"):
        raise ValueError("Vonage credentials may not contain ';' or line breaks")
    return user, password


def pjsip_block(proxy: str, realm: Optional[str], credentials: Optional[Tuple[str, str]]) -> str:
    lines = [
        MARK_BEGIN,
        "; Outbound AI calls to Vonage. See deploy/dograh/vonage-trunk/README.md.",
        f"[{ENDPOINT}]",
        "type=aor",
        f"contact=sip:{proxy}",
        "qualify_frequency=60",
        "",
        f"[{ENDPOINT}]",
        "type=endpoint",
        f"aors={ENDPOINT}",
        "context=vonage-no-inbound",
        "disallow=all",
        "allow=ulaw",
        "direct_media=no",
        "rtp_symmetric=yes",
        "force_rport=yes",
        "rewrite_contact=yes",
        "dtmf_mode=rfc4733",
        f"from_domain={realm or proxy.split(':')[0]}",
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
        if realm:
            lines.append(f"realm={realm}")
    lines.append(MARK_END)
    return "\n".join(lines) + "\n"


def extensions_block() -> str:
    """Test-call context: ``<10 digits>*<caller id>`` dials Vonage as 1XXXXXXXXXX."""
    return "\n".join(
        [
            MARK_BEGIN,
            "[vonage-test]",
            "exten => _X.,1,Set(HW_TO=${CUT(EXTEN,*,1)})",
            " same => n,Set(CALLERID(num)=${CUT(EXTEN,*,2)})",
            " same => n,Dial(PJSIP/1${HW_TO}@" + ENDPOINT + ",60)",
            " same => n,Hangup()",
            "",
            "[vonage-no-inbound]",
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
    return re.sub(r"^password=.*$", "password=(from FreeSWITCH VONAGE_SIP_PASSWORD)", block, flags=re.M)


def ten_digits(number: str) -> Optional[str]:
    digits = re.sub(r"\D", "", number)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def status(container: str) -> bool:
    endpoint = asterisk(container, f"pjsip show endpoint {ENDPOINT}")
    aor = asterisk(container, f"pjsip show aor {ENDPOINT}")
    print(re.sub(r"(?im)^(\s*password\s*:).*$", r"\1 (hidden)", endpoint.strip()))
    print(aor.strip())
    if not re.search(rf"Endpoint:\s+{ENDPOINT}\b", endpoint):
        print(f"\nNOT OK: endpoint {ENDPOINT} is not loaded.")
        return False
    if re.search(r"Contact:\s+\S+\s+\S+\s+(Avail|Reachable)", aor):
        print("\nVonage answers OPTIONS on the trunk: reachable.")
    else:
        print("\nThe contact is not showing Avail yet (qualify runs every 60s). A test call is the real check.")
    return True


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--proxy", help=f"Vonage SIP server (default: FreeSWITCH's VONAGE_SIP_PROXY, else {DEFAULT_PROXY})")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--test-call", metavar="NUMBER", help="place one call to this US number via the trunk")
    parser.add_argument("--caller-id", metavar="NUMBER", help="caller ID for --test-call (a number on your Vonage account)")
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--fs-container", default=DEFAULT_FS_CONTAINER)
    args = parser.parse_args(argv)

    running = run(["docker", "inspect", "-f", "{{.State.Running}}", args.container], check=False)
    if running.strip() != "true":
        print(f"REFUSED: container {args.container} is not running.")
        return 1

    if args.status:
        return 0 if status(args.container) else 1

    if args.test_call:
        to = ten_digits(args.test_call)
        cid = ten_digits(args.caller_id or "")
        if not to or not cid:
            print("REFUSED: --test-call and --caller-id must be 10-digit US numbers. "
                  "Vonage rejects a caller ID that is not on your account.")
            return 1
        print(asterisk(args.container,
                       f"channel originate Local/{to}*1{cid}@vonage-test/n application Playback tt-monkeys").strip()
              or "originate sent")
        print("Your phone should ring and play a short recording. If it does not, check:\n"
              f"  docker logs --since 2m {args.container} 2>&1 | grep -iE 'vonage|40[0-9]|50[0-9]'")
        return 0

    mounts = json.loads(run(["docker", "inspect", "-f", "{{json .Mounts}}", args.container]))
    targets = {}
    for name in ("pjsip.conf", "extensions.conf"):
        host_path = host_path_for(mounts, f"/etc/asterisk/{name}")
        if not host_path or not os.path.isfile(host_path):
            print(f"REFUSED: /etc/asterisk/{name} is not a file on this host; a change would not survive a restart.")
            return 1
        targets[name] = host_path

    blocks: Dict[str, Optional[str]] = {"pjsip.conf": None, "extensions.conf": None}
    if not args.rollback:
        env = fs_vonage_settings(args.fs_container)
        proxy = (args.proxy or env.get("VONAGE_SIP_PROXY", "") or DEFAULT_PROXY).strip().lower()
        proxy = re.sub(r"^sips?:", "", proxy)
        if not valid_host(proxy):
            print(f"REFUSED: {proxy!r} is not a SIP host[:port]; pass --proxy, e.g. --proxy {DEFAULT_PROXY}.")
            return 1
        realm = env.get("VONAGE_SIP_REALM", "").strip().lower() or None
        if realm and not valid_host(realm):
            print(f"REFUSED: FreeSWITCH's VONAGE_SIP_REALM {realm!r} is not a host.")
            return 1
        try:
            credentials = credentials_from(env)
        except ValueError as exc:
            print(f"REFUSED: {exc} (in the FreeSWITCH container's environment).")
            return 1
        print(f"Vonage SIP server: {proxy}  realm: {realm or '(none)'}  "
              f"auth: {'username/password' if credentials else 'source IP only'}")
        blocks = {
            "pjsip.conf": pjsip_block(proxy, realm, credentials),
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
        backup = host_path + ".bak-hopwhistle-vonage"
        if not os.path.exists(backup):
            with open(backup, "w", encoding="utf-8") as handle:
                handle.write(current)
            os.chmod(backup, 0o600)
        write_in_place(host_path, updated)
        print(f"Wrote {host_path}")
    print(asterisk(args.container, "module reload res_pjsip.so").strip())
    print(asterisk(args.container, "dialplan reload").strip())

    if args.rollback:
        print("Rolled back. Set DOGRAH_ARI_TRUNK back to fractel and remove DOGRAH_ARI_DIAL_FORMAT.")
        return 0
    print()
    return 0 if status(args.container) else 1


if __name__ == "__main__":
    sys.exit(main())
