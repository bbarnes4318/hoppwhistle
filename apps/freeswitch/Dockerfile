# Use safarov FreeSWITCH image which includes mod_verto for WebRTC
FROM safarov/freeswitch:1.10.12

# Create additional directories
RUN mkdir -p /recordings

# The base image uses /usr/share/freeswitch/conf/vanilla/ as default config
# We need to copy our customizations there to MERGE with the base config

# Copy our custom autoload_configs (merges/overwrites only what we provide)
COPY apps/freeswitch/conf/autoload_configs/*.xml /usr/share/freeswitch/conf/vanilla/autoload_configs/

# Copy our custom sip_profiles
COPY apps/freeswitch/conf/sip_profiles/*.xml /usr/share/freeswitch/conf/vanilla/sip_profiles/
COPY apps/freeswitch/conf/sip_profiles/external/ /usr/share/freeswitch/conf/vanilla/sip_profiles/external/

# Copy our custom dialplan
COPY apps/freeswitch/conf/dialplan/*.xml /usr/share/freeswitch/conf/vanilla/dialplan/

# Copy vars.xml for environment variable substitution
COPY apps/freeswitch/conf/vars.xml /usr/share/freeswitch/conf/vanilla/vars.xml

# Copy scripts
RUN mkdir -p /usr/share/freeswitch/scripts
COPY apps/freeswitch/scripts/ /usr/share/freeswitch/scripts/

# Copy entrypoint
COPY apps/freeswitch/docker-entrypoint.sh /docker-entrypoint.sh

# Fix Windows line endings and make executable
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh
RUN chmod +x /usr/share/freeswitch/scripts/*.sh 2>/dev/null || true

# Expose ports (SIP, ESL, RTP, Verto WebSocket)
EXPOSE 5060/udp 5060/tcp 5066/tcp 5080/udp 5080/tcp 7443/tcp 8021/tcp 8082/tcp 8083/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nf", "-c"]
