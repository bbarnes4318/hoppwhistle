FROM debian:12-slim

# Install rtpengine and dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    rtpengine \
    iproute2 \
    iptables \
    net-tools \
    curl \
    gettext-base \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create directory for runtime files
RUN mkdir -p /run/rtpengine

# --- FIX: Copy from apps/rtpengine/ folder because build context is root ---
COPY apps/rtpengine/entrypoint.sh /entrypoint.sh
# ---------------------------------------------------------------------------
RUN chmod +x /entrypoint.sh

# Expose ports
# UDP range for RTP (Media)
EXPOSE 10000-10100/udp
# Control port (NG protocol)
EXPOSE 22222/udp

ENTRYPOINT ["/entrypoint.sh"]
