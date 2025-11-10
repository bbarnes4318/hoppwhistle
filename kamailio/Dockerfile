FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    kamailio \
    kamailio-outbound-modules \
    kamailio-tls-modules \
    kamailio-topoh-modules \
    kamailio-pike-modules \
    gettext-base \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY kamailio.cfg /etc/kamailio/kamailio.cfg.template
COPY dispatcher.list /etc/kamailio/dispatcher.list.template
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY tls /etc/kamailio/tls

RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["kamailio", "-DD", "-E", "-f", "/etc/kamailio/kamailio.cfg"]

