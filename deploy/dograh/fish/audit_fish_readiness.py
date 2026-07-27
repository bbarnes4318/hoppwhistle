"""Phase-1 runtime audit: what is actually deployed, and where TTS lives.

Run this **inside the Dograh api container** before changing anything. It is
read-only — it opens no WebSocket, writes no row, and prints no secret. Its job
is to turn the unknowns in the Fish integration plan into recorded facts:

  * Dograh version / commit / whether the tree is dirty (i.e. whether the
    running code survives a container rebuild).
  * Pipecat distribution, version, install path, and whether it is the
    upstream wheel or a fork checkout.
  * Whether ``pipecat.services.fish.tts`` exists and what its constructor
    contract is, plus whether ``ormsgpack`` / ``websockets`` are installed.
  * Where TTS provider configuration, API keys, models and voice IDs are
    stored, and what every workflow is currently configured to use.
  * Which source files mention a TTS provider by name (the hardcoded paths).

Usage::

    docker cp deploy/dograh/fish/. dograh-api-1:/tmp/fish-kit/
    docker exec dograh-api-1 python /tmp/fish-kit/audit_fish_readiness.py \
        > fish-audit-$(date +%F).json

Add ``--source-dump`` to also print the current text of the files the Fish
integration needs to edit, so they can be committed as tracked patch copies.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib
import inspect
import json
import os
import re
import subprocess
import sys

#: Files the Fish integration touches. Paths are relative to the Dograh app
#: root and are resolved against ``--app-root``.
TTS_SOURCE_FILES = (
    "api/services/pipecat/service_factory.py",
    "api/services/configuration/registry.py",
    "api/services/configuration/defaults.py",
    "scripts/setup_pipecat.sh",
)

TTS_SOURCE_DIRS = (
    "api/services/configuration/options",
    "api/services/pipecat",
)

#: Provider names worth grepping for when locating hardcoded TTS paths.
KNOWN_TTS_PROVIDERS = (
    "cartesia",
    "elevenlabs",
    "deepgram",
    "openai",
    "azure",
    "playht",
    "rime",
    "smallest",
    "fish",
)


def _run(cmd: list[str], cwd: str | None = None) -> str | None:
    try:
        out = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=20, check=False
        )
        return (out.stdout or out.stderr).strip() or None
    except Exception:
        return None


def audit_dograh(app_root: str) -> dict:
    git_dir = os.path.join(app_root, ".git")
    info: dict = {
        "app_root": app_root,
        "app_root_exists": os.path.isdir(app_root),
        "is_git_checkout": os.path.isdir(git_dir),
    }
    if info["is_git_checkout"]:
        info["commit"] = _run(["git", "rev-parse", "HEAD"], cwd=app_root)
        info["branch"] = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=app_root)
        info["remote"] = _run(["git", "remote", "get-url", "origin"], cwd=app_root)
        dirty = _run(["git", "status", "--porcelain"], cwd=app_root)
        info["dirty_files"] = dirty.splitlines() if dirty else []
        info["describe"] = _run(["git", "describe", "--tags", "--always"], cwd=app_root)
    # Anything bind-mounted over the image is a server-only change unless it is
    # also tracked in the Hopwhistle repo — that is exactly what we need to know.
    info["bind_mount_candidates"] = _bind_mounts(app_root)
    info["version_files"] = {
        name: _read_head(os.path.join(app_root, name))
        for name in ("VERSION", "version.txt", "pyproject.toml", "package.json")
        if os.path.exists(os.path.join(app_root, name))
    }
    return info


def _bind_mounts(app_root: str) -> list[str]:
    """Paths under the app root that come from a host mount, not the image."""
    mounts: list[str] = []
    try:
        with open("/proc/self/mountinfo", encoding="utf-8") as handle:
            for line in handle:
                parts = line.split()
                if len(parts) < 5:
                    continue
                mount_point = parts[4]
                if mount_point.startswith(app_root):
                    mounts.append(mount_point)
    except OSError:
        pass
    return sorted(set(mounts))


def _read_head(path: str, limit: int = 400) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return handle.read(limit)
    except OSError:
        return None


def audit_pipecat() -> dict:
    info: dict = {}
    try:
        import pipecat  # noqa: F401
    except Exception as exc:
        return {"importable": False, "error": repr(exc)}

    info["importable"] = True
    info["version"] = getattr(pipecat, "__version__", None)
    info["path"] = getattr(pipecat, "__file__", None)
    package_root = os.path.dirname(os.path.dirname(info["path"] or ""))
    info["is_editable_or_fork_checkout"] = os.path.isdir(os.path.join(package_root, ".git"))
    if info["is_editable_or_fork_checkout"]:
        info["fork_commit"] = _run(["git", "rev-parse", "HEAD"], cwd=package_root)
        info["fork_remote"] = _run(["git", "remote", "get-url", "origin"], cwd=package_root)

    for dist in ("pipecat-ai", "pipecat"):
        try:
            from importlib.metadata import version as dist_version

            info[f"dist_version[{dist}]"] = dist_version(dist)
        except Exception:
            continue

    # The single most important question: does the Fish service already exist?
    try:
        fish = importlib.import_module("pipecat.services.fish.tts")
        info["fish_module"] = fish.__file__
        service = getattr(fish, "FishAudioTTSService")
        settings = getattr(fish, "FishAudioTTSSettings", None)
        info["fish_available"] = True
        info["fish_service_signature"] = str(inspect.signature(service.__init__))
        info["fish_settings_fields"] = (
            [f.name for f in settings.__dataclass_fields__.values()] if settings else None
        )
        info["fish_base_url"] = getattr(service, "_base_url", None) or "see __init__"
        info["fish_supports_settings_kwarg"] = (
            "settings" in inspect.signature(service.__init__).parameters
        )
    except Exception as exc:
        info["fish_available"] = False
        info["fish_import_error"] = repr(exc)

    for dependency in ("ormsgpack", "websockets"):
        try:
            module = importlib.import_module(dependency)
            info[f"{dependency}_version"] = getattr(module, "__version__", "unknown")
        except Exception as exc:
            info[f"{dependency}_version"] = f"MISSING ({exc!r})"

    # TTSService kwargs the Dograh factory relies on.
    try:
        from pipecat.services.tts_service import TTSService

        params = inspect.signature(TTSService.__init__).parameters
        info["ttsservice_kwargs"] = sorted(params)
        info["supports_skip_aggregator_types"] = "skip_aggregator_types" in params
        info["supports_silence_time_s"] = "silence_time_s" in params
        info["supports_text_filters"] = "text_filters" in params
    except Exception as exc:
        info["ttsservice_error"] = repr(exc)
    return info


def audit_provider_enum() -> dict:
    """Find Dograh's provider enum and list its current members."""
    candidates = (
        "api.services.configuration.registry",
        "api.services.configuration.defaults",
        "api.enums",
    )
    found: dict = {"searched_modules": list(candidates), "enums": {}}
    for name in candidates:
        try:
            module = importlib.import_module(name)
        except Exception as exc:
            found["enums"][name] = f"import failed: {exc!r}"
            continue
        for attr in dir(module):
            obj = getattr(module, attr)
            if isinstance(obj, type) and issubclass(obj, __import__("enum").Enum):
                try:
                    members = {m.name: m.value for m in obj}
                except Exception:
                    continue
                if any("tts" in str(v).lower() or "cartesia" in str(v).lower() for v in members.values()) or "provider" in attr.lower():
                    found["enums"][f"{name}.{attr}"] = members
                    found.setdefault("module_files", {})[name] = getattr(module, "__file__", None)
    return found


