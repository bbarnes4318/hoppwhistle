#!/usr/bin/env python3
"""One command: make Dograh's call-results pages load fast. Run ON THE SERVER as root.

    cd /opt/hopwhistle && git pull && ./fix-dograh-runs-page.sh

Two independent fixes (see README.md beside this file):

  1. Indexes on workflow_runs -- built CONCURRENTLY while Dograh keeps running.
     No restart, no lock, nothing a live call notices. Done every time.
  2. A code patch so the lists stop loading each call's full log JSON and the
     agent's whole graph per row. Needs the Dograh API restarted, which drops AI
     calls in progress -- so it asks first (or pass --restart / --no-restart).

Safe to re-run. Anything that does not check out is put back as it was.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from typing import Dict, List, Optional

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "..", "vonage-trunk"))

from runs_page_patch import MARKER, TARGETS, patch_file  # noqa: E402
from setup_vonage import add_mount_and_env  # noqa: E402

DOGRAH_DIR = os.environ.get("DOGRAH_DIR", "/opt/dograh")
OVERRIDE = os.path.join(DOGRAH_DIR, "docker-compose.override.yaml")
API_CONTAINER = os.environ.get("DOGRAH_CONTAINER", "dograh-api-1")
AST_CONTAINER = os.environ.get("DOGRAH_ASTERISK", "dograh-asterisk")
API_SERVICE = "api"
PATCH_DIR = "/opt/dograh-patches/runs-page-speedup"


def sh(cmd: List[str], cwd: Optional[str] = None, check: bool = True) -> str:
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    output = (result.stdout or "") + (result.stderr or "")
    if check and result.returncode != 0:
        raise SystemExit(f"\nFAILED: {' '.join(cmd)}\n{output}")
    return output


def step(cmd: List[str], cwd: Optional[str] = None) -> int:
    return subprocess.run(cmd, cwd=cwd).returncode


def header(text: str) -> None:
    print(f"\n=== {text} " + "=" * max(0, 60 - len(text)))


def mounted_sources(config: dict, service: str) -> Dict[str, str]:
    """{container path: host source} for the bind mounts on ``service``."""
    out = {}
    for vol in (config.get("services") or {}).get(service, {}).get("volumes") or []:
        if isinstance(vol, dict) and vol.get("target") and vol.get("source"):
            out[vol["target"]] = vol["source"]
    return out


def compose_config() -> Optional[dict]:
    result = subprocess.run(["docker", "compose", "config", "--format", "json"], cwd=DOGRAH_DIR,
                            capture_output=True, text=True)
    return json.loads(result.stdout) if result.returncode == 0 else None


def live_calls() -> str:
    out = sh(["docker", "exec", AST_CONTAINER, "asterisk", "-rx", "core show channels count"], check=False)
    for line in out.splitlines():
        if "active call" in line:
            return line.split()[0]
    return "?"


def api_healthy(timeout: int = 90) -> bool:
    """The API answers /api/v1/health and the patched files are the ones loaded."""
    probe = ("import urllib.request;"
             "urllib.request.urlopen('http://localhost:8000/api/v1/health', timeout=5).read()")
    deadline = time.time() + timeout
    while time.time() < deadline:
        if subprocess.run(["docker", "exec", API_CONTAINER, "python", "-c", probe],
                          capture_output=True).returncode == 0:
            return True
        time.sleep(3)
    return False


def build_indexes() -> bool:
    header("1. Indexes (no restart)")
    script = os.path.join(HERE, "runs_page_indexes.py")
    sh(["docker", "cp", script, f"{API_CONTAINER}:/tmp/runs_page_indexes.py"])
    ok = step(["docker", "exec", API_CONTAINER, "python", "/tmp/runs_page_indexes.py", "--apply"]) == 0
    sh(["docker", "exec", API_CONTAINER, "rm", "-f", "/tmp/runs_page_indexes.py"], check=False)
    print("Indexes in place; the lists are already faster." if ok else
          "Index build did not finish; nothing else was changed by it. Re-run this script.")
    return ok


def patch_code(restart: Optional[bool]) -> int:
    header("2. Lean list queries (needs an API restart)")
    if not os.path.isfile(OVERRIDE):
        print(f"No {OVERRIDE}; skipping the code patch (the indexes above still apply).")
        return 1
    config = compose_config()
    if config is None or API_SERVICE not in (config.get("services") or {}):
        print(f"No '{API_SERVICE}' service in {DOGRAH_DIR}'s compose config; code patch skipped.")
        return 1
    already = mounted_sources(config, API_SERVICE)

    os.makedirs(PATCH_DIR, exist_ok=True)
    to_mount: Dict[str, str] = {}   # container path -> host path
    patched: List[str] = []
    for container_path, (name, edits) in TARGETS.items():
        if container_path in already:
            host = already[container_path]   # someone mounts this file already: patch that copy
        else:
            host = os.path.join(PATCH_DIR, name)
            sh(["docker", "cp", f"{API_CONTAINER}:{container_path}", host])
            to_mount[container_path] = host
        result = patch_file(host, edits, apply=True)
        print(f"  {container_path}: {result.state}" + (f" -- {result.detail}" if result.detail else ""))
        if result.state == "refused":
            to_mount.pop(container_path, None)
        else:
            patched.append(container_path)
    if not patched:
        print("This Dograh release does not match the patch; nothing changed. Send this output to Claude.")
        return 1

    with open(OVERRIDE, encoding="utf-8") as handle:
        original = handle.read()
    updated: Optional[str] = original
    for container_path, host in to_mount.items():
        updated = add_mount_and_env(updated, API_SERVICE, f"{host}:{container_path}:ro", {})
        if updated is None:
            print(f"Could not edit {OVERRIDE} safely. Under services.{API_SERVICE}.volumes add:\n" +
                  "\n".join(f"  - {h}:{c}:ro" for c, h in to_mount.items()))
            return 1
    backup = None
    if updated != original:
        backup = f"{OVERRIDE}.bak-runs-page.{time.strftime('%Y%m%d%H%M%S')}"
        shutil.copy2(OVERRIDE, backup)
        with open(OVERRIDE, "w", encoding="utf-8") as handle:
            handle.write(updated)
        check = compose_config()
        missing = [c for c in to_mount if check is None or c not in mounted_sources(check, API_SERVICE)]
        if missing:
            shutil.copy2(backup, OVERRIDE)
            print(f"The edited override did not check out (missing: {', '.join(missing) or 'compose error'});\n"
                  "it was put back. Nothing running changed. Send this output to Claude.")
            return 1
        print(f"Updated {OVERRIDE} (backup: {backup}). Not live until the API restarts.")

    loaded = sh(["docker", "exec", API_CONTAINER, "grep", "-l", MARKER, *patched], check=False)
    if all(p in loaded for p in patched):
        print("The running API already has the patch.")
        return 0

    calls = live_calls()
    print(f"\nRestarting the Dograh API drops AI calls in progress (Asterisk shows {calls} active now)\n"
          "and can strand concurrency slots (deploy/dograh/README.md). Best between campaigns.")
    if restart is None:
        restart = input("Restart the Dograh API now? (y/N): ").strip().lower() in ("y", "yes")
    if not restart:
        print("Not restarted. The patch is staged and goes live on the next API restart:\n"
              f"  cd {DOGRAH_DIR} && docker compose up -d --no-deps {API_SERVICE}\n"
              "or re-run this script and answer y.")
        return 0

    def roll_back(reason: str) -> int:
        print(f"\n{reason} Putting the override back and restarting...")
        if backup:
            shutil.copy2(backup, OVERRIDE)
        for container_path in already:
            bak = already[container_path] + ".bak-runs-page"
            if container_path in patched and os.path.exists(bak):
                shutil.copy2(bak, already[container_path])
        step(["docker", "compose", "up", "-d", "--no-deps", API_SERVICE], cwd=DOGRAH_DIR)
        print("Rolled back: Dograh runs exactly as before (the indexes stay; they are harmless).")
        return 1

    if step(["docker", "compose", "up", "-d", "--no-deps", API_SERVICE], cwd=DOGRAH_DIR) != 0:
        return roll_back("The restart failed.")
    if not api_healthy():
        return roll_back("The API did not answer /api/v1/health after the restart.")
    loaded = sh(["docker", "exec", API_CONTAINER, "grep", "-l", MARKER, *patched], check=False)
    if not all(p in loaded for p in patched):
        return roll_back("The API came up without the patched files.")
    print("Dograh API is back up with the lean list queries.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--restart", action="store_true", help="restart the API without asking")
    group.add_argument("--no-restart", action="store_true", help="stage the patch, do not restart")
    parser.add_argument("--indexes-only", action="store_true", help="only build the indexes")
    args = parser.parse_args()

    if os.geteuid() != 0:
        print("Run as root.")
        return 1
    if not shutil.which("docker"):
        print("No docker here; run this ON THE SERVER.")
        return 1
    if API_CONTAINER not in sh(["docker", "ps", "--format", "{{.Names}}"]).split():
        print(f"The Dograh api container ({API_CONTAINER}) is not running. DOGRAH_CONTAINER=<name> to override.")
        return 1

    ok = build_indexes()
    if args.indexes_only:
        return 0 if ok else 2
    restart = True if args.restart else (False if args.no_restart else None)
    rc = patch_code(restart)

    header("Done")
    print("Open Voice Agents -> an agent's runs / a campaign / Agent Runs. Pages that took minutes\n"
          "should now load in about a second. Rollback: deploy/dograh/runs-page-speedup/README.md.")
    return 0 if ok and rc == 0 else 2


if __name__ == "__main__":
    raise SystemExit(main())
