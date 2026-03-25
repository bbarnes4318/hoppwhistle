#!/bin/sh
set -e

# The safarov base image expects config at /etc/freeswitch
# But the actual config is at /usr/share/freeswitch/conf/vanilla
# We need to create symlinks like the original entrypoint does

VANILLA_CONF="/usr/share/freeswitch/conf/vanilla"
FS_CONF="/etc/freeswitch"

# Create the config directory and symlinks if they don't exist
if [ ! -f "$FS_CONF/freeswitch.xml" ]; then
    echo "Creating symlinks from $FS_CONF to $VANILLA_CONF..."
    mkdir -p "$FS_CONF"

    # Create symlinks for each file/directory in vanilla config
    for file in "$VANILLA_CONF"/*; do
        if [ -e "$file" ]; then
            filename=$(basename "$file")
            # Remove existing file/dir if exists (not a symlink)
            if [ -e "$FS_CONF/$filename" ] && [ ! -L "$FS_CONF/$filename" ]; then
                rm -rf "$FS_CONF/$filename"
            fi
            # Create symlink if doesn't exist
            if [ ! -e "$FS_CONF/$filename" ]; then
                ln -s "$file" "$FS_CONF/$filename"
                echo "  Linked: $filename"
            fi
        fi
    done
fi

# Apply environment variable substitution to vars.xml
if [ -f "$VANILLA_CONF/vars.xml" ]; then
    echo "Applying environment variable substitutions..."
    sed -i "s|\${PUBLIC_IP}|${PUBLIC_IP:-auto}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${MEDIA_DOMAIN}|${MEDIA_DOMAIN:-}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_SIP_PROXY}|${OUTBOUND_SIP_PROXY:-sip.telnyx.com}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_SIP_USER}|${OUTBOUND_SIP_USER:-}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_SIP_PASS}|${OUTBOUND_SIP_PASS:-}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${OUTBOUND_CALLER_ID}|${OUTBOUND_CALLER_ID:-}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${FREESWITCH_ESL_PASSWORD}|${FREESWITCH_ESL_PASSWORD:-ClueCon}|g" "$VANILLA_CONF/vars.xml"
fi

# Patch switch.conf.xml to restrict RTP ports to Docker-exposed range (16384-16484)
# This is CRITICAL for Vapi audio to work - FreeSWITCH must use ports that Docker exposes
SWITCH_CONF="$VANILLA_CONF/autoload_configs/switch.conf.xml"
if [ -f "$SWITCH_CONF" ]; then
    echo "Patching RTP port range in switch.conf.xml..."
    # Uncomment rtp-start-port and set to 16384
    sed -i 's|<!-- *<param name="rtp-start-port" value="[0-9]*"/> *-->|<param name="rtp-start-port" value="16384"/>|g' "$SWITCH_CONF"
    # Uncomment rtp-end-port and set to 16484
    sed -i 's|<!-- *<param name="rtp-end-port" value="[0-9]*"/> *-->|<param name="rtp-end-port" value="16484"/>|g' "$SWITCH_CONF"
    echo "  RTP ports configured: 16384-16484"
fi

# Generate combined wss.pem for FreeSWITCH WSS binding (mod_sofia expects cert+key in one file)
TLS_CERT_DIR="/etc/freeswitch/letsencrypt"
if [ -f "$TLS_CERT_DIR/fullchain.pem" ] && [ -f "$TLS_CERT_DIR/privkey.pem" ]; then
    echo "Generating combined wss.pem for WSS binding..."
    cat "$TLS_CERT_DIR/fullchain.pem" "$TLS_CERT_DIR/privkey.pem" > "$TLS_CERT_DIR/wss.pem"
    echo "  wss.pem created at $TLS_CERT_DIR/wss.pem"
else
    echo "WARNING: SSL cert files not found at $TLS_CERT_DIR — WSS on port 7443 will NOT work!"
fi

echo "Starting FreeSWITCH..."

# Execute the main command
exec "$@"