def audit_source_references(app_root: str) -> dict:
    """Grep the deployed source for hardcoded provider names."""
    hits: dict[str, list[str]] = {provider: [] for provider in KNOWN_TTS_PROVIDERS}
    pattern = re.compile("|".join(KNOWN_TTS_PROVIDERS), re.IGNORECASE)
    scan_roots = [os.path.join(app_root, "api"), os.path.join(app_root, "ui", "src")]
    for root in scan_roots:
        if not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [
                d for d in dirnames if d not in {"node_modules", "__pycache__", ".next", ".git"}
            ]
            for filename in filenames:
                if not filename.endswith((".py", ".ts", ".tsx", ".js", ".jsx", ".sh")):
                    continue
                path = os.path.join(dirpath, filename)
                try:
                    with open(path, encoding="utf-8", errors="replace") as handle:
                        for lineno, line in enumerate(handle, 1):
                            for match in pattern.finditer(line):
                                provider = match.group(0).lower()
                                rel = os.path.relpath(path, app_root)
                                entry = f"{rel}:{lineno}"
                                if entry not in hits[provider]:
                                    hits[provider].append(entry)
                except OSError:
                    continue
    return {provider: sorted(paths)[:200] for provider, paths in hits.items() if paths}


async def audit_database(dsn: str | None) -> dict:
    """Where TTS provider/model/voice/API-key configuration actually lives."""
    if not dsn:
        return {"skipped": "DATABASE_URL not set"}
    try:
        import asyncpg
    except Exception as exc:
        return {"skipped": f"asyncpg unavailable: {exc!r}"}

    dsn = dsn.replace("postgresql+asyncpg://", "postgresql://")
    report: dict = {}
    conn = await asyncpg.connect(dsn=dsn)
    try:
        columns = await conn.fetch(
            """
            select table_name, column_name, data_type
            from information_schema.columns
            where table_schema = 'public'
              and (column_name ilike '%tts%'
                   or column_name ilike '%voice%'
                   or column_name ilike '%provider%'
                   or column_name ilike '%api_key%'
                   or column_name ilike '%config%')
            order by table_name, column_name
            """
        )
        report["candidate_columns"] = [
            {"table": r["table_name"], "column": r["column_name"], "type": r["data_type"]}
            for r in columns
        ]

        # Provider usage per workflow, without dumping any secret value.
        for table, column in _config_columns(report["candidate_columns"]):
            try:
                rows = await conn.fetch(
                    f"select {column} as cfg from {table} "
                    f"where {column} is not null limit 500"
                )
            except Exception:
                continue
            providers: dict[str, int] = {}
            for row in rows:
                cfg = row["cfg"]
                if isinstance(cfg, str):
                    try:
                        cfg = json.loads(cfg)
                    except ValueError:
                        continue
                provider = _extract_provider(cfg)
                if provider:
                    providers[provider] = providers.get(provider, 0) + 1
            if providers:
                report.setdefault("tts_provider_counts", {})[f"{table}.{column}"] = providers
    finally:
        await conn.close()
    return report


