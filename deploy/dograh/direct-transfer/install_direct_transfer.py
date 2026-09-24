#!/usr/bin/env python3
"""Hand Dograh AI transfers straight to Hopwhistle's FreeSWITCH, not via FracTEL.

Today a Dograh transfer is ``PJSIP/+1<DID>@fractel``: Asterisk dials the
campaign DID out through FracTEL and FracTEL delivers it back to FreeSWITCH on
this same host. That pays the carrier twice, makes every transfer depend on
FracTEL, and the call arrives with Dograh's outbound caller ID, so Hopwhistle
screens and routes it (litigator check, state, licence) on the wrong number.

This installs two things into the ``dograh-asterisk`` configuration:

  * a PJSIP trunk ``hopwhistle`` pointing at FreeSWITCH's external profile
    (the one carriers already use, port 5080), and
  * a dialplan context ``hopwhistle-transfer`` that takes
    ``<DID>*<lead number>``, presents the lead's number as caller ID, marks the
    call ``X-Hopwhistle-Source: dograh-transfer`` and dials the DID on that
    trunk.

The Dograh transfer tool's destination then becomes::

    Local/{{transfer_destination}}*{{called_number}}@hopwhistle-transfer/n

Nothing in Hopwhistle changes: FreeSWITCH receives an ordinary inbound call to
the campaign DID, from the lead's number, and runs the same campaign routing.

The configuration is written between markers into the host files that are
mounted at ``/etc/asterisk/pjsip.conf`` and ``/etc/asterisk/extensions.conf``,
in place (same inode), so single-file bind mounts see it. Running again replaces
the block; ``--rollback`` removes it. Only ``module reload res_pjsip.so`` and
``dialplan reload`` are run, neither of which touches calls in progress.

Usage (on the Dograh/Hopwhistle host, as root):

    python3 install_direct_transfer.py                 # dry run: prints the plan
    python3 install_direct_transfer.py --apply         # write + reload + verify
    python3 install_direct_transfer.py --status        # verify only
    python3 install_direct_transfer.py --rollback --apply
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import subprocess
import sys
from typing import Dict, List, Optional

MARK_BEGIN = "; >>> HOPWHISTLE DIRECT TRANSFER (managed by install_direct_transfer.py) >>>"
MARK_END = "; <<< HOPWHISTLE DIRECT TRANSFER <<<"

ENDPOINT = "hopwhistle"
CONTEXT = "hopwhistle-transfer"
DOGRAH_DESTINATION = "Local/{{transfer_destination}}*{{called_number}}@" + CONTEXT + "/n"

DEFAULT_CONTAINER = "dograh-asterisk"
DEFAULT_ENV_FILE = "/opt/hopwhistle/.env"
DEFAULT_FS_PORT = 5080


# ── Pure pieces (tested in tests/test_direct_transfer.py) ────────────────────


def pjsip_block(fs_host: str, fs_port: int, transport: Optional[str]) -> str:
    """The trunk to FreeSWITCH. Signalling and media stay on this host."""
    lines = [
        MARK_BEGIN,
        "; Dograh transfers go straight to Hopwhistle FreeSWITCH instead of out",
        "; through FracTEL and back. See deploy/dograh/direct-transfer/README.md.",
        f"[{ENDPOINT}]",
        "type=aor",
        f"contact=sip:{fs_host}:{fs_port}",
        "qualify_frequency=30",
        "",
        f"[{ENDPOINT}]",
        "type=endpoint",
        f"aors={ENDPOINT}",
        # FreeSWITCH never calls Asterisk on this trunk; anything that tries is
        # hung up rather than handed to a default context.
        "context=hopwhistle-no-inbound",
        "disallow=all",
        "allow=ulaw",
        "allow=alaw",
        "direct_media=no",
        "rtp_symmetric=yes",
        "force_rport=yes",
        "rewrite_contact=yes",
        "dtmf_mode=rfc4733",
        # Present the lead's number in From and P-Asserted-Identity.
        "send_pai=yes",
        "trust_id_outbound=yes",
    ]
    if transport:
        lines.append(f"transport={transport}")
    lines.append(MARK_END)
    return "\n".join(lines) + "\n"


def extensions_block() -> str:
    """``<DID>*<lead>`` → caller ID = lead, header, Dial(PJSIP/+<DID>@hopwhistle)."""
    return "\n".join(
        [
            MARK_BEGIN,
            f"; Dograh transfer tool destination: {DOGRAH_DESTINATION}",
            f"[{CONTEXT}]",
            # A leading + on the DID is dropped and the rest dialled as digits.
            "exten => _+X.,1,Goto(${EXTEN:1},1)",
            "exten => _X.,1,NoOp(Hopwhistle direct transfer ${EXTEN})",
            " same => n,Set(HW_DID=${FILTER(0-9,${CUT(EXTEN,*,1)})})",
            " same => n,Set(HW_LEAD=${FILTER(0-9,${CUT(EXTEN,*,2)})})",
            " same => n,ExecIf($[${LEN(${HW_DID})} = 10]?Set(HW_DID=1${HW_DID}))",
            " same => n,GotoIf($[${LEN(${HW_DID})} != 11]?bad,1)",
            " same => n,ExecIf($[${LEN(${HW_LEAD})} = 10]?Set(HW_LEAD=1${HW_LEAD}))",
            " same => n,GotoIf($[${LEN(${HW_LEAD})} < 11]?nolead)",
            " same => n,Set(CALLERID(num)=${HW_LEAD})",
            " same => n,Set(CALLERID(name)=${HW_LEAD})",
            " same => n(dial),Dial(PJSIP/+${HW_DID}@" + ENDPOINT + ",,b(hopwhistle-transfer-headers^s^1))",
            " same => n,Hangup(${HANGUPCAUSE})",
            " same => n(nolead),Log(WARNING,Hopwhistle direct transfer ${EXTEN} has no lead number - Hopwhistle will see no caller ID)",
            " same => n,Goto(dial)",
            "exten => bad,1,Log(WARNING,Hopwhistle direct transfer: not a DID: ${HW_DID})",
            " same => n,Hangup(1)",
            "",
            "[hopwhistle-transfer-headers]",
            "exten => s,1,Set(PJSIP_HEADER(add,X-Hopwhistle-Source)=dograh-transfer)",
            " same => n,Return()",
            "",
            "[hopwhistle-no-inbound]",
            "exten => _X.,1,Hangup(21)",
            "exten => _+X.,1,Hangup(21)",
            "exten => s,1,Hangup(21)",
            MARK_END,
        ]
    ) + "\n"


def replace_block(text: str, block: Optional[str]) -> str:
    """Put ``block`` between the markers, replacing any previous one.

    ``block=None`` removes it. Everything outside the markers is untouched.
    """
    # The blank line written before the block goes with it, so re-running is a no-op.
    pattern = re.compile(r"\n?" + re.escape(MARK_BEGIN) + r".*?" + re.escape(MARK_END) + r"\n?", re.S)
    stripped = pattern.sub("", text)
    if block is None:
        return stripped
    if stripped and not stripped.endswith("\n"):
        stripped += "\n"
    return stripped + ("\n" if stripped else "") + block


def parse_env(text: str) -> Dict[str, str]:
    values: Dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key.startswith("export "):
            key = key[len("export "):].strip()
        values[key] = value.strip().strip("'\"")
    return values


def pick_fs_host(env: Dict[str, str]) -> Optional[str]:
    """FreeSWITCH's address as seen from this host.

    The public IP FreeSWITCH already advertises in SDP, so media is addressed
    the same way it is for carrier calls. Loopback is a fallback only.
    """
    for key in ("SIP_PUBLIC_IP", "PUBLIC_IP"):
        value = env.get(key, "")
        try:
            ipaddress.ip_address(value)
            return value
        except ValueError:
            continue
    return None


def host_path_for(mounts: List[dict], container_path: str) -> Optional[str]:
    """Host path backing ``container_path``, via a file or directory mount."""
    best: Optional[tuple] = None
    for mount in mounts:
        dest = (mount.get("Destination") or "").rstrip("/")
        src = mount.get("Source") or ""
        if not dest or not src:
            continue
        if container_path == dest:
            return src
        if container_path.startswith(dest + "/"):
            if best is None or len(dest) > len(best[0]):
                best = (dest, src)
    if best is None:
        return None
    return best[1] + container_path[len(best[0]):]


# ── Host side ────────────────────────────────────────────────────────────────


def run(cmd: List[str], check: bool = True) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise SystemExit(f"FAILED: {' '.join(cmd)}\n{result.stdout}{result.stderr}")
    return (result.stdout or "") + (result.stderr or "")


def asterisk(container: str, command: str) -> str:
    return run(["docker", "exec", container, "asterisk", "-rx", command], check=False)


def write_in_place(path: str, text: str) -> None:
    # Same inode: a single-file bind mount keeps showing the container the file.
    with open(path, "r+", encoding="utf-8") as handle:
        handle.seek(0)
        handle.write(text)
        handle.truncate()


def status(container: str) -> bool:
    print("── Trunk")
    endpoint = asterisk(container, f"pjsip show endpoint {ENDPOINT}")
    print(endpoint.strip() or "(no output)")
    aor = asterisk(container, f"pjsip show aor {ENDPOINT}")
    print(aor.strip())
    print("\n── Dialplan")
    plan = asterisk(container, f"dialplan show {CONTEXT}")
    print(plan.strip())

    ok = True
    if not re.search(rf"Endpoint:\s+{ENDPOINT}\b", endpoint):
        print(f"\nNOT OK: endpoint {ENDPOINT} is not loaded.")
        ok = False
    if f"Context '{CONTEXT}'" not in plan:
        print(f"\nNOT OK: context {CONTEXT} is not loaded.")
        ok = False
    if re.search(r"Contact:\s+\S+\s+\S+\s+(Avail|Reachable)", aor):
        print("\nFreeSWITCH answers OPTIONS on the trunk: reachable.")
    else:
        print("\nWARNING: the trunk contact is not showing Avail yet. Qualify runs every 30s;"
              f" re-run --status, or check FreeSWITCH is listening on the contact above.")
    return ok


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="write and reload (default: dry run)")
    parser.add_argument("--rollback", action="store_true", help="remove the managed blocks")
    parser.add_argument("--status", action="store_true", help="only show whether it is loaded")
    parser.add_argument("--container", default=DEFAULT_CONTAINER)
    parser.add_argument("--env-file", default=DEFAULT_ENV_FILE,
                        help="Hopwhistle .env, read for SIP_PUBLIC_IP / PUBLIC_IP")
    parser.add_argument("--fs-host", help="FreeSWITCH address (default: SIP_PUBLIC_IP/PUBLIC_IP)")
    parser.add_argument("--fs-port", type=int, default=DEFAULT_FS_PORT)
    parser.add_argument("--transport", help="PJSIP transport name, when Asterisk has several")
    args = parser.parse_args(argv)

    running = run(["docker", "inspect", "-f", "{{.State.Running}}", args.container], check=False)
    if running.strip() != "true":
        print(f"REFUSED: container {args.container} is not running.\n{running}")
        return 1

    if args.status:
        return 0 if status(args.container) else 1

    mounts = json.loads(run(["docker", "inspect", "-f", "{{json .Mounts}}", args.container]))
    targets = {}
    for name in ("pjsip.conf", "extensions.conf"):
        host_path = host_path_for(mounts, f"/etc/asterisk/{name}")
        if not host_path or not os.path.isfile(host_path):
            print(f"REFUSED: /etc/asterisk/{name} in {args.container} is not backed by a file on"
                  " this host, so a change would not survive a container restart.")
            print("Mounts:", json.dumps(mounts, indent=2))
            return 1
        targets[name] = host_path

    blocks: Dict[str, Optional[str]]
    if args.rollback:
        blocks = {"pjsip.conf": None, "extensions.conf": None}
    else:
        fs_host = args.fs_host
        if not fs_host:
            env_text = ""
            if os.path.isfile(args.env_file):
                with open(args.env_file, encoding="utf-8") as handle:
                    env_text = handle.read()
            fs_host = pick_fs_host(parse_env(env_text))
        if not fs_host:
            print(f"REFUSED: no SIP_PUBLIC_IP or PUBLIC_IP in {args.env_file}; pass --fs-host.")
            return 1
        ipaddress.ip_address(fs_host)
        blocks = {
            "pjsip.conf": pjsip_block(fs_host, args.fs_port, args.transport),
            "extensions.conf": extensions_block(),
        }
        print(f"FreeSWITCH contact: sip:{fs_host}:{args.fs_port}")

    changed = {}
    for name, host_path in targets.items():
        with open(host_path, encoding="utf-8") as handle:
            current = handle.read()
        updated = replace_block(current, blocks[name])
        state = "unchanged" if updated == current else "would change"
        print(f"{name}: {host_path} ({state})")
        if updated != current:
            changed[name] = (host_path, current, updated)

    if not args.apply:
        print("\nDry run. Blocks that --apply would write:\n")
        for name in targets:
            print(f"── {name}\n{blocks[name] or '(removed)'}")
        print("Nothing changed. Re-run with --apply.")
        return 0

    for name, (host_path, current, updated) in changed.items():
        backup = host_path + ".bak-hopwhistle-direct-transfer"
        if not os.path.exists(backup):
            with open(backup, "w", encoding="utf-8") as handle:
                handle.write(current)
            print(f"Backup: {backup}")
        write_in_place(host_path, updated)
        print(f"Wrote {host_path}")

    print(asterisk(args.container, "module reload res_pjsip.so").strip())
    print(asterisk(args.container, "dialplan reload").strip())

    if args.rollback:
        print("\nRolled back. Point the Dograh transfer tool back at its previous destination.")
        return 0

    print()
    ok = status(args.container)
    print(f"\nDograh transfer tool destination:\n    {DOGRAH_DESTINATION}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
