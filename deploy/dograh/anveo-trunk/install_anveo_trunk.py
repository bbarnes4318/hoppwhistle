#!/usr/bin/env python3
"""Give Dograh's Asterisk an Anveo Direct trunk for outbound AI calls.

Dograh places AI calls through ARI on `dograh-asterisk`. This adds a PJSIP
trunk, ``anveo``, pointed at the same Anveo Direct SIP server Hopwhistle's
FreeSWITCH already terminates to. With the ARI trunk patch
(deploy/dograh/ari-trunk) set to ``DOGRAH_ARI_TRUNK=anveo`` and
``DOGRAH_ARI_DIAL_PREFIX=012345``, Dograh dials
``PJSIP/0123451XXXXXXXXXX@anveo``.

Anveo Direct picks the outbound trunk from the tech prefix in front of the
number; without it the call is refused as UNALLOCATED_NUMBER. It authenticates
by source IP (this host is already authorised, FreeSWITCH uses it) and, when
the FreeSWITCH gateway carries them, by username/password.

The SIP server and credentials are read from the FreeSWITCH container's
environment (ANVEO_SIP_PROXY / _REALM / _USERNAME / _PASSWORD), so they match
the gateway that works. ``--proxy`` overrides the server. The password is
never printed.

The block is written between markers into the host files mounted at
``/etc/asterisk/pjsip.conf`` and ``extensions.conf``, in place, and only
``module reload res_pjsip.so`` and ``dialplan reload`` are run, which leave
calls in progress alone.

Usage (on the host, as root):

    python3 install_anveo_trunk.py                        # dry run
    python3 install_anveo_trunk.py --apply
    python3 install_anveo_trunk.py --status
    python3 install_anveo_trunk.py --test-call +15551234567 --caller-id +18652809894
    python3 install_anveo_trunk.py --rollback --apply
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

MARK_BEGIN = "; >>> HOPWHISTLE ANVEO TRUNK (managed by install_anveo_trunk.py) >>>"
MARK_END = "; <<< HOPWHISTLE ANVEO TRUNK <<<"
ENDPOINT = "anveo"
DEFAULT_CONTAINER = "dograh-asterisk"
DEFAULT_FS_CONTAINER = "hopwhistle-freeswitch-dev"
DEFAULT_PREFIX = "012345"

_HOST_RE = re.compile(
    r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$"
)


def valid_host(host: str) -> bool:
    """A bare hostname or IPv4, optionally with :port. No scheme, no params."""
    return bool(_HOST_RE.match(host.lower()))


def valid_prefix(prefix: str) -> bool:
    return bool(re.fullmatch(r"\d{1,20}", prefix))


def fs_anveo_settings(fs_container: str) -> Dict[str, str]:
    """ANVEO_SIP_* from the FreeSWITCH container, so both trunks match."""
    out = run(["docker", "exec", fs_container, "printenv"], check=False)
    env = {}
    for line in out.splitlines():
        key, sep, value = line.partition("=")
        if sep and key.startswith("ANVEO_SIP_"):
            env[key] = value.strip()
    return env


def credentials_from(env: Dict[str, str]) -> Optional[Tuple[str, str]]:
    user, password = env.get("ANVEO_SIP_USERNAME", ""), env.get("ANVEO_SIP_PASSWORD", "")
    if not user or not password:
        return None
    if any(ch in user + password for ch in "\r\n;"):
        raise ValueError("Anveo credentials may not contain ';' or line breaks")
    return user, password


def pjsip_block(proxy: str, realm: Optional[str], credentials: Optional[Tuple[str, str]]) -> str:
    lines = [
        MARK_BEGIN,
        "; Outbound AI calls to Anveo Direct. See deploy/dograh/anveo-trunk/README.md.",
        f"[{ENDPOINT}]",
        "type=aor",
        f"contact=sip:{proxy}",
        "qualify_frequency=0",
        "",
        f"[{ENDPOINT}]",
        "type=endpoint",
        f"aors={ENDPOINT}",
        "context=anveo-no-inbound",
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


def extensions_block(prefix: str) -> str:
    """Test-call context: ``<10 digits>*<caller id>`` dials Anveo with the prefix."""
    return "\n".join(
        [
            MARK_BEGIN,
            "[anveo-test]",
            "exten => _X.,1,Set(HW_TO=${CUT(EXTEN,*,1)})",
            " same => n,Set(CALLERID(num)=${CUT(EXTEN,*,2)})",
            f" same => n,Dial(PJSIP/{prefix}1${{HW_TO}}@{ENDPOINT},60)",
            " same => n,Hangup()",
            "",
            "[anveo-no-inbound]",
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
    return re.sub(r"^password=.*$", "password=(from FreeSWITCH ANVEO_SIP_PASSWORD)", block, flags=re.M)


def ten_digits(number: str) -> Optional[str]:
    digits = re.sub(r"\D", "", number)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    return digits if len(digits) == 10 else None


def status(container: str) -> bool:
    endpoint = asterisk(container, f"pjsip show endpoint {ENDPOINT}")
    print(re.sub(r"(?im)^(\s*password\s*:).*$", r"\1 (hidden)", endpoint.strip()))
    if not re.search(rf"Endpoint:\s+{ENDPOINT}\b", endpoint):
        print(f"\nNOT OK: endpoint {ENDPOINT} is not loaded.")
        return False
    print("\nEndpoint loaded. A test call is the real check.")
    return True


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--proxy", help="Anveo SIP server (default: FreeSWITCH's ANVEO_SIP_PROXY)")
    parser.add_argument("--prefix", default=DEFAULT_PREFIX, help="Anveo tech prefix for test calls")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--rollback", action="store_true")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--test-call", metavar="NUMBER", help="place one call to this US number via the trunk")
    parser.add_argument("--caller-id", metavar="NUMBER", help="caller ID for --test-call (one of your Anveo DIDs)")
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--fs-container", default=DEFAULT_FS_CONTAINER)
    args = parser.parse_args(argv)

    if not valid_prefix(args.prefix):
        print("REFUSED: --prefix must be digits only.")
        return 1

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
            print("REFUSED: --test-call and --caller-id must be 10-digit US numbers.")
            return 1
        print(asterisk(args.container,
                       f"channel originate Local/{to}*+1{cid}@anveo-test/n application Playback tt-monkeys").strip()
              or "originate sent")
        print("Your phone should ring and play a short recording. If it does not, check:\n"
              f"  docker logs --since 2m {args.container} 2>&1 | grep -iE 'anveo|40[0-9]|50[0-9]'")
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
        env = fs_anveo_settings(args.fs_container)
        proxy = (args.proxy or env.get("ANVEO_SIP_PROXY", "")).strip().lower()
        proxy = re.sub(r"^sips?:", "", proxy)
        if not proxy or not valid_host(proxy):
            print("REFUSED: no usable Anveo SIP server. FreeSWITCH's ANVEO_SIP_PROXY is "
                  f"{env.get('ANVEO_SIP_PROXY', '(unset)')!r}; pass --proxy host[:port].")
            return 1
        realm = env.get("ANVEO_SIP_REALM", "").strip() or None
        credentials = credentials_from(env)
        print(f"Anveo SIP server: {proxy}  realm: {realm or '(none)'}  "
              f"auth: {'username/password' if credentials else 'source IP only'}")
        blocks = {
            "pjsip.conf": pjsip_block(proxy, realm, credentials),
            "extensions.conf": extensions_block(args.prefix),
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
        backup = host_path + ".bak-hopwhistle-anveo"
        if not os.path.exists(backup):
            with open(backup, "w", encoding="utf-8") as handle:
                handle.write(current)
            os.chmod(backup, 0o600)
        write_in_place(host_path, updated)
        print(f"Wrote {host_path}")
    print(asterisk(args.container, "module reload res_pjsip.so").strip())
    print(asterisk(args.container, "dialplan reload").strip())

    if args.rollback:
        print("Rolled back. Set DOGRAH_ARI_TRUNK back to fractel (or twilio) and clear DOGRAH_ARI_DIAL_PREFIX.")
        return 0
    print()
    return 0 if status(args.container) else 1


if __name__ == "__main__":
    sys.exit(main())
