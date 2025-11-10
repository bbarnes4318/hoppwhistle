FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    freeswitch \
    freeswitch-mod-sofia \
    freeswitch-mod-conference \
    freeswitch-mod-dptools \
    freeswitch-mod-json-cdr \
    freeswitch-mod-opus \
    freeswitch-mod-png \
    freeswitch-mod-shout \
    curl \
    ca-certificates \
    ffmpeg \
    gettext-base \
    && rm -rf /var/lib/apt/lists/*

COPY vars.xml /etc/freeswitch/vars.xml.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY autoload_configs /etc/freeswitch/autoload_configs
COPY dialplan /etc/freeswitch/dialplan
COPY scripts /usr/local/bin/scripts

RUN mkdir -p /var/recordings && chown -R www-data:www-data /var/recordings
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nonat", "-u", "www-data", "-g", "www-data", "-nf"]

