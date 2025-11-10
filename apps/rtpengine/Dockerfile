FROM debian:12-slim

# Install rtpengine and additional tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    rtpengine \
    iproute2 \
    iptables \
    net-tools \
    gettext-base \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy configuration
COPY rtpengine.conf /etc/rtpengine/rtpengine.conf

# Create recordings directory
RUN mkdir -p /recordings && \
    chown -R rtpengine:rtpengine /recordings

# Create runtime directory
RUN mkdir -p /var/run/rtpengine && \
    chown -R rtpengine:rtpengine /var/run/rtpengine

# Copy startup script
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy test scripts
COPY scripts/ /usr/local/bin/
RUN chmod +x /usr/local/bin/*.sh

# Expose RTP ports
# 22222 - ng control protocol (UDP/TCP)
# 10000-20000 - RTP media ports (UDP)
EXPOSE 22222/udp 22222/tcp 10000-20000/udp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD rtpengine-ctl -t 127.0.0.1:9900 ping || exit 1

# Start RTPEngine
ENTRYPOINT ["/entrypoint.sh"]
