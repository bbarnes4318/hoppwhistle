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
  5. prepares Dograh without touching running campaigns: patches its ARI
     provider so each call goes out on the trunk its caller ID belongs to,
     and creates a separate "Vonage" telephony configuration holding only
     the Vonage numbers (FracTEL's configuration is left exactly as it is);
  6. restarts the Dograh API (asks first; rolls back if it doesn't come up);
  7. moves the campaign you pick onto the Vonage configuration.

A Vonage campaign and a FracTEL campaign then run at the same time, each with
its own carrier's numbers.

Nothing a running campaign uses changes before step 6 asks. Nothing in Hopwhistle is restarted:
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
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
ENV_FILE = os.path.join(REPO, ".env")
DOGRAH_DIR = "/opt/dograh"
OVERRIDE = os.path.join(DOGRAH_DIR, "docker-compose.override.yaml")
API_CONTAINER = "dograh-api-1"
PROVIDER_PATH = "/app/api/services/telephony/providers/ari/provider.py"
CALLER_MARKER = "HOPWHISTLE_ARI_CALLER_TRUNK_V1"
CALLER_ENV = "DOGRAH_ARI_CALLER_TRUNKS"
API_SERVICE = "api"
PATCH_DIR = "/opt/dograh-patches/ari-trunk"
STAGED_PROVIDER = os.path.join(PATCH_DIR, "provider.py")

ENV_KEYS = (
    "VONAGE_API_KEY", "VONAGE_API_SECRET", "VONAGE_NUMBER_ROUTING_MODE", "VONAGE_SIP_URI",
    "VONAGE_DEFAULT_COUNTRY", "VONAGE_SIP_PROXY", "VONAGE_SIP_REALM", "VONAGE_SIP_USERNAME",
    "VONAGE_SIP_PASSWORD",
)
# Characters that break a .env value, a pjsip.conf line or a shell.
_BAD_CHARS = re.compile(r"[\s'\"$#;\\`]")

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


def services_mounting_provider(config: dict) -> Dict[str, str]:
    """{service: host source} for services that bind-mount the patched provider.py."""
    found = {}
    for name, svc in (config.get("services") or {}).items():
        for vol in svc.get("volumes") or []:
            if isinstance(vol, dict) and vol.get("target") == PROVIDER_PATH and vol.get("source"):
                found[name] = vol["source"]
    return found


def api_image_services(config: dict) -> List[str]:
    """The ``api`` service and every other service built from its image."""
    svcs = config.get("services") or {}
    api = svcs.get(API_SERVICE)
    if not api:
        return []
    image = api.get("image")
    return sorted(n for n, s in svcs.items() if n == API_SERVICE or (image and s.get("image") == image))


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _content(line: str) -> bool:
    stripped = line.strip()
    return bool(stripped) and not stripped.startswith("#")


def caller_trunks_value(numbers: List[str]) -> str:
    """DOGRAH_ARI_CALLER_TRUNKS for the Vonage numbers (see apply_caller_trunk_patch.py)."""
    return "vonage/nanp11:" + ",".join(numbers)


def add_mount_and_env(text: str, service: str, volume: str, env: Dict[str, str]) -> Optional[str]:
    """Add ``volume`` and set ``env`` on ``service`` in a compose override.

    Line-based, keeping the file's own indentation and list/map style; an
    existing entry for a key is rewritten in place, so running it again with
    more numbers updates the value. Returns None for shapes it will not guess
    at (inline ``[...]`` / ``{...}`` lists, no ``services:`` key), so the caller
    can stop without writing.
    """
    lines = text.split("\n")
    top = next((i for i, l in enumerate(lines) if re.match(r"^services:\s*(#.*)?$", l)), None)
    if top is None:
        return None
    end = next((i for i in range(top + 1, len(lines)) if _content(lines[i]) and _indent(lines[i]) == 0), len(lines))
    first = next((i for i in range(top + 1, end) if _content(lines[i])), None)
    ci = _indent(lines[first]) if first is not None else 2
    pad = " " * ci

    def map_entry(ind: int, key: str, value: str) -> str:
        return f'{" " * ind}{key}: "{value}"'

    def list_entry(ind: int, key: str, value: str) -> str:
        return f'{" " * ind}- {key}={value}'

    head = next((i for i in range(top + 1, end)
                 if re.match(rf"^{pad}{re.escape(service)}:\s*(#.*)?$", lines[i])), None)
    if head is None:
        block = [f"{pad}{service}:", f"{pad}  volumes:", f"{pad}    - {volume}", f"{pad}  environment:"]
        block += [map_entry(ci + 4, k, v) for k, v in env.items()]
        return "\n".join(lines[:top + 1] + block + lines[top + 1:])

    def bounds():
        stop = next((i for i in range(head + 1, len(lines)) if _content(lines[i]) and _indent(lines[i]) <= ci),
                    len(lines))
        body = [i for i in range(head + 1, stop) if _content(lines[i])]
        ki = _indent(lines[body[0]]) if body else ci + 2
        return body, ki

    def section(key: str):
        """(key line or None, item indent, dashed?) for a block key; False if inline."""
        body, ki = bounds()
        keyline = next((i for i in body if _indent(lines[i]) == ki and lines[i].strip().startswith(f"{key}:")), None)
        if keyline is None:
            return None, ki, None
        if not re.match(rf"^\s*{key}:\s*(#.*)?$", lines[keyline]):
            return False, ki, None
        nxt = next((i for i in body if i > keyline), None)
        if nxt is not None and _indent(lines[nxt]) > ki:
            return keyline, _indent(lines[nxt]), lines[nxt].lstrip().startswith("-")
        if nxt is not None and _indent(lines[nxt]) == ki and lines[nxt].lstrip().startswith("-"):
            return keyline, ki, True
        return keyline, ki + 2, None

    # volumes
    body, ki = bounds()
    if not any(volume.split(":")[0] in lines[i] for i in body):
        keyline, ind, _ = section("volumes")
        if keyline is False:
            return None
        if keyline is None:
            at = (body[-1] + 1) if body else head + 1
            lines[at:at] = [f"{' ' * ki}volumes:", f"{' ' * (ki + 2)}- {volume}"]
        else:
            lines.insert(keyline + 1, f"{' ' * ind}- {volume}")

    # environment
    for key, value in env.items():
        body, ki = bounds()
        keyline, ind, dashed = section("environment")
        if keyline is False:
            return None
        if keyline is None:
            at = (body[-1] + 1) if body else head + 1
            lines[at:at] = [f"{' ' * ki}environment:", map_entry(ki + 2, key, value)]
            continue
        entry = re.compile(rf"^(\s*)(-\s*)?{re.escape(key)}\s*[:=]")
        existing = next((i for i in body if i > keyline and entry.match(lines[i])), None)
        if existing is not None:
            m = entry.match(lines[existing])
            lines[existing] = (list_entry if m.group(2) else map_entry)(_indent(lines[existing]), key, value)
        else:
            lines.insert(keyline + 1, (list_entry if dashed else map_entry)(ind, key, value))
    return "\n".join(lines)


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

    header("5. Prepare Dograh (nothing changes for running campaigns)")
    config = json.loads(sh(["docker", "compose", "config", "--format", "json"], cwd=DOGRAH_DIR))
    services = api_image_services(config)
    if not services:
        print(f"No '{API_SERVICE}' service in {DOGRAH_DIR}'s compose config; nothing was changed.")
        return 1
    mounts = services_mounting_provider(config)
    patcher = os.path.join(REPO, "deploy", "dograh", "ari-trunk", "apply_caller_trunk_patch.py")
    if mounts:
        sources = sorted(set(mounts.values()))
    else:
        # Stage a fresh copy of the container's own provider.py, patch it, and
        # mount it over the original.
        os.makedirs(PATCH_DIR, exist_ok=True)
        if os.path.exists(STAGED_PROVIDER):
            shutil.copy2(STAGED_PROVIDER, f"{STAGED_PROVIDER}.prev.{time.strftime('%Y%m%d%H%M%S')}")
        sh(["docker", "cp", f"{API_CONTAINER}:{PROVIDER_PATH}", STAGED_PROVIDER])
        sources = [STAGED_PROVIDER]
    for source in sources:
        if step([sys.executable, patcher, "--provider-file", source, "--apply"]) != 0:
            print("The provider patch refused; nothing in Dograh was changed. Send this output to Claude.")
            return 1

    # A separate "Vonage" telephony configuration holding only the Vonage
    # numbers. No campaign uses it yet, so this changes nothing that is running.
    helper = os.path.join(HERE, "vonage_config.py")
    pool_script = os.path.join(REPO, "deploy", "dograh", "anveo-trunk", "set_caller_id_pool.py")
    for path in (helper, pool_script):
        sh(["docker", "cp", path, f"{API_CONTAINER}:/tmp/{os.path.basename(path)}"])
    print(sh(["docker", "exec", API_CONTAINER, "python", "/tmp/set_caller_id_pool.py", "--list-configs"]))
    source_tcid = ask("Configuration your FracTEL campaigns use (the new Vonage one is copied from it)", "1")
    if not source_tcid.isdigit():
        print("Not a number. Nothing was changed.")
        return 1
    out = sh(["docker", "exec", API_CONTAINER, "python", "/tmp/vonage_config.py", "ensure-config",
              "--source-tcid", source_tcid, "--name", "Vonage"])
    print(out)
    match = re.search(r"^TCID=(\d+)$", out, flags=re.M)
    if not match:
        print("Could not create the Vonage configuration; nothing else was changed. Send this output to Claude.")
        return 1
    vonage_tcid = match.group(1)
    if vonage_tcid == source_tcid:
        print("The Vonage configuration can't be the FracTEL one. Nothing else was changed.")
        return 1
    print(sh(["docker", "exec", API_CONTAINER, "python", "/tmp/vonage_config.py", "move-numbers",
              "--tcid", vonage_tcid, "--numbers", *numbers]))
    if step(["docker", "exec", API_CONTAINER, "python", "/tmp/set_caller_id_pool.py", "--tcid", vonage_tcid,
             "--pool-tag", "vonage", "--label", "Vonage CID", "--backup", "/tmp/vonage-pool-backup.json",
             "--numbers", *numbers, "--apply"]) != 0:
        print("Could not load the Vonage numbers onto the Vonage configuration. Send this output to Claude.")
        return 1
    sh(["docker", "cp", f"{API_CONTAINER}:/tmp/vonage-pool-backup.json", "/root/vonage-pool-backup.json"], check=False)

    with open(OVERRIDE, encoding="utf-8") as handle:
        original = handle.read()
    updated: Optional[str] = original
    env = {CALLER_ENV: caller_trunks_value(numbers)}
    for service in services:
        updated = add_mount_and_env(updated, service, f"{sources[0]}:{PROVIDER_PATH}:ro", env)
        if updated is None:
            break
    if updated is None:
        print(f"Could not edit {OVERRIDE} safely (an inline volumes/environment list?). Under each of\n"
              f"{', '.join(services)} it needs:\n    volumes:\n      - {sources[0]}:{PROVIDER_PATH}:ro\n"
              f'    environment:\n      {CALLER_ENV}: "{caller_trunks_value(numbers)}"')
        return 1
    override_backup = f"{OVERRIDE}.bak-vonage.{time.strftime('%Y%m%d%H%M%S')}"
    shutil.copy2(OVERRIDE, override_backup)
    with open(OVERRIDE, "w", encoding="utf-8") as handle:
        handle.write(updated)
    check = subprocess.run(["docker", "compose", "config", "--format", "json"], cwd=DOGRAH_DIR,
                           capture_output=True, text=True)
    missing = services
    if check.returncode == 0:
        mounted = services_mounting_provider(json.loads(check.stdout))
        missing = [svc for svc in services if svc not in mounted]
    if check.returncode != 0 or missing:
        shutil.copy2(override_backup, OVERRIDE)
        print(f"The edited override did not check out ({check.stderr.strip() or 'mount missing on ' + ', '.join(missing)}),\n"
              "so it was put back. Nothing running was changed. Send this output to Claude.")
        return 1
    print(f"Updated {OVERRIDE} (backup: {override_backup}). Not live until the restart.")

    header("6. Restart the Dograh API with caller-ID routing")
    print("After this, calls from the Vonage numbers go out over Vonage and every other call goes\n"
          f"out exactly as now. Restarting {', '.join(services)} drops AI calls in progress and can strand\n"
          "concurrency slots (deploy/dograh/README.md): pause running campaigns first if you can.")
    if not yes("Restart now?"):
        shutil.copy2(override_backup, OVERRIDE)
        print("Not restarted; the override was put back. Run this again when ready (it is safe to repeat).")
        return 0

    def roll_back(reason: str) -> int:
        print(f"\n{reason} Putting the override back and restarting...")
        shutil.copy2(override_backup, OVERRIDE)
        step(["docker", "compose", "up", "-d", "--no-deps", *services], cwd=DOGRAH_DIR)
        print("Rolled back: Dograh dials exactly as before. Send this output to Claude.")
        return 1

    if step(["docker", "compose", "up", "-d", "--no-deps", *services], cwd=DOGRAH_DIR) != 0:
        return roll_back("The restart failed.")
    time.sleep(8)
    routes = sh(["docker", "exec", API_CONTAINER, "printenv", CALLER_ENV], check=False).strip()
    patched = CALLER_MARKER in sh(["docker", "exec", API_CONTAINER, "cat", PROVIDER_PATH], check=False)
    print(f"{CALLER_ENV}={routes or '(unset)'}  caller-ID routing patch: {'yes' if patched else 'NO'}")
    if routes != caller_trunks_value(numbers) or not patched:
        return roll_back("Dograh did not come up with caller-ID routing.")

    header("7. Which campaign runs on Vonage?")
    # The restart recreated the container, and with it its /tmp.
    sh(["docker", "cp", helper, f"{API_CONTAINER}:/tmp/vonage_config.py"])
    print(sh(["docker", "exec", API_CONTAINER, "python", "/tmp/vonage_config.py", "list-campaigns"]))
    campaign = ask("Campaign id to run on Vonage (blank to do it later)", "")
    if campaign:
        if not campaign.isdigit():
            print("Not a number; no campaign was moved.")
        else:
            step(["docker", "exec", API_CONTAINER, "python", "/tmp/vonage_config.py", "assign-campaign",
                  "--campaign-id", campaign, "--tcid", vonage_tcid,
                  "--backup", "/tmp/vonage-campaign-backup.json"])
            sh(["docker", "cp", f"{API_CONTAINER}:/tmp/vonage-campaign-backup.json",
                "/root/vonage-campaign-backup.json"], check=False)

    header("Done")
    print(f"Vonage configuration: id {vonage_tcid}, caller IDs {', '.join(numbers)}.\n"
          f"Campaigns on configuration {vonage_tcid} dial over Vonage; everything else is unchanged.\n"
          f"To put another campaign on Vonage later, pick configuration {vonage_tcid} for it in Dograh,\n"
          "or run this again. Watch a call: docker logs -f dograh-asterisk 2>&1 | grep -i vonage\n"
          "Rollback: deploy/dograh/vonage-trunk/README.md -> Rollback.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print("\nCancelled.")
        sys.exit(130)
