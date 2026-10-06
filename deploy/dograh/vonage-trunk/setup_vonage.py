#!/usr/bin/env python3
"""One command: send Dograh's AI outbound calls over Vonage.

Run on the server as root, from the Hetzner web console or SSH:

    cd /opt/hopwhistle && git pull && python3 deploy/dograh/vonage-trunk/setup_vonage.py

It asks for the Vonage API key and secret (the secret is not echoed and is never
printed), then walks the steps in deploy/dograh/vonage-trunk/README.md:

  1. checks the key and secret against Vonage and lists the account's US numbers;
  2. writes the Vonage settings into /opt/hopwhistle/.env (backup kept);
  3. adds the `vonage` trunk to Dograh's Asterisk and opens the firewall to Vonage;
  4. places one test call to your phone, and stops unless you say it rang;
  5. makes the Vonage numbers Dograh's only caller IDs and turns same-state
     caller ID off on every campaign (backup kept, reversible);
  6. points Dograh's outbound calls at Vonage, with same-state caller ID off,
     and restarts the Dograh API.

Every step that changes Dograh asks first. Nothing in Hopwhistle is restarted:
the .env values reach Hopwhistle's own FreeSWITCH/API on the next deploy.
"""

from __future__ import annotations

import getpass
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENV_FILE = os.path.join(REPO, ".env")
DOGRAH_DIR = "/opt/dograh"
OVERRIDE = os.path.join(DOGRAH_DIR, "docker-compose.override.yaml")
API_CONTAINER = "dograh-api-1"
PROVIDER_PATH = "/app/api/services/telephony/providers/ari/provider.py"
V3_MARKER = "HOPWHISTLE_ARI_DIAL_FORMAT_V3"

ENV_KEYS = (
    "VONAGE_API_KEY", "VONAGE_API_SECRET", "VONAGE_NUMBER_ROUTING_MODE", "VONAGE_SIP_URI",
    "VONAGE_DEFAULT_COUNTRY", "VONAGE_SIP_PROXY", "VONAGE_SIP_REALM", "VONAGE_SIP_USERNAME",
    "VONAGE_SIP_PASSWORD",
)
# Characters that break a .env value, a pjsip.conf line or a shell.
_BAD_CHARS = re.compile(r"[\s'\"$#;\\`]")

_ENV_LINE = re.compile(r"^(\s*)(-\s*)?(DOGRAH_ARI_[A-Z_]+|DOGRAH_STATE_CID_POLICY)\s*([:=])")


# ── pure helpers (tested in deploy/dograh/tests/test_vonage_setup.py) ─────────

def valid_credential(value: str) -> bool:
    return bool(value) and not _BAD_CHARS.search(value)


def us_numbers(payload: dict) -> List[str]:
    """US numbers from Vonage's /account/numbers response, as +1XXXXXXXXXX."""
    out = []
    for item in payload.get("numbers") or []:
        digits = re.sub(r"\D", "", str(item.get("msisdn", "")))
        if len(digits) == 11 and digits.startswith("1") and digits[1] not in "01":
            e164 = "+" + digits
            if e164 not in out:
                out.append(e164)
    return out


def env_value(text: str, key: str) -> str:
    for line in text.splitlines():
        k, sep, v = line.strip().partition("=")
        if sep and k.strip() == key:
            return v.strip().strip("'\"")
    return ""


def update_env(text: str, values: Dict[str, str]) -> str:
    """Drop the Vonage lines this script owns, then append ``values``."""
    kept = [
        line for line in text.splitlines()
        if line.strip().partition("=")[0].strip() not in ENV_KEYS
    ]
    body = "\n".join(kept).rstrip("\n")
    block = "\n".join(f"{k}={v}" for k, v in values.items())
    return (body + "\n" if body else "") + block + "\n"


