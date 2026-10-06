"""Tests for setup_vonage.py's pure helpers and the installer's --env-file parsing.

Run:  python deploy/dograh/tests/test_vonage_setup.py
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vonage-trunk"))

from install_vonage_trunk import env_file_vonage_settings  # noqa: E402
from setup_vonage import (  # noqa: E402
    PROVIDER_PATH,
    add_mount_and_trunk,
    api_image_services,
    env_value,
    services_mounting_provider,
    set_ari_env,
    update_env,
    us_numbers,
    valid_credential,
)

FAKE_SECRET = "fake(Secret)*^0"


def test_credentials_with_symbols_are_accepted_but_breaking_chars_are_not():
    assert valid_credential("abcd1234") and valid_credential(FAKE_SECRET)
    for bad in ("", "a b", "a'b", 'a"b', "a$b", "a#b", "a;b", "a\\b", "a`b"):
        assert not valid_credential(bad), bad


def test_us_numbers_from_vonage_payload():
    payload = {"count": 3, "numbers": [
        {"msisdn": "18655550100", "country": "US"},
        {"msisdn": "447700900000", "country": "GB"},
        {"msisdn": "18655550100", "country": "US"},
        {"msisdn": "10125550100", "country": "US"},
    ]}
    assert us_numbers(payload) == ["+18655550100"]
    assert us_numbers({}) == []


def test_update_env_replaces_only_vonage_lines():
    text = "FOO=1\nVONAGE_API_KEY=old\nVONAGE_SIP_PASSWORD=old\nBAR=2"
    out = update_env(text, {"VONAGE_API_KEY": "k", "VONAGE_SIP_PASSWORD": FAKE_SECRET})
    assert out == f"FOO=1\nBAR=2\nVONAGE_API_KEY=k\nVONAGE_SIP_PASSWORD={FAKE_SECRET}\n"
    assert env_value(out, "VONAGE_SIP_PASSWORD") == FAKE_SECRET
    assert env_value('PUBLIC_IP="1.2.3.4"', "PUBLIC_IP") == "1.2.3.4"


def test_installer_reads_written_env_file():
    out = update_env("", {"VONAGE_SIP_USERNAME": "k", "VONAGE_SIP_PASSWORD": FAKE_SECRET,
                          "VONAGE_SIP_PROXY": "sip.nexmo.com"})
    env = env_file_vonage_settings(out + "VONAGE_API_KEY=x\nexport VONAGE_SIP_REALM='r.example.com'\n")
    assert env == {"VONAGE_SIP_USERNAME": "k", "VONAGE_SIP_PASSWORD": FAKE_SECRET,
                   "VONAGE_SIP_PROXY": "sip.nexmo.com", "VONAGE_SIP_REALM": "r.example.com"}


def test_set_ari_env_map_style():
    text = ("services:\n  api:\n    environment:\n      DOGRAH_ARI_TRUNK: anveo\n"
            "      DOGRAH_ARI_DIAL_PREFIX: \"012345\"\n      OTHER: 1\n")
    out, n = set_ari_env(text)
    assert n == 1
    assert out == ("services:\n  api:\n    environment:\n      DOGRAH_ARI_TRUNK: vonage\n"
                   "      DOGRAH_ARI_DIAL_FORMAT: nanp11\n      DOGRAH_ARI_TRANSFER_TRUNK: fractel\n"
                   "      OTHER: 1\n")
    assert set_ari_env(out) == (out, 1)  # idempotent


def test_set_ari_env_list_style_keeps_existing_transfer_trunk_and_comments():
    text = ("services:\n  api:\n    environment:\n      - DOGRAH_ARI_TRUNK=twilio\n"
            "      - DOGRAH_ARI_TRANSFER_TRUNK=twilio\n  # DOGRAH_ARI_TRUNK: fractel\n")
    out, n = set_ari_env(text)
    assert n == 1
    assert "      - DOGRAH_ARI_TRUNK=vonage\n      - DOGRAH_ARI_DIAL_FORMAT=nanp11\n" in out
    assert "DOGRAH_ARI_TRANSFER_TRUNK=twilio" in out and "TRANSFER_TRUNK=fractel" not in out
    assert "  # DOGRAH_ARI_TRUNK: fractel" in out


def test_set_ari_env_turns_state_matching_off():
    text = ("services:\n  api:\n    environment:\n      DOGRAH_ARI_TRUNK: fractel\n"
            "      DOGRAH_STATE_CID_POLICY: strict\n")
    out, n = set_ari_env(text)
    assert n == 1 and "      DOGRAH_STATE_CID_POLICY: \"off\"\n" in out and "strict" not in out
    listed, _ = set_ari_env("    environment:\n      - DOGRAH_ARI_TRUNK=x\n      - DOGRAH_STATE_CID_POLICY=prefer\n")
    assert "      - DOGRAH_STATE_CID_POLICY=off\n" in listed


def test_set_ari_env_without_trunk_changes_nothing():
    text = "services:\n  api:\n    image: x\n"
    assert set_ari_env(text) == (text, 0)


def test_services_mounting_provider():
    config = {"services": {
        "api": {"volumes": [{"type": "bind", "source": "/opt/p/provider.py", "target": PROVIDER_PATH}]},
        "worker": {"volumes": [{"type": "bind", "source": "/x", "target": "/y"}]},
        "redis": {},
    }}
    assert services_mounting_provider(config) == {"api": "/opt/p/provider.py"}


VOL = "/opt/dograh-patches/ari-trunk/provider.py:" + PROVIDER_PATH + ":ro"


def _vonage(text, service="api"):
    out = add_mount_and_trunk(text, service, VOL)
    assert out is not None
    return set_ari_env(out)


def test_mount_added_to_existing_volumes_and_environment_map():
    text = ("services:\n"
            "  api:\n"
            "    volumes:\n"
            "      - /opt/dograh-patches/campaign_call_dispatcher.py:/app/x.py:ro\n"
            "    environment:\n"
            "      DOGRAH_STATE_CID_POLICY: strict\n"
            "  redis:\n"
            "    image: redis\n")
    out, n = _vonage(text)
    assert n == 1
    assert out == ("services:\n"
                   "  api:\n"
                   "    volumes:\n"
                   f"      - {VOL}\n"
                   "      - /opt/dograh-patches/campaign_call_dispatcher.py:/app/x.py:ro\n"
                   "    environment:\n"
                   "      DOGRAH_ARI_TRUNK: vonage\n"
                   "      DOGRAH_ARI_DIAL_FORMAT: nanp11\n"
                   "      DOGRAH_ARI_TRANSFER_TRUNK: fractel\n"
                   "      DOGRAH_STATE_CID_POLICY: \"off\"\n"
                   "  redis:\n"
                   "    image: redis\n")
    # Running again changes nothing more.
    again = add_mount_and_trunk(out, "api", VOL)
    assert set_ari_env(again)[0] == out


def test_mount_added_with_list_environment_and_dash_at_key_indent():
    text = ("services:\n"
            "  api:\n"
            "    image: dograh/api\n"
            "    volumes:\n"
            "    - /a:/b\n"
            "    environment:\n"
            "      - FOO=1\n")
    out, n = _vonage(text)
    assert n == 1
    assert f"    volumes:\n    - {VOL}\n    - /a:/b\n" in out
    assert "    environment:\n      - DOGRAH_ARI_TRUNK=vonage\n      - DOGRAH_ARI_DIAL_FORMAT=nanp11\n" in out
    assert "      - FOO=1" in out


def test_missing_keys_and_missing_service_are_created():
    text = "services:\n  api:\n    restart: always\n  worker:\n    restart: always\nvolumes:\n  data: {}\n"
    out = add_mount_and_trunk(text, "api", VOL)
    out = add_mount_and_trunk(out, "campaign", VOL)
    out, n = set_ari_env(out)
    assert n == 2
    assert ("  api:\n    restart: always\n    volumes:\n"
            f"      - {VOL}\n    environment:\n      DOGRAH_ARI_TRUNK: vonage\n") in out
    assert out.startswith(f"services:\n  campaign:\n    volumes:\n      - {VOL}\n")
    assert out.endswith("volumes:\n  data: {}\n")  # top-level volumes untouched


def test_inline_lists_are_refused():
    assert add_mount_and_trunk("services:\n  api:\n    volumes: [\"/a:/b\"]\n", "api", VOL) is None
    assert add_mount_and_trunk("services:\n  api:\n    environment: {A: 1}\n", "api", VOL) is None
    assert add_mount_and_trunk("version: '3'\n", "api", VOL) is None


def test_api_image_services():
    config = {"services": {"api": {"image": "dograh/api:1"}, "worker": {"image": "dograh/api:1"},
                           "ui": {"image": "dograh/ui:1"}}}
    assert api_image_services(config) == ["api", "worker"]
    assert api_image_services({"services": {"ui": {}}}) == []


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
