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

echo "Starting FreeSWITCH..."

# Execute the main command
exec "$@"