def set_ari_env(text: str) -> Tuple[str, int]:
    """Point every DOGRAH_ARI_TRUNK in a compose override at Vonage.

    Handles both ``KEY: value`` and ``- KEY=value`` styles. Drops
    DOGRAH_ARI_DIAL_PREFIX (Anveo only) and any old DOGRAH_ARI_DIAL_FORMAT,
    adds ``DOGRAH_ARI_DIAL_FORMAT=nanp11`` beside each trunk line, and keeps
    transfers on FracTEL unless the file already chooses a transfer trunk.
    A DOGRAH_STATE_CID_POLICY default is set to ``off``: the Vonage numbers
    are used as they are, never matched to the destination's state.
    Returns the new text and how many trunk lines were changed.
    """
    lines = text.splitlines()
    has_transfer = any(
        (m := _ENV_LINE.match(line)) and m.group(3) == "DOGRAH_ARI_TRANSFER_TRUNK" for line in lines
    )
    out: List[str] = []
    changed = 0
    for line in lines:
        m = _ENV_LINE.match(line)
        if not m:
            out.append(line)
            continue
        indent, dash, key, _ = m.groups()

        def entry(k: str, v: str) -> str:
            return f"{indent}- {k}={v}" if dash else f"{indent}{k}: {v}"

        if key in ("DOGRAH_ARI_DIAL_PREFIX", "DOGRAH_ARI_DIAL_FORMAT"):
            continue
        if key == "DOGRAH_STATE_CID_POLICY":
            # Quoted in map style: a bare `off` is a boolean to YAML 1.1 readers.
            out.append(entry(key, "off" if dash else '"off"'))
            continue
        if key != "DOGRAH_ARI_TRUNK":
            out.append(line)
            continue

        out.append(entry("DOGRAH_ARI_TRUNK", "vonage"))
        out.append(entry("DOGRAH_ARI_DIAL_FORMAT", "nanp11"))
        if not has_transfer:
            out.append(entry("DOGRAH_ARI_TRANSFER_TRUNK", "fractel"))
        changed += 1
    return "\n".join(out) + ("\n" if text.endswith("\n") else ""), changed


def services_mounting_provider(config: dict) -> Dict[str, str]:
    """{service: host source} for services that bind-mount the patched provider.py."""
    found = {}
    for name, svc in (config.get("services") or {}).items():
        for vol in svc.get("volumes") or []:
            if isinstance(vol, dict) and vol.get("target") == PROVIDER_PATH and vol.get("source"):
                found[name] = vol["source"]
    return found


# ── side effects ──────────────────────────────────────────────────────────────

def sh(cmd: List[str], cwd: Optional[str] = None, check: bool = True) -> str:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    output = (result.stdout or "") + (result.stderr or "")
    if check and result.returncode != 0:
        raise SystemExit(f"\nFAILED: {' '.join(cmd)}\n{output}")
    return output


def step(cmd: List[str], cwd: Optional[str] = None) -> int:
    """Run with output streamed to the console."""
    return subprocess.run(cmd, cwd=cwd).returncode


def ask(prompt: str, default: str = "") -> str:
    suffix = f" [{default}]" if default else ""
    answer = input(f"{prompt}{suffix}: ").strip()
    return answer or default


def yes(prompt: str) -> bool:
    return ask(prompt + " (y/N)").lower() in ("y", "yes")


def header(text: str) -> None:
    print(f"\n=== {text} " + "=" * max(0, 60 - len(text)))


def vonage_numbers(key: str, secret: str) -> List[str]:
    query = urllib.parse.urlencode({"api_key": key, "api_secret": secret, "size": 100})
    try:
        with urllib.request.urlopen(f"https://rest.nexmo.com/account/numbers?{query}", timeout=20) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            raise SystemExit("Vonage refused that API key/secret (HTTP %d). Check them and run again." % exc.code)
        raise SystemExit(f"Vonage API error: HTTP {exc.code}")
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not reach Vonage's API from this server: {exc.reason}")
    return us_numbers(payload)


