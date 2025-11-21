FROM debian:12-slim

# Install Kamailio and dependencies
# We install postgres, mysql, and standard modules to cover all config bases
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    kamailio \
    kamailio-postgres-modules \
    kamailio-mysql-modules \
    kamailio-tls-modules \
    kamailio-websocket-modules \
    kamailio-json-modules \
    kamailio-utils-modules \
    kamailio-extra-modules \
    kamailio-outbound-modules \
    curl \
    procps \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# --- FIX: Copy files from their apps/kamailio/ path ---
COPY apps/kamailio/entrypoint.sh /entrypoint.sh
COPY apps/kamailio/kamailio.cfg /etc/kamailio/kamailio.cfg
COPY apps/kamailio/dispatcher.list /etc/kamailio/dispatcher.list
# ------------------------------------------------------

RUN chmod +x /entrypoint.sh

EXPOSE 5060/udp
EXPOSE 5060/tcp
EXPOSE 5061/tcp

ENTRYPOINT ["/entrypoint.sh"]