def _config_columns(candidates: list[dict]) -> list[tuple[str, str]]:
    return [
        (c["table"], c["column"])
        for c in candidates
        if c["type"] in ("json", "jsonb") or "config" in c["column"]
    ]


def _extract_provider(cfg) -> str | None:
    if not isinstance(cfg, dict):
        return None
    tts = cfg.get("tts")
    if isinstance(tts, dict) and tts.get("provider"):
        return str(tts["provider"])
    if cfg.get("provider") and "voice" in json.dumps(cfg).lower():
        return str(cfg["provider"])
    return None


def dump_sources(app_root: str) -> dict:
    """Current text of the files the Fish integration edits.

    Committing these alongside the patched copies is what keeps the production
    change tracked instead of server-only.
    """
    dumped: dict[str, str | None] = {}
    for rel in TTS_SOURCE_FILES:
        path = os.path.join(app_root, rel)
        dumped[rel] = _read_head(path, limit=400_000) if os.path.exists(path) else None
    for rel_dir in TTS_SOURCE_DIRS:
        directory = os.path.join(app_root, rel_dir)
        if not os.path.isdir(directory):
            continue
        for filename in sorted(os.listdir(directory)):
            if filename.endswith(".py"):
                rel = os.path.join(rel_dir, filename)
                dumped[rel] = _read_head(os.path.join(app_root, rel), limit=400_000)
    return dumped


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-root", default=os.environ.get("DOGRAH_APP_ROOT", "/app"))
    parser.add_argument("--source-dump", action="store_true")
    parser.add_argument("--skip-db", action="store_true")
    args = parser.parse_args()

    report = {
        "audit_version": 1,
        "python": sys.version,
        "dograh": audit_dograh(args.app_root),
        "pipecat": audit_pipecat(),
        "provider_enums": audit_provider_enum(),
        "hardcoded_provider_references": audit_source_references(args.app_root),
        "database": (
            {"skipped": "--skip-db"}
            if args.skip_db
            else await audit_database(os.environ.get("DATABASE_URL"))
        ),
        "fish_env_present": {
            "FISH_AUDIO_API_KEY": bool(os.environ.get("FISH_AUDIO_API_KEY")),
            "FISH_AUDIO_DEFAULT_VOICE_ID": bool(os.environ.get("FISH_AUDIO_DEFAULT_VOICE_ID")),
            "PRIMARY_TTS_PROVIDER": os.environ.get("PRIMARY_TTS_PROVIDER"),
            "FALLBACK_TTS_PROVIDER": os.environ.get("FALLBACK_TTS_PROVIDER"),
        },
    }
    if args.source_dump:
        report["source_dump"] = dump_sources(args.app_root)

    print(json.dumps(report, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
