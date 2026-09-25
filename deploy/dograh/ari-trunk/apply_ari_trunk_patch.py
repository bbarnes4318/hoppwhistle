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
  * outbound number prefix: ``DOGRAH_ARI_DIAL_PREFIX`` (default empty, i.e.
    unchanged). Anveo Direct picks the trunk from a tech prefix in front of
    the number, so with ``012345`` a call to +15551234567 dials
    ``PJSIP/01234515551234567@<trunk>``. Transfers never get the prefix.

A file already carrying the first version of this patch is upgraded in place.

Dry run by default. ``--apply`` writes a ``.bak-ari-trunk`` backup first. Running
it again reports ``already_patched``. It refuses (exit 2) if the file does not
contain exactly the code it expects, rather than guessing.

    python3 apply_ari_trunk_patch.py --provider-file /opt/dograh-patches/ari-trunk/provider.py
    python3 apply_ari_trunk_patch.py --provider-file /opt/dograh-patches/ari-trunk/provider.py --apply
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from dataclasses import dataclass

MARKER = "HOPWHISTLE_ARI_TRUNK_V1"
MARKER_V2 = "HOPWHISTLE_ARI_DIAL_PREFIX_V2"

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

HELPER_V2 = f'''

# {MARKER_V2}: optional tech prefix in front of outbound numbers (Anveo Direct).
def _hw_dial_number(number: str) -> str:
    prefix = _hw_re.sub(r"\\D", "", _hw_os.environ.get("DOGRAH_ARI_DIAL_PREFIX", ""))
    if not prefix:
        return number
    digits = _hw_re.sub(r"\\D", "", number)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return number  # not a NANP number: leave it alone
    return f"{{prefix}}1{{digits}}"
'''

V2_REPLACEMENT = (
    'f"PJSIP/{to_number}@{_hw_ari_trunk()}"',
    'f"PJSIP/{_hw_dial_number(to_number)}@{_hw_ari_trunk()}"',
)

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


def _insert_before_first_def(source: str, helper: str) -> str:
    # Helpers go after the module's imports, before the first top-level
    # definition, so they are defined before anything calls them.
    match = re.search(r"^(class |def |async def |@)", source, flags=re.M)
    if not match:
        raise PatchError("no top-level class or function to insert the helper before")
    at = match.start()
    return source[:at].rstrip("\n") + "\n" + helper + "\n\n" + source[at:]


def patch_v1(source: str) -> str:
    if MARKER in source:
        return source
    for old, _ in REPLACEMENTS:
        count = source.count(old)
        if count != 1:
            raise PatchError(f"expected exactly one occurrence of {old!r}, found {count}")
    for old, new in REPLACEMENTS:
        source = source.replace(old, new)
    return _insert_before_first_def(source, HELPER)


def patch_source(source: str) -> str:
    source = patch_v1(source)
    if MARKER_V2 in source:
        return source
    old, new = V2_REPLACEMENT
    count = source.count(old)
    if count != 1:
        raise PatchError(f"expected exactly one occurrence of {old!r}, found {count}")
    source = source.replace(old, new)
    # V1's helper imports _hw_os/_hw_re before its first def, so V2's helper,
    # inserted before that def, can use them.
    return _insert_before_first_def(source, HELPER_V2)


def patch_file(path: str, apply: bool) -> Result:
    with open(path, encoding="utf-8") as handle:
        original = handle.read()
    patched = patch_source(original)
    compile(patched, path, "exec")  # never write a file Python cannot load
    changed = patched != original
    if changed and apply:
        # Keep the very first backup: it is the unpatched original.
        backup = path + ".bak-ari-trunk"
        if os.path.exists(backup):
            backup = path + ".bak-ari-trunk-v2"
        shutil.copy2(path, backup)
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
