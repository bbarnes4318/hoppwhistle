# Stage 1: Get openssl CLI and curl binaries from matching Debian image
# The safarov base already has libssl.so.3/libcrypto.so.3/libcurl.so.4 — only the CLI/binaries are missing
FROM debian:bookworm-slim AS donor
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*

# Stage 2: Build the FreeSWITCH image
# Use safarov FreeSWITCH image which includes mod_verto for WebRTC
FROM safarov/freeswitch:1.10.12

# Graft openssl CLI and curl binaries
COPY --from=donor /usr/bin/openssl /usr/bin/openssl
COPY --from=donor /usr/bin/curl /usr/bin/curl

# Create additional directories
RUN mkdir -p /recordings /tmp/recordings && chmod 777 /recordings /tmp/recordings

# The base image uses /usr/share/freeswitch/conf/vanilla/ as default config
# We need to copy our customizations there to MERGE with the base config

# Copy our custom autoload_configs (merges/overwrites only what we provide)
COPY apps/freeswitch/conf/autoload_configs/*.xml /usr/share/freeswitch/conf/vanilla/autoload_configs/

# Copy our custom sip_profiles
COPY apps/freeswitch/conf/sip_profiles/*.xml /usr/share/freeswitch/conf/vanilla/sip_profiles/
COPY apps/freeswitch/conf/sip_profiles/external/ /usr/share/freeswitch/conf/vanilla/sip_profiles/external/

# Copy our custom dialplan
COPY apps/freeswitch/conf/dialplan/*.xml /usr/share/freeswitch/conf/vanilla/dialplan/

# Copy our custom directory users (including vapi.xml for SIP auth)
COPY apps/freeswitch/conf/directory/default/*.xml /usr/share/freeswitch/conf/vanilla/directory/default/

# Copy vars.xml for environment variable substitution
COPY apps/freeswitch/conf/vars.xml /usr/share/freeswitch/conf/vanilla/vars.xml

# Copy scripts
RUN mkdir -p /usr/share/freeswitch/scripts
COPY apps/freeswitch/scripts/ /usr/share/freeswitch/scripts/

# Copy entrypoint
COPY apps/freeswitch/docker-entrypoint.sh /docker-entrypoint.sh

# Fix Windows line endings and make executable for ALL scripts
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh
RUN find /usr/share/freeswitch/scripts -name '*.sh' -exec sed -i 's/\r$//' {} + \
    && chmod +x /usr/share/freeswitch/scripts/*.sh 2>/dev/null || true

# Expose ports (SIP, ESL, RTP, Verto WebSocket, Vapi SIP)
EXPOSE 5060/udp 5060/tcp 5066/tcp 5070/udp 5070/tcp 5080/udp 5080/tcp 7443/tcp 8021/tcp 8082/tcp 8083/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nf", "-c"]
