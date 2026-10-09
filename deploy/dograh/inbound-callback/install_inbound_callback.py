#!/usr/bin/env python3
"""Send AI callbacks (leads calling back the AI's caller IDs) to a Dograh agent.

The Dograh AI dials out from our FracTEL DIDs. A lead who calls one back
reaches Hopwhistle's FreeSWITCH. With this installed, FreeSWITCH hands that call
to Dograh's Asterisk on this host and the chosen Dograh agent answers it.

Three pieces, all on this host:

  1. Dograh database: the caller-ID numbers get the agent as their
     ``inbound_workflow_id`` (assign_inbound_agent.py, run in the api container).
  2. Asterisk: a PJSIP endpoint that accepts calls from FreeSWITCH, and a
     dialplan context that hands them to Dograh's Stasis application.
  3. Hopwhistle: ``DOGRAH_CALLBACK_BRIDGE`` in the API environment, which this
     prints, tells the inbound route lookup where to send those calls.

Asterisk configuration is written between markers into the host files mounted
at /etc/asterisk/pjsip.conf and extensions.conf, like ../direct-transfer. Only
``module reload res_pjsip.so`` and ``dialplan reload`` are run; calls in
progress are not touched.

Usage (on the host, as root, from /opt/hopwhistle):

    python3 deploy/dograh/inbound-callback/install_inbound_callback.py --agent-id 15
    python3 deploy/dograh/inbound-callback/install_inbound_callback.py --agent-id 15 --apply
    python3 deploy/dograh/inbound-callback/install_inbound_callback.py --status
    python3 deploy/dograh/inbound-callback/install_inbound_callback.py --agent-id 15 --rollback --apply
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import sys
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "direct-transfer"))

import install_direct_transfer as dt  # noqa: E402  (shared host helpers)

MARK_BEGIN = "; >>> HOPWHISTLE AI CALLBACK (managed by install_inbound_callback.py) >>>"
MARK_END = "; <<< HOPWHISTLE AI CALLBACK <<<"

ENDPOINT = "hopwhistle-callback"
CONTEXT = "dograh-ai-callback"
DEFAULT_ASTERISK = "dograh-asterisk"
DEFAULT_API = "dograh-api-1"
ASSIGN_SCRIPT = os.path.join(HERE, "assign_inbound_agent.py")
IN_CONTAINER = "/tmp/hw-inbound-callback"


# ── Pure pieces (tested in ../tests/test_inbound_callback.py) ────────────────


def pjsip_block(match_hosts: List[str], transport: Optional[str]) -> str:
    """An endpoint FreeSWITCH's calls are identified as, by source address."""
    lines = [
        MARK_BEGIN,
        "; Leads calling back the AI's caller IDs, handed over by FreeSWITCH.",
        "; See deploy/dograh/inbound-callback/README.md.",
        f"[{ENDPOINT}]",
        "type=endpoint",
        f"context={CONTEXT}",
        "disallow=all",
        "allow=ulaw",
        "allow=alaw",
        "direct_media=no",
        "rtp_symmetric=yes",
        "force_rport=yes",
        "rewrite_contact=yes",
        "dtmf_mode=rfc4733",
        # The lead's number arrives in From / P-Asserted-Identity.
        "trust_id_inbound=yes",
    ]
    if transport:
        lines.append(f"transport={transport}")
    lines += [
        "",
        f"[{ENDPOINT}]",
        "type=identify",
        f"endpoint={ENDPOINT}",
    ]
    lines += [f"match={host}" for host in match_hosts]
    lines.append(MARK_END)
    return "\n".join(lines) + "\n"


