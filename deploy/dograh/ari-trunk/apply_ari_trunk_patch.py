#!/usr/bin/env python3
"""Let Dograh's ARI provider dial a trunk other than FracTEL.

The deployed Dograh's ``api/services/telephony/providers/ari/provider.py``
builds every ARI endpoint as ``PJSIP/<number>@fractel``, once for outbound AI
calls and once for transfers. Two consequences:

  * outbound AI calls cannot use the Twilio trunk (deploy/dograh/twilio-trunk);
  * a destination is only passed through untouched when it starts with
    ``SIP/`` or ``PJSIP/``, so the direct-transfer destination
    ``Local/...@hopwhistle-transfer/n`` became ``PJSIP/Local/...`` and failed.

This patch, applied to a staged copy of that file exactly like the other
``/opt/dograh-patches`` files, makes the trunk an environment setting and lets
any channel technology through:

  * outbound calls: ``DOGRAH_ARI_TRUNK`` (default ``fractel``, i.e. unchanged)
  * transfers:      ``DOGRAH_ARI_TRANSFER_TRUNK`` (default: DOGRAH_ARI_TRUNK)
  * ``Local/``, ``IAX2/`` and any other ``Tech/...`` destination is dialled as written.

Dry run by default. ``--apply`` writes a ``.bak-ari-trunk`` backup first. Running
it again reports ``already_patched``. It refuses (exit 2) if the file does not
contain exactly the code it expects, rather than guessing.

    python3 apply_ari_trunk_patch.py --provider-file /opt/dograh-patches/ari-trunk/provider.py
    python3 apply_ari_trunk_patch.py --provider-file /opt/dograh-patches/ari-trunk/provider.py --apply
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from dataclasses import dataclass

MARKER = "HOPWHISTLE_ARI_TRUNK_V1"

HELPER = f'''

# {MARKER}: the trunk ARI dials is a setting, not a hardcoded "fractel".
import os as _hw_os
import re as _hw_re

_HW_TECH_PREFIX = _hw_re.compile(r"^[A-Za-z][A-Za-z0-9]*/")


def _hw_ari_trunk(kind: str = "outbound") -> str:
    default = _hw_os.environ.get("DOGRAH_ARI_TRUNK", "fractel").strip() or "fractel"
    if kind == "transfer":
        return _hw_os.environ.get("DOGRAH_ARI_TRANSFER_TRUNK", default).strip() or default
    return default


def _hw_has_tech(destination: str) -> bool:
    """SIP/, PJSIP/, Local/, IAX2/ ...: already a dial string, dial it as written."""
    return bool(_HW_TECH_PREFIX.match(destination.strip()))
'''

# (old, new) pairs. Each `old` must occur exactly once.
REPLACEMENTS = [
    (
        'if to_number.startswith("SIP/") or to_number.startswith("PJSIP/"):',
        "if _hw_has_tech(to_number):",
    ),
    (
        'f"PJSIP/{to_number}@fractel"',
        'f"PJSIP/{to_number}@{_hw_ari_trunk()}"',
    ),
    (
        'if destination.startswith("SIP/") or destination.startswith("PJSIP/"):',
        "if _hw_has_tech(destination):",
    ),
    (
        'f"PJSIP/{destination}@fractel"',
        "f\"PJSIP/{destination}@{_hw_ari_trunk('transfer')}\"",
    ),
]


class PatchError(RuntimeError):
    pass


@dataclass
class Result:
    path: str
    changed: bool


def patch_source(source: str) -> str:
    if MARKER in source:
        return source
    for old, _ in REPLACEMENTS:
        count = source.count(old)
        if count != 1:
            raise PatchError(f"expected exactly one occurrence of {old!r}, found {count}")
    for old, new in REPLACEMENTS:
        source = source.replace(old, new)

    # The helper goes after the module's imports, before the first top-level
    # definition, so it is defined before anything calls it.
    match = re.search(r"^(class |def |async def |@)", source, flags=re.M)
    if not match:
        raise PatchError("no top-level class or function to insert the helper before")
    at = match.start()
    return source[:at].rstrip("\n") + "\n" + HELPER + "\n\n" + source[at:]


def patch_file(path: str, apply: bool) -> Result:
    with open(path, encoding="utf-8") as handle:
        original = handle.read()
    patched = patch_source(original)
    compile(patched, path, "exec")  # never write a file Python cannot load
    changed = patched != original
    if changed and apply:
        shutil.copy2(path, path + ".bak-ari-trunk")
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(patched)
    return Result(path, changed)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--provider-file", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    try:
        result = patch_file(args.provider_file, args.apply)
    except (PatchError, SyntaxError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    mode = "APPLIED" if args.apply else "DRY_RUN"
    state = (
        "would_change" if result.changed and not args.apply
        else "changed" if result.changed
        else "already_patched"
    )
    print(f"{mode} {result.path}: {state}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
