#!/usr/bin/env python3
"""Route each Dograh ARI call to a trunk chosen by its caller ID.

For the Dograh release whose ``api/services/telephony/providers/ari/provider.py``
builds outbound endpoints with ``_pjsip_endpoint(to_number)`` (trunk from
``ARI_PJSIP_DEFAULT_TRUNK``). apply_ari_trunk_patch.py targets the older
release that hardcodes ``@fractel``.

With this patch, a call whose caller ID is listed in ``DOGRAH_ARI_CALLER_TRUNKS``
goes out on that number's trunk; every other call is dialled exactly as before.
That lets a Vonage campaign and a FracTEL campaign run at the same time, each
presenting its own carrier's numbers:

    DOGRAH_ARI_CALLER_TRUNKS="vonage/nanp11:+12017785210,+12019404210"

Format: ``trunk[/format]:number,number`` with ``;`` between trunks. ``format``
is how the destination and the caller ID are written for that trunk:
``nanp11`` -> 1XXXXXXXXXX (Vonage refuses a ``+``), ``nanp10`` -> XXXXXXXXXX,
``e164`` (default) -> as Dograh gave it. Only US numbers are matched, on their
last ten digits. A malformed value is ignored, never fatal: calls then go out
as if the variable were unset. Transfers are not touched.

Dry run by default; ``--apply`` writes a ``.bak-caller-trunk`` backup first and
refuses to write anything Python cannot compile. Exit 2 if the file is not the
release it expects.

    python3 apply_caller_trunk_patch.py --provider-file /opt/dograh-patches/ari-trunk/provider.py
    python3 apply_caller_trunk_patch.py --provider-file /opt/dograh-patches/ari-trunk/provider.py --apply
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import sys
from dataclasses import dataclass

MARKER = "HOPWHISTLE_ARI_CALLER_TRUNK_V1"

HELPER = f'''

# {MARKER}: choose the outbound trunk from the caller ID.
import os as _hw_os
import re as _hw_re


def _hw_caller_routes():
    routes = {{}}
    raw = _hw_os.environ.get("DOGRAH_ARI_CALLER_TRUNKS", "")
    for part in raw.split(";"):
        head, sep, numbers = part.partition(":")
        trunk, _, fmt = head.strip().partition("/")
        if not sep or not _hw_re.fullmatch(r"[A-Za-z0-9_.-]+", trunk or ""):
            continue
        fmt = (fmt or "e164").strip().lower()
        for n in numbers.split(","):
            digits = _hw_re.sub(r"\\D", "", n)[-10:]
            if len(digits) == 10:
                routes[digits] = (trunk, fmt)
    return routes


def _hw_format(number, fmt):
    digits = _hw_re.sub(r"\\D", "", number or "")
    if not _hw_re.fullmatch(r"1?\\d{{10}}", digits) or fmt not in ("nanp11", "nanp10"):
        return number
    return digits[-10:] if fmt == "nanp10" else "1" + digits[-10:]


def _hw_caller_route(caller):
    if not caller:
        return None
    try:
        return _hw_caller_routes().get(_hw_re.sub(r"\\D", "", caller)[-10:])
    except Exception:
        return None


def _hw_outbound_endpoint(to_number, caller):
    route = _hw_caller_route(caller)
    if not route:
        return _pjsip_endpoint(to_number)
    trunk, fmt = route
    return f"PJSIP/{{_hw_format(to_number, fmt)}}@{{trunk}}"


def _hw_outbound_caller_id(caller):
    route = _hw_caller_route(caller)
    return _hw_format(caller, route[1]) if route else caller
'''

# (old, new): each `old` must occur exactly once in the file.
REPLACEMENTS = [
    (
        "sip_endpoint = _pjsip_endpoint(to_number)",
        "sip_endpoint = _hw_outbound_endpoint(to_number, from_number)",
    ),
    (
        'params["callerId"] = from_number',
        'params["callerId"] = _hw_outbound_caller_id(from_number)',
    ),
]

ANCHOR = "def _pjsip_endpoint("


class PatchError(RuntimeError):
    pass


@dataclass
class Result:
    path: str
    changed: bool


def patch_source(source: str) -> str:
    if MARKER in source:
        return source
    if source.count(ANCHOR) != 1:
        raise PatchError(f"expected exactly one {ANCHOR!r}; this is not the Dograh release this patch targets")
    for old, _ in REPLACEMENTS:
        count = source.count(old)
        if count != 1:
            raise PatchError(f"expected exactly one occurrence of {old!r}, found {count}")
    for old, new in REPLACEMENTS:
        source = source.replace(old, new)
    # The helpers go before the first top-level class: after _pjsip_endpoint,
    # which they call, and before anything that calls them.
    match = re.search(r"^class ", source, flags=re.M)
    if not match:
        raise PatchError("no top-level class to insert the helpers before")
    at = match.start()
    return source[:at].rstrip("\n") + "\n" + HELPER + "\n\n" + source[at:]


def patch_file(path: str, apply: bool) -> Result:
    with open(path, encoding="utf-8") as handle:
        original = handle.read()
    patched = patch_source(original)
    compile(patched, path, "exec")  # never write a file Python cannot load
    changed = patched != original
    if changed and apply:
        backup = path + ".bak-caller-trunk"
        if not os.path.exists(backup):
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
