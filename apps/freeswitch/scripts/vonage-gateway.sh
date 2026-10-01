#!/bin/sh
# Render the Vonage SIP trunk settings into FreeSWITCH's vars.xml.
#
# Sourced by docker-entrypoint.sh (and by the API's test suite, which runs it
# against a scratch copy of the config). Defines one function:
#
#   configure_vonage_gateway <vars.xml> <sip_profiles/external/vonage.xml>
#
# ── What it guarantees ───────────────────────────────────────────────────────
#
#  * Auth is IP-authorised (no credentials) or credential-authenticated (BOTH
#    username and password). Exactly one of the two is a configuration mistake
#    that would otherwise surface as every Vonage leg failing with
#    CALL_REJECTED. It is reported here, by name, and the `vonage` gateway is
#    left out of the running config: its legs then fail instantly with
#    INVALID_GATEWAY, the waterfall moves to the next carrier at once, and the
#    settings page shows the gateway faulting. Nothing else is affected — the
#    container still starts and every other carrier still dials.
#
#  * Values are made safe for the two places they land: the sed replacement
#    (where `&`, `|` and `\` are special) and the XML attribute FreeSWITCH
#    parses (where `&`, `<`, `>`, `"` and `'` are). An unescaped `&` in a
#    password would not just break this gateway, it would fail the parse of the
#    whole `external` profile and take every carrier down with it.
#
#  * No credential is ever printed. The summary names the proxy, the realm and
#    the auth MODE, never a username or a password.

vonage_xml_escape() {
    printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' \
        -e 's/"/\&quot;/g' -e "s/'/\&apos;/g"
}

# Escape for the right-hand side of `s|...|...|`.
vonage_sed_escape() {
    printf '%s' "$1" | sed -e 's/[\\|&]/\\&/g'
}

# A SIP host[:port]. Anything else — whitespace, a URI scheme, a path — is a
# typo that mod_sofia would accept and then fail to resolve.
vonage_valid_host() {
    printf '%s' "$1" | grep -Eq '^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$'
}

vonage_disable_gateway() {
    gateway_xml="$1"
    if [ -f "$gateway_xml" ]; then
        mv -f "$gateway_xml" "$gateway_xml.disabled"
    fi
}

configure_vonage_gateway() {
    vars_xml="$1"
    gateway_xml="$2"

    # A rerun against an already-rendered config restores the gateway first,
    # so fixing the environment and restarting is all it takes.
    if [ ! -f "$gateway_xml" ] && [ -f "$gateway_xml.disabled" ]; then
        mv -f "$gateway_xml.disabled" "$gateway_xml"
    fi

    v_proxy="${VONAGE_SIP_PROXY:-sip.nexmo.com}"
    v_realm="${VONAGE_SIP_REALM:-$v_proxy}"
    v_user="${VONAGE_SIP_USERNAME:-}"
    v_pass="${VONAGE_SIP_PASSWORD:-}"
    v_error=""

    if [ -n "$v_user" ] && [ -z "$v_pass" ]; then
        v_error="VONAGE_SIP_USERNAME is set but VONAGE_SIP_PASSWORD is not"
    elif [ -z "$v_user" ] && [ -n "$v_pass" ]; then
        v_error="VONAGE_SIP_PASSWORD is set but VONAGE_SIP_USERNAME is not"
    elif ! vonage_valid_host "$v_proxy"; then
        v_error="VONAGE_SIP_PROXY is not a host[:port] (got \"$v_proxy\")"
    elif ! vonage_valid_host "$v_realm"; then
        v_error="VONAGE_SIP_REALM is not a host[:port] (got \"$v_realm\")"
    fi

    if [ -n "$v_error" ]; then
        echo "ERROR: Vonage SIP trunk misconfigured: $v_error." >&2
        echo "       Set both VONAGE_SIP_USERNAME and VONAGE_SIP_PASSWORD for credential" >&2
        echo "       auth, or neither for an IP-authorised trunk. The vonage gateway is" >&2
        echo "       NOT loaded; calls routed to Vonage fail over to the next carrier." >&2
        vonage_disable_gateway "$gateway_xml"
        # Still substitute, with no credentials, so vars.xml is never left
        # holding a placeholder FreeSWITCH would read as literal text.
        v_user=""
        v_pass=""
    fi

    sed -i \
        -e "s|\${VONAGE_SIP_PROXY}|$(vonage_sed_escape "$(vonage_xml_escape "$v_proxy")")|g" \
        -e "s|\${VONAGE_SIP_REALM}|$(vonage_sed_escape "$(vonage_xml_escape "$v_realm")")|g" \
        -e "s|\${VONAGE_SIP_USERNAME}|$(vonage_sed_escape "$(vonage_xml_escape "$v_user")")|g" \
        -e "s|\${VONAGE_SIP_PASSWORD}|$(vonage_sed_escape "$(vonage_xml_escape "$v_pass")")|g" \
        "$vars_xml"

    if [ -z "$v_error" ]; then
        if [ -n "$v_user" ]; then v_auth="credentials"; else v_auth="ip-authorised"; fi
        echo "Vonage SIP trunk: proxy=$v_proxy realm=$v_realm auth=$v_auth"
    fi
    return 0
}
