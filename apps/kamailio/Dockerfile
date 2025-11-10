FROM debian:12-slim

# Install kamailio and additional tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    kamailio \
    kamailio-outbound-modules \
    kamailio-tls-modules \
    kamailio-topoh-modules \
    kamailio-pike-modules \
    curl \
    jq \
    gettext-base \
    ca-certificates \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy configuration
COPY kamailio.cfg /etc/kamailio/kamailio.cfg
COPY dispatcher.list /etc/kamailio/dispatcher.list
COPY scripts/ /usr/local/bin/

# Copy entrypoint
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /usr/local/bin/*.sh

# Create directories
RUN mkdir -p /var/run/kamailio && \
    chown -R kamailio:kamailio /var/run/kamailio

# Expose SIP ports
EXPOSE 5060/udp 5060/tcp 5061/tcp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD kamctl ping || exit 1

# Start Kamailio
ENTRYPOINT ["/entrypoint.sh"]
