# Use the official SignalWire FreeSWITCH image instead of building from source
# This eliminates the need for SIGNALWIRE_TOKEN during CI builds
FROM signalwire/freeswitch:1.10

USER root

# Install additional dependencies
RUN apt-get update && apt-get install -y \
    curl \
    jq \
    gettext-base \
    && rm -rf /var/lib/apt/lists/*

# Copy config
COPY apps/freeswitch/conf/ /etc/freeswitch/

# Copy scripts
COPY apps/freeswitch/scripts/ /usr/local/freeswitch/scripts/

# Copy vars.xml template
COPY apps/freeswitch/conf/vars.xml /etc/freeswitch/vars.xml.template

# Copy entrypoint
COPY apps/freeswitch/docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh
RUN mkdir -p /usr/local/freeswitch/scripts && chmod +x /usr/local/freeswitch/scripts/*.sh || true

# Expose ports (SIP, ESL, RTP, Verto WebSocket)
EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 8021/tcp 8082/tcp 8083/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nf", "-nc"]
