FROM debian:bookworm

# Install dependencies
RUN apt-get update && apt-get install -y     gnupg2     wget     lsb-release     curl     jq     && rm -rf /var/lib/apt/lists/*

# Add SignalWire public repo key and source
ARG SIGNALWIRE_TOKEN
RUN wget --http-user=signalwire --http-password=$SIGNALWIRE_TOKEN -O - https://freeswitch.signalwire.com/repo/deb/debian-release/signalwire-freeswitch-repo.gpg | apt-key add -
RUN echo "deb https://signalwire:$SIGNALWIRE_TOKEN@freeswitch.signalwire.com/repo/deb/debian-release/ `lsb_release -sc` main" > /etc/apt/sources.list.d/freeswitch.list

# Install FreeSWITCH
RUN apt-get update && apt-get install -y     freeswitch     freeswitch-mod-console     freeswitch-mod-logfile     freeswitch-mod-sofia     freeswitch-mod-event-socket     freeswitch-mod-commands     freeswitch-mod-conference     freeswitch-mod-db     freeswitch-mod-dptools     freeswitch-mod-expr     freeswitch-mod-fifo     freeswitch-mod-hash     freeswitch-mod-httapi     freeswitch-mod-dialplan-xml     freeswitch-mod-loopback     freeswitch-mod-native-file     freeswitch-mod-png     freeswitch-mod-rtc     freeswitch-mod-rtmp     freeswitch-mod-sndfile     freeswitch-mod-spandsp     freeswitch-mod-syslog     freeswitch-mod-tone-stream     freeswitch-mod-valet-parking     freeswitch-mod-verto     freeswitch-mod-xml-curl     freeswitch-mod-xml-rpc     gettext-base     && rm -rf /var/lib/apt/lists/*

# Copy config
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

# Expose ports
EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 8021/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nf", "-nc"]
