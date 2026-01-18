# Use safarov FreeSWITCH image which includes mod_verto for WebRTC
FROM safarov/freeswitch:1.10.12

USER root

# Install additional dependencies
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    gettext-base \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p /etc/freeswitch/scripts /recordings

# Copy config - signalwire image uses /etc/freeswitch/
COPY apps/freeswitch/conf/ /etc/freeswitch/

# Copy scripts
COPY apps/freeswitch/scripts/ /etc/freeswitch/scripts/

# Copy vars.xml template
COPY apps/freeswitch/conf/vars.xml /etc/freeswitch/vars.xml.template

# Copy entrypoint
COPY apps/freeswitch/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh
RUN chmod +x /etc/freeswitch/scripts/*.sh 2>/dev/null || true

# Expose ports (SIP, ESL, RTP, Verto WebSocket)
EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 8021/tcp 8082/tcp 8083/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nf", "-nc"]

