# Use safarov FreeSWITCH image which includes mod_verto for WebRTC
FROM safarov/freeswitch:1.10.12

# Create additional directories
RUN mkdir -p /etc/freeswitch/scripts /recordings

# IMPORTANT: Copy config files individually to MERGE with base config, not replace!
# The base image already has all the essential FreeSWITCH configs we need

# Copy our custom autoload_configs (merges/overwrites only what we provide)
COPY apps/freeswitch/conf/autoload_configs/*.xml /etc/freeswitch/autoload_configs/

# Copy our custom sip_profiles
COPY apps/freeswitch/conf/sip_profiles/*.xml /etc/freeswitch/sip_profiles/
COPY apps/freeswitch/conf/sip_profiles/external/ /etc/freeswitch/sip_profiles/external/

# Copy our custom dialplan
COPY apps/freeswitch/conf/dialplan/*.xml /etc/freeswitch/dialplan/

# Copy vars.xml for environment variable substitution
COPY apps/freeswitch/conf/vars.xml /etc/freeswitch/vars.xml
COPY apps/freeswitch/conf/vars.xml /etc/freeswitch/vars.xml.template

# Copy scripts
COPY apps/freeswitch/scripts/ /etc/freeswitch/scripts/

# Copy entrypoint
COPY apps/freeswitch/docker-entrypoint.sh /docker-entrypoint.sh

# Fix Windows line endings and make executable
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh
RUN chmod +x /etc/freeswitch/scripts/*.sh 2>/dev/null || true

# Expose ports (SIP, ESL, RTP, Verto WebSocket)
EXPOSE 5060/udp 5060/tcp 5066/tcp 5080/udp 5080/tcp 7443/tcp 8021/tcp 8082/tcp 8083/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nf", "-c"]