def extensions_block(stasis_app: str) -> str:
    """Any form of a NANP DID → +1XXXXXXXXXX → Dograh's Stasis application.

    Dograh resolves the agent from the channel's extension, so the extension
    must be the number as Dograh stores it.
    """
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", stasis_app or ""):
        raise ValueError(f"not a Stasis application name: {stasis_app!r}")
    return "\n".join(
        [
            MARK_BEGIN,
            f"[{CONTEXT}]",
            "exten => _+1NXXNXXXXXX,1,NoOp(AI callback ${EXTEN} from ${CALLERID(num)})",
            f" same => n,Stasis({stasis_app})",
            " same => n,Hangup()",
            "exten => _1NXXNXXXXXX,1,Goto(+${EXTEN},1)",
            "exten => _NXXNXXXXXX,1,Goto(+1${EXTEN},1)",
            "exten => _X.,1,Hangup(1)",
            "exten => _+X.,1,Hangup(1)",
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


def udp_transport(text: str, name: Optional[str] = None) -> Optional[tuple]:
    """(name, port, bound address) of a UDP transport in ``pjsip show transports``.

    The address is None for a wildcard bind (0.0.0.0 / [::]). A transport bound
    to one address answers only there, so FreeSWITCH must be sent to it.
    """
    for match in re.finditer(r"Transport:\s+(\S+)\s+udp\s+\d+\s+\d+\s+(\S+):(\d+)", text):
        if name is None or match.group(1) == name:
            host = match.group(2).strip("[]")
            bound = None if host in ("0.0.0.0", "::", "") else host
            return match.group(1), int(match.group(3)), bound
    return None


def bridge_template(asterisk_host: str, port: int) -> str:
    """The value for Hopwhistle's DOGRAH_CALLBACK_BRIDGE."""
    return f"sofia/external/{{DID}}@{asterisk_host}:{port}"


def parse_result(output: str) -> Optional[dict]:
    for line in reversed(output.splitlines()):
        if line.startswith("RESULT "):
            try:
                return json.loads(line[len("RESULT "):])
            except ValueError:
                return None
    return None


# ── Host side ────────────────────────────────────────────────────────────────


def assign(api: str, agent_id: int, org_id: int, tcid: int, extra: List[str]) -> dict:
    dt.run(["docker", "exec", api, "mkdir", "-p", IN_CONTAINER])
    dt.run(["docker", "cp", ASSIGN_SCRIPT, f"{api}:{IN_CONTAINER}/"])
    output = dt.run(
        ["docker", "exec", api, "python", f"{IN_CONTAINER}/assign_inbound_agent.py",
         "--workflow-id", str(agent_id), "--org-id", str(org_id), "--tcid", str(tcid), *extra],
        check=False,
    )
    dt.run(["docker", "exec", api, "rm", "-rf", IN_CONTAINER], check=False)
    # The RESULT line carries every number; show the summary, not the list.
    print("\n".join(l for l in output.strip().splitlines() if not l.startswith("RESULT ")))
    return parse_result(output) or {"ok": False, "error": "no RESULT line from assign_inbound_agent.py"}


def status(container: str) -> bool:
    endpoint = dt.asterisk(container, f"pjsip show endpoint {ENDPOINT}")
    plan = dt.asterisk(container, f"dialplan show {CONTEXT}")
    print(endpoint.strip() or "(no output)")
    print(plan.strip())
    ok = bool(re.search(rf"Endpoint:\s+{re.escape(ENDPOINT)}\b", endpoint)) and f"Context '{CONTEXT}'" in plan
    print("\nAsterisk side: " + ("loaded." if ok else "NOT loaded."))
    return ok


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--agent-id", type=int, help="Dograh agent (workflow) id, e.g. 15")
    parser.add_argument("--apply", action="store_true", help="write and reload (default: dry run)")
    parser.add_argument("--rollback", action="store_true", help="remove the config and unassign the agent")
    parser.add_argument("--status", action="store_true")
    parser.add_argument("--container", default=DEFAULT_ASTERISK, help="Dograh Asterisk container")
    parser.add_argument("--api-container", default=DEFAULT_API, help="Dograh api container")
    parser.add_argument("--org-id", type=int, default=1)
    parser.add_argument("--tcid", type=int, default=1, help="Dograh telephony configuration (FracTEL ARI)")
    parser.add_argument("--env-file", default=dt.DEFAULT_ENV_FILE)
    parser.add_argument("--fs-host", help="FreeSWITCH address calls come from (default SIP_PUBLIC_IP)")
    parser.add_argument("--match", action="append", default=[],
                        help="extra source address Asterisk accepts these calls from (repeatable)")
    parser.add_argument("--asterisk-host", help="address FreeSWITCH reaches Asterisk on (default: --fs-host)")
    parser.add_argument("--asterisk-port", type=int, help="Asterisk SIP port (default: its UDP transport)")
    parser.add_argument("--transport", help="PJSIP transport name, when Asterisk has several")
    parser.add_argument("--stasis-app", help="override the Stasis application read from Dograh")
    parser.add_argument("--all-numbers", action="store_true", help="every number on the config, not only the caller-ID pool")
    parser.add_argument("--replace", action="store_true", help="also move numbers another agent answers")
    parser.add_argument("--numbers-out",
                        help="write the numbers the agent answers here, one per line, for Hopwhistle")
    args = parser.parse_args(argv)

    for name in (args.container, args.api_container):
        if dt.run(["docker", "inspect", "-f", "{{.State.Running}}", name], check=False).strip() != "true":
            print(f"REFUSED: container {name} is not running.")
            return 1

    if args.status:
        return 0 if status(args.container) else 1

    if not args.agent_id:
        print("REFUSED: --agent-id is required (the Dograh agent that answers callbacks).")
        return 1

    mounts = json.loads(dt.run(["docker", "inspect", "-f", "{{json .Mounts}}", args.container]))
    targets: Dict[str, str] = {}
    for name in ("pjsip.conf", "extensions.conf"):
        host_path = dt.host_path_for(mounts, f"/etc/asterisk/{name}")
        if not host_path or not os.path.isfile(host_path):
            print(f"REFUSED: /etc/asterisk/{name} in {args.container} is not a file on this host,"
                  " so a change would not survive a restart.")
            return 1
        targets[name] = host_path

    print("── Dograh: agent on the caller-ID numbers")
    extra = []
    if args.all_numbers:
        extra.append("--all-numbers")
    if args.replace:
        extra.append("--replace")
    if args.rollback:
        extra.append("--clear")
    if args.apply:
        extra.append("--apply")
    result = assign(args.api_container, args.agent_id, args.org_id, args.tcid, extra)
    if not result.get("ok"):
        print(f"\nREFUSED: {result.get('error', 'the Dograh step failed')}")
        return 1
    if args.numbers_out:
        numbers = result.get("numbers_answered") or []
        with open(args.numbers_out, "w", encoding="utf-8") as handle:
            handle.write("".join(f"{n}\n" for n in numbers))
        print(f"{len(numbers)} numbers answered by agent {args.agent_id} -> {args.numbers_out}")

    blocks: Dict[str, Optional[str]]
    template = None
    if args.rollback:
        blocks = {"pjsip.conf": None, "extensions.conf": None}
    else:
        stasis_app = args.stasis_app or result.get("stasis_app")
        if not stasis_app:
            print("REFUSED: could not read Dograh's Stasis application; pass --stasis-app.")
            return 1
        fs_host = args.fs_host
        if not fs_host:
            env_text = ""
            if os.path.isfile(args.env_file):
                with open(args.env_file, encoding="utf-8") as handle:
                    env_text = handle.read()
            fs_host = dt.pick_fs_host(dt.parse_env(env_text))
        if not fs_host:
            print(f"REFUSED: no SIP_PUBLIC_IP or PUBLIC_IP in {args.env_file}; pass --fs-host.")
            return 1
        ipaddress.ip_address(fs_host)
        matches = [fs_host] + [m for m in args.match if m != fs_host]

        port = args.asterisk_port
        bound = None
        if port is None:
            found = udp_transport(dt.asterisk(args.container, "pjsip show transports"), args.transport)
            if not found:
                print("REFUSED: no UDP transport found in Asterisk; pass --asterisk-port.")
                return 1
            _, port, bound = found
        # Oct 8: the bridge went to SIP_PUBLIC_IP:5064 while Asterisk's 5064
        # transport was bound to another address, and every callback failed.
        template = bridge_template(args.asterisk_host or bound or fs_host, port)
        blocks = {
            "pjsip.conf": pjsip_block(matches, args.transport),
            "extensions.conf": extensions_block(stasis_app),
        }
        print(f"\nStasis application: {stasis_app}")
        print(f"Calls accepted from: {', '.join(matches)}")

    print("\n── Asterisk")
    changed = {}
    for name, host_path in targets.items():
        with open(host_path, encoding="utf-8") as handle:
            current = handle.read()
        updated = replace_block(current, blocks[name])
        print(f"{name}: {host_path} ({'unchanged' if updated == current else 'would change'})")
        if updated != current:
            changed[name] = (host_path, current, updated)

    if not args.apply:
        for name in targets:
            print(f"\n── {name}\n{blocks[name] or '(removed)'}")
        if template:
            print(f"Hopwhistle API setting:\n    DOGRAH_CALLBACK_BRIDGE={template}")
        print("\nDry run. Nothing changed. Re-run with --apply.")
        return 0

    for name, (host_path, current, updated) in changed.items():
        backup = host_path + ".bak-hopwhistle-ai-callback"
        if not os.path.exists(backup):
            with open(backup, "w", encoding="utf-8") as handle:
                handle.write(current)
            print(f"Backup: {backup}")
        dt.write_in_place(host_path, updated)
        print(f"Wrote {host_path}")
    print(dt.asterisk(args.container, "module reload res_pjsip.so").strip())
    print(dt.asterisk(args.container, "dialplan reload").strip())

    if args.rollback:
        print("\nRolled back. Remove DOGRAH_CALLBACK_BRIDGE from the Hopwhistle API environment"
              " and restart the API so callbacks use their normal routes again.")
        return 0

    print()
    ok = status(args.container)
    print("\nLast step, Hopwhistle API environment (then restart the API):")
    print(f"    DOGRAH_CALLBACK_BRIDGE={template}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