def main() -> int:
    if os.geteuid() != 0:
        print("Run as root.")
        return 1
    for path in (ENV_FILE, OVERRIDE):
        if not os.path.isfile(path):
            print(f"Not found: {path}. Run this on the Hopwhistle/Dograh server.")
            return 1

    header("1. Vonage account")
    key = input("Vonage API key: ").strip()
    secret = getpass.getpass("Vonage API secret (hidden): ").strip()
    if not valid_credential(key) or not valid_credential(secret):
        print("The key or secret is empty or contains a space, quote, $, #, ; or backslash. Check what you pasted.")
        return 1
    numbers = vonage_numbers(key, secret)
    if not numbers:
        print("Key and secret work, but the account has no US numbers. Vonage only accepts a caller ID it\n"
              "owns, so buy at least one US number (Vonage dashboard -> Numbers -> Buy numbers) and run again.")
        return 1
    print(f"OK. US numbers on the account ({len(numbers)}): {', '.join(numbers)}")

    header("2. Vonage settings in .env")
    with open(ENV_FILE, encoding="utf-8") as handle:
        current = handle.read()
    values = {
        "VONAGE_API_KEY": key,
        "VONAGE_API_SECRET": secret,
        "VONAGE_DEFAULT_COUNTRY": "US",
        "VONAGE_SIP_PROXY": "sip.nexmo.com",
        "VONAGE_SIP_USERNAME": key,
        "VONAGE_SIP_PASSWORD": secret,
    }
    public_ip = env_value(current, "SIP_PUBLIC_IP") or env_value(current, "PUBLIC_IP")
    if public_ip:
        values["VONAGE_NUMBER_ROUTING_MODE"] = "sip"
        values["VONAGE_SIP_URI"] = f"sip:{public_ip}:5080"
    # Outside the checkout: a stray file there makes the deploy refuse a dirty tree.
    backup = f"/root/hopwhistle.env.bak.{time.strftime('%Y%m%d%H%M%S')}"
    shutil.copy2(ENV_FILE, backup)
    with open(ENV_FILE, "w", encoding="utf-8") as handle:
        handle.write(update_env(current, values))
    print(f"Written (backup: {backup}). Hopwhistle picks these up on its next deploy; nothing restarted.")

    header("3. Vonage trunk on Dograh's Asterisk + firewall")
    installer = os.path.join(HERE, "install_vonage_trunk.py")
    if step([sys.executable, installer, "--env-file", ENV_FILE, "--apply"]) != 0:
        print("Trunk install did not finish cleanly; see above. Nothing in Dograh's calling has changed.")
        return 1
    if step(["bash", os.path.join(REPO, "scripts", "install-persistent-sip-firewall.sh")]) != 0:
        print("Firewall script failed; see above.")
        return 1

    header("4. Test call")
    cell = ask("Your cell phone number to ring (10 digits)")
    cid = ask("Caller ID to show (one of the Vonage numbers)", numbers[0])
    step([sys.executable, installer, "--test-call", cell, "--caller-id", cid])
    print("Wait up to 30 seconds for the phone to ring.")
    if not yes("Did your phone ring, and did you hear your own voice echoed back?"):
        print("\nStopped before changing Dograh. Send this output to Claude:\n"
              "  docker logs --since 3m dograh-asterisk 2>&1 | grep -iE 'vonage|40[0-9]|50[0-9]' | tail -40")
        return 1

    header("5. Dograh caller IDs -> Vonage numbers, same-state matching off")
    pool_script = os.path.join(REPO, "deploy", "dograh", "anveo-trunk", "set_caller_id_pool.py")
    sh(["docker", "cp", pool_script, f"{API_CONTAINER}:/tmp/set_caller_id_pool.py"])
    print(sh(["docker", "exec", API_CONTAINER, "python", "/tmp/set_caller_id_pool.py", "--list-configs"]))
    tcid = ask("Telephony configuration id your campaigns use", "1")
    if not tcid.isdigit():
        print("Not a number.")
        return 1
    pool = ["docker", "exec", API_CONTAINER, "python", "/tmp/set_caller_id_pool.py", "--tcid", tcid,
            "--pool-tag", "vonage", "--label", "Vonage CID", "--backup", "/tmp/vonage-pool-backup.json",
            "--state-cid-off", "--numbers", *numbers]
    step(pool)
    if not yes("Apply this?"):
        print("Stopped. The trunk is installed; Dograh still dials its old carrier.")
        return 0
    if step(pool + ["--apply"]) != 0:
        return 1
    sh(["docker", "cp", f"{API_CONTAINER}:/tmp/vonage-pool-backup.json", "/root/vonage-pool-backup.json"])
    print("Backup: /root/vonage-pool-backup.json")

    header("6. Point Dograh at Vonage")
    config = json.loads(sh(["docker", "compose", "config", "--format", "json"], cwd=DOGRAH_DIR))
    mounts = services_mounting_provider(config)
    if not mounts:
        print("Dograh's ARI provider patch isn't mounted yet, so Dograh can't switch trunks. Do the\n"
              "'Apply' section of deploy/dograh/ari-trunk/README.md, then run this script again\n"
              "(steps 1-5 are safe to repeat).")
        return 1
    patcher = os.path.join(REPO, "deploy", "dograh", "ari-trunk", "apply_ari_trunk_patch.py")
    for source in sorted(set(mounts.values())):
        if step([sys.executable, patcher, "--provider-file", source, "--apply"]) != 0:
            print("The provider patch refused; nothing in Dograh was changed.")
            return 1

    with open(OVERRIDE, encoding="utf-8") as handle:
        original = handle.read()
    updated, changed = set_ari_env(original)
    if not changed:
        print(f"No DOGRAH_ARI_TRUNK setting in {OVERRIDE}. Add, under each of {', '.join(sorted(mounts))}:\n"
              "    environment:\n      DOGRAH_ARI_TRUNK: vonage\n      DOGRAH_ARI_DIAL_FORMAT: nanp11\n"
              "      DOGRAH_ARI_TRANSFER_TRUNK: fractel\n      DOGRAH_STATE_CID_POLICY: \"off\"\n"
              f"then: cd {DOGRAH_DIR} && docker compose up -d --no-deps {' '.join(sorted(mounts))}")
        return 1
    override_backup = f"{OVERRIDE}.bak-vonage.{time.strftime('%Y%m%d%H%M%S')}"
    shutil.copy2(OVERRIDE, override_backup)
    with open(OVERRIDE, "w", encoding="utf-8") as handle:
        handle.write(updated)
    check = subprocess.run(["docker", "compose", "config", "-q"], cwd=DOGRAH_DIR, capture_output=True, text=True)
    if check.returncode != 0:
        shutil.copy2(override_backup, OVERRIDE)
        print(f"The edited override did not validate, so it was put back:\n{check.stderr}")
        return 1
    print(f"Updated {OVERRIDE} (backup: {override_backup}).")

    print("\nRestarting the Dograh API drops AI calls in progress and can strand concurrency slots\n"
          "(see deploy/dograh/README.md). Best done outside dialing hours.")
    services = sorted(mounts)
    if not yes(f"Restart {', '.join(services)} now?"):
        print(f"Not restarted. When ready: cd {DOGRAH_DIR} && docker compose up -d --no-deps {' '.join(services)}")
        return 0
    if step(["docker", "compose", "up", "-d", "--no-deps", *services], cwd=DOGRAH_DIR) != 0:
        return 1
    time.sleep(5)
    trunk = sh(["docker", "exec", API_CONTAINER, "printenv", "DOGRAH_ARI_TRUNK"], check=False).strip()
    patched = V3_MARKER in sh(["docker", "exec", API_CONTAINER, "cat", PROVIDER_PATH], check=False)
    policy = sh(["docker", "exec", API_CONTAINER, "printenv", "DOGRAH_STATE_CID_POLICY"], check=False).strip()
    print(f"DOGRAH_ARI_TRUNK={trunk or '(unset)'}  provider patch V3: {'yes' if patched else 'NO'}  "
          f"same-state caller ID: {policy or 'off (default)'}")
    if policy not in ("", "off"):
        print(f"DOGRAH_STATE_CID_POLICY is still {policy!r}, set somewhere other than {OVERRIDE}\n"
              f"(check {DOGRAH_DIR}/.env and docker-compose.yaml). Change it to off and restart the API.")
        return 1
    if trunk != "vonage" or not patched:
        print("Dograh did not come up on Vonage; send this output to Claude.")
        return 1

    header("Done")
    print("Dograh's AI calls now go out over Vonage. Start a campaign call and watch:\n"
          "  docker logs -f dograh-asterisk 2>&1 | grep -i vonage\n"
          "Rollback: deploy/dograh/vonage-trunk/README.md -> Rollback.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
