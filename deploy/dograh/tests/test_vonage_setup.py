"""Tests for setup_vonage.py's pure helpers and the installer's --env-file parsing.

Run:  python deploy/dograh/tests/test_vonage_setup.py
"""

from __future__ import annotations

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "vonage-trunk"))

from install_vonage_trunk import env_file_vonage_settings  # noqa: E402
from vonage_config import copy_expressions, last10  # noqa: E402
from setup_vonage import (  # noqa: E402
    PROVIDER_PATH,
    add_mount_and_env,
    api_image_services,
    caller_trunks_value,
    env_value,
    services_mounting_provider,
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


def test_services_mounting_provider():
    config = {"services": {
        "api": {"volumes": [{"type": "bind", "source": "/opt/p/provider.py", "target": PROVIDER_PATH}]},
        "worker": {"volumes": [{"type": "bind", "source": "/x", "target": "/y"}]},
        "redis": {},
    }}
    assert services_mounting_provider(config) == {"api": "/opt/p/provider.py"}


VOL = "/opt/dograh-patches/ari-trunk/provider.py:" + PROVIDER_PATH + ":ro"


ENV = {"DOGRAH_ARI_CALLER_TRUNKS": caller_trunks_value(["+12017785210", "+12019404210"])}
VALUE = "vonage/nanp11:+12017785210,+12019404210"


def test_mount_and_env_added_to_existing_map_sections_and_updated_on_rerun():
    text = ("services:\n"
            "  api:\n"
            "    volumes:\n"
            "      - /opt/dograh-patches/campaign_call_dispatcher.py:/app/x.py:ro\n"
            "    environment:\n"
            "      DOGRAH_STATE_CID_POLICY: strict\n"
            "  redis:\n"
            "    image: redis\n")
    out = add_mount_and_env(text, "api", VOL, ENV)
    assert out == ("services:\n"
                   "  api:\n"
                   "    volumes:\n"
                   f"      - {VOL}\n"
                   "      - /opt/dograh-patches/campaign_call_dispatcher.py:/app/x.py:ro\n"
                   "    environment:\n"
                   f'      DOGRAH_ARI_CALLER_TRUNKS: "{VALUE}"\n'
                   "      DOGRAH_STATE_CID_POLICY: strict\n"
                   "  redis:\n"
                   "    image: redis\n")
    assert add_mount_and_env(out, "api", VOL, ENV) == out  # idempotent
    more = add_mount_and_env(out, "api", VOL, {"DOGRAH_ARI_CALLER_TRUNKS": "vonage/nanp11:+12017785210"})
    assert more.count("DOGRAH_ARI_CALLER_TRUNKS") == 1
    assert 'DOGRAH_ARI_CALLER_TRUNKS: "vonage/nanp11:+12017785210"\n' in more


def test_list_style_environment_and_dash_at_key_indent():
    text = ("services:\n"
            "  api:\n"
            "    image: dograh/api\n"
            "    volumes:\n"
            "    - /a:/b\n"
            "    environment:\n"
            "      - FOO=1\n")
    out = add_mount_and_env(text, "api", VOL, ENV)
    assert f"    volumes:\n    - {VOL}\n    - /a:/b\n" in out
    assert f"    environment:\n      - DOGRAH_ARI_CALLER_TRUNKS={VALUE}\n      - FOO=1\n" in out


def test_missing_sections_and_missing_service_are_created():
    text = "services:\n  api:\n    restart: always\n  worker:\n    restart: always\nvolumes:\n  data: {}\n"
    out = add_mount_and_env(text, "api", VOL, ENV)
    out = add_mount_and_env(out, "campaign", VOL, ENV)
    assert ("  api:\n    restart: always\n    volumes:\n"
            f'      - {VOL}\n    environment:\n      DOGRAH_ARI_CALLER_TRUNKS: "{VALUE}"\n') in out
    assert out.startswith(f'services:\n  campaign:\n    volumes:\n      - {VOL}\n    environment:\n'
                          f'      DOGRAH_ARI_CALLER_TRUNKS: "{VALUE}"\n')
    assert out.endswith("volumes:\n  data: {}\n")  # top-level volumes untouched


def test_inline_lists_are_refused():
    assert add_mount_and_env("services:\n  api:\n    volumes: [\"/a:/b\"]\n", "api", VOL, ENV) is None
    assert add_mount_and_env("services:\n  api:\n    environment: {A: 1}\n", "api", VOL, ENV) is None
    assert add_mount_and_env("version: '3'\n", "api", VOL, ENV) is None


def test_edited_override_is_valid_yaml():
    try:
        import yaml
    except ImportError:
        return
    text = "services:\n  api:\n    environment:\n      - FOO=1\n  worker:\n    image: w\n"
    out = add_mount_and_env(add_mount_and_env(text, "api", VOL, ENV), "worker", VOL, ENV)
    svcs = yaml.safe_load(out)["services"]
    assert svcs["api"]["environment"][0] == f"DOGRAH_ARI_CALLER_TRUNKS={VALUE}"
    assert svcs["worker"]["environment"]["DOGRAH_ARI_CALLER_TRUNKS"] == VALUE
    assert svcs["worker"]["volumes"] == [VOL]


def test_api_image_services():
    config = {"services": {"api": {"image": "dograh/api:1"}, "worker": {"image": "dograh/api:1"},
                           "ui": {"image": "dograh/ui:1"}}}
    assert api_image_services(config) == ["api", "worker"]
    assert api_image_services({"services": {"ui": {}}}) == []


def test_config_copy_keeps_credentials_renames_and_never_copies_default_flag():
    cols = [
        {"column_name": "id", "data_type": "integer", "is_generated": "NEVER", "identity_generation": None},
        {"column_name": "organization_id", "data_type": "integer", "is_generated": "NEVER"},
        {"column_name": "name", "data_type": "character varying", "is_generated": "NEVER"},
        {"column_name": "provider", "data_type": "character varying", "is_generated": "NEVER"},
        {"column_name": "credentials", "data_type": "json", "is_generated": "NEVER"},
        {"column_name": "is_default_outbound", "data_type": "boolean", "is_generated": "NEVER"},
        {"column_name": "created_at", "data_type": "timestamp with time zone", "is_generated": "NEVER"},
        {"column_name": "search", "data_type": "tsvector", "is_generated": "ALWAYS"},
    ]
    assert copy_expressions(cols) == {
        "organization_id": '"organization_id"', "name": "$2", "provider": '"provider"',
        "credentials": '"credentials"', "is_default_outbound": "false", "created_at": "now()",
    }
    assert last10("+1 (201) 778-5210") == "2017785210" and last10("+442071234567") is None


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
