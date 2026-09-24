"""Tests for the Dograh → Hopwhistle direct-transfer installer's pure pieces.

Run:  python -m pytest deploy/dograh/tests -q
Or:   python deploy/dograh/tests/test_direct_transfer.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "direct-transfer")
)

from install_direct_transfer import (  # noqa: E402
    DOGRAH_DESTINATION,
    MARK_BEGIN,
    MARK_END,
    extensions_block,
    host_path_for,
    parse_env,
    pick_fs_host,
    pjsip_block,
    replace_block,
)

EXISTING_PJSIP = "[fractel]\ntype=endpoint\ncontext=from-fractel\n"


def test_pjsip_block_points_at_freeswitch_external_profile():
    block = pjsip_block("178.156.223.97", 5080, None)
    assert "contact=sip:178.156.223.97:5080" in block
    assert "[hopwhistle]\ntype=aor" in block
    assert "[hopwhistle]\ntype=endpoint" in block
    assert "send_pai=yes" in block and "trust_id_outbound=yes" in block
    assert "transport=" not in block


def test_pjsip_block_names_transport_only_when_asked():
    assert "transport=transport-udp" in pjsip_block("10.0.0.1", 5080, "transport-udp")


def test_extensions_block_marks_the_call_and_sets_the_lead_as_caller():
    block = extensions_block()
    assert "[hopwhistle-transfer]" in block
    assert "Set(CALLERID(num)=${HW_LEAD})" in block
    assert "PJSIP_HEADER(add,X-Hopwhistle-Source)=dograh-transfer" in block
    assert "Dial(PJSIP/+${HW_DID}@hopwhistle," in block
    # The Dograh destination the README tells people to paste matches the context.
    assert DOGRAH_DESTINATION == (
        "Local/{{transfer_destination}}*{{called_number}}@hopwhistle-transfer/n"
    )


def test_replace_block_appends_once_and_keeps_existing_config():
    block = pjsip_block("10.0.0.1", 5080, None)
    once = replace_block(EXISTING_PJSIP, block)
    twice = replace_block(once, block)
    assert once == twice
    assert once.startswith(EXISTING_PJSIP)
    assert once.count(MARK_BEGIN) == 1 and once.count(MARK_END) == 1


def test_replace_block_updates_in_place_and_rolls_back_clean():
    first = replace_block(EXISTING_PJSIP, pjsip_block("10.0.0.1", 5080, None))
    second = replace_block(first, pjsip_block("10.0.0.2", 5080, None))
    assert "10.0.0.1" not in second and "10.0.0.2" in second
    assert replace_block(second, None).strip() == EXISTING_PJSIP.strip()


def test_replace_block_handles_file_without_trailing_newline():
    text = replace_block("[general]", extensions_block())
    assert text.startswith("[general]\n")


def test_fs_host_prefers_sip_public_ip_and_rejects_non_ips():
    env = parse_env("PUBLIC_IP=1.2.3.4\nSIP_PUBLIC_IP='5.6.7.8'\n")
    assert pick_fs_host(env) == "5.6.7.8"
    assert pick_fs_host(parse_env("SIP_PUBLIC_IP=\nPUBLIC_IP=1.2.3.4")) == "1.2.3.4"
    assert pick_fs_host(parse_env("PUBLIC_IP=example.com")) is None
    assert pick_fs_host({}) is None


def test_parse_env_ignores_comments_and_export():
    env = parse_env("# comment\nexport PUBLIC_IP=1.2.3.4\nBAD LINE\n")
    assert env == {"PUBLIC_IP": "1.2.3.4"}


def test_host_path_for_file_and_directory_mounts():
    file_mount = [{"Destination": "/etc/asterisk/pjsip.conf", "Source": "/opt/a/pjsip.conf"}]
    assert host_path_for(file_mount, "/etc/asterisk/pjsip.conf") == "/opt/a/pjsip.conf"
    assert host_path_for(file_mount, "/etc/asterisk/extensions.conf") is None

    dir_mount = [
        {"Destination": "/etc", "Source": "/srv/etc"},
        {"Destination": "/etc/asterisk", "Source": "/opt/dograh/asterisk"},
    ]
    assert (
        host_path_for(dir_mount, "/etc/asterisk/extensions.conf")
        == "/opt/dograh/asterisk/extensions.conf"
    )
    assert host_path_for([], "/etc/asterisk/pjsip.conf") is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
