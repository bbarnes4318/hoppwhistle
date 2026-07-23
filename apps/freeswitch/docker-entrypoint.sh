#!/bin/sh
set -e

VANILLA_CONF="/usr/share/freeswitch/conf/vanilla"
FS_CONF="/etc/freeswitch"

if [ ! -f "$FS_CONF/freeswitch.xml" ]; then
    echo "Creating symlinks from $FS_CONF to $VANILLA_CONF..."
    mkdir -p "$FS_CONF"
    for file in "$VANILLA_CONF"/*; do
        if [ -e "$file" ]; then
            filename=$(basename "$file")
            if [ -e "$FS_CONF/$filename" ] && [ ! -L "$FS_CONF/$filename" ]; then
                rm -rf "$FS_CONF/$filename"
            fi
            if [ ! -e "$FS_CONF/$filename" ]; then
                ln -s "$file" "$FS_CONF/$filename"
                echo "  Linked: $filename"
            fi
        fi
    done
fi

if [ -f "$VANILLA_CONF/vars.xml" ]; then
    echo "Applying environment variable substitutions and secret validations..."
    INT_SECRET="${INTERNAL_API_SECRET}"
    DIR_SECRET="${DIRECTORY_INTERNAL_API_SECRET:-$INTERNAL_API_SECRET}"

    if [ -z "$INT_SECRET" ] || [ "$INT_SECRET" = "demo-key" ] || [ "$INT_SECRET" = "ClueCon" ]; then
        echo "FATAL ERROR: Mandatory INTERNAL_API_SECRET environment variable is missing or set to insecure fallback."
        exit 1
    fi

    if [ -z "$DIR_SECRET" ] || [ "$DIR_SECRET" = "demo-key" ] || [ "$DIR_SECRET" = "ClueCon" ]; then
        echo "FATAL ERROR: Mandatory DIRECTORY_INTERNAL_API_SECRET environment variable is missing or set to insecure fallback."
        exit 1
    fi

    sed -i "s|\${PUBLIC_IP}|${PUBLIC_IP:-auto}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${SIP_PUBLIC_IP}|${SIP_PUBLIC_IP:-${PUBLIC_IP:-auto}}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${SIP_DOMAIN}|${SIP_DOMAIN:-${PUBLIC_IP:-auto}}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${INTERNAL_API_SECRET}|${INT_SECRET}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${DIRECTORY_INTERNAL_API_SECRET}|${DIR_SECRET}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_CALLER_ID}|${OUTBOUND_CALLER_ID:-}|g" "$VANILLA_CONF/vars.xml"

    ESL_PASS="${FREESWITCH_ESL_PASSWORD}"
    if [ -z "$ESL_PASS" ] || [ "$ESL_PASS" = "ClueCon" ]; then
        echo "FATAL ERROR: Mandatory FREESWITCH_ESL_PASSWORD environment variable is missing or set to insecure fallback 'ClueCon'."
        exit 1
    fi
    sed -i "s|\${FREESWITCH_ESL_PASSWORD}|${ESL_PASS}|g" "$VANILLA_CONF/vars.xml"
fi

SWITCH_CONF="$VANILLA_CONF/autoload_configs/switch.conf.xml"
if [ -f "$SWITCH_CONF" ]; then
    echo "Patching RTP port range in switch.conf.xml..."
    sed -i 's|<!-- *<param name="rtp-start-port" value="[0-9]*"/> *-->|<param name="rtp-start-port" value="16384"/>|g' "$SWITCH_CONF"
    sed -i 's|<!-- *<param name="rtp-end-port" value="[0-9]*"/> *-->|<param name="rtp-end-port" value="16484"/>|g' "$SWITCH_CONF"
    echo "  RTP ports configured: 16384-16484"
fi

mkdir -p /recordings /tmp/recordings
chmod 777 /recordings /tmp/recordings

echo "Starting FreeSWITCH..."
exec "$@"
