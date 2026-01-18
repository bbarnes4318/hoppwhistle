# Use a community-maintained FreeSWITCH image that's regularly updated
# This bypasses the SignalWire authentication requirement
FROM drachtio/drachtio-freeswitch-mrf:0.9.5-2

USER root

# Install additional dependencies
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    gettext-base \
    procps \
    freeswitch-mod-verto \
    && rm -rf /var/lib/apt/lists/*

# Create directories
RUN mkdir -p /usr/local/freeswitch/scripts /recordings

# Copy config - Note: this image uses /etc/freeswitch
COPY apps/freeswitch/conf/ /etc/freeswitch/

# Copy scripts
COPY apps/freeswitch/scripts/ /usr/local/freeswitch/scripts/

# Copy vars.xml template
COPY apps/freeswitch/conf/vars.xml /etc/freeswitch/vars.xml.template

# Copy entrypoint
COPY apps/freeswitch/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh
RUN chmod +x /usr/local/freeswitch/scripts/*.sh 2>/dev/null || true

# Expose ports (SIP, ESL, RTP, Verto WebSocket)
EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 8021/tcp 8082/tcp 8083/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["/usr/local/freeswitch/bin/freeswitch", "-nf", "-nc"]
