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
    sed -i "s|\${SIP_PUBLIC_IP}|${SIP_PUBLIC_IP:-${PUBLIC_IP:-auto}}|g" "$VANILLA_CONF/vars.xml"
    sed -i "s|\${SIP_DOMAIN}|${SIP_DOMAIN:-${PUBLIC_IP:-auto}}|g" "$VANILLA_CONF/vars.xml"
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

# Generate combined wss.pem for FreeSWITCH WSS binding
# Let's Encrypt live/ dir uses relative symlinks (../../archive/...) that break when
# mounted at /etc/freeswitch/letsencrypt. Read directly from archive instead.
LE_ARCHIVE="/etc/letsencrypt/archive/hopwhistle.com"
FS_TLS_DIR="/etc/freeswitch/tls"
FS_LE_DIR="/etc/freeswitch/letsencrypt"

# Find the latest (highest-numbered) fullchain and privkey in the archive.
# After renewals, certbot creates fullchain2.pem, fullchain3.pem, etc.
LATEST_FULLCHAIN=$(ls -v "$LE_ARCHIVE"/fullchain*.pem 2>/dev/null | tail -1)
LATEST_PRIVKEY=$(ls -v "$LE_ARCHIVE"/privkey*.pem 2>/dev/null | tail -1)

if [ -n "$LATEST_FULLCHAIN" ] && [ -n "$LATEST_PRIVKEY" ]; then
    echo "Generating combined wss.pem from Let's Encrypt archive certs..."
    echo "  Using: $(basename $LATEST_FULLCHAIN) + $(basename $LATEST_PRIVKEY)"
    cat "$LATEST_FULLCHAIN" "$LATEST_PRIVKEY" > "/tmp/wss.pem"
    # Overwrite FreeSWITCH default self-signed certs
    mkdir -p "$FS_TLS_DIR"
    cp "/tmp/wss.pem" "$FS_TLS_DIR/wss.pem"
    cp "/tmp/wss.pem" "$FS_TLS_DIR/dtls-srtp.pem"
    echo "  Let's Encrypt wss.pem installed at $FS_TLS_DIR/wss.pem"
else
    echo "WARNING: Let's Encrypt certs not found at $LE_ARCHIVE — WSS will use self-signed cert!"
fi

# Ensure recordings directory exists and is writeable
mkdir -p /recordings /tmp/recordings
chmod 777 /recordings /tmp/recordings

echo "Starting FreeSWITCH..."

# Execute the main command
exec "$@"
