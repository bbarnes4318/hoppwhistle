FROM praekeltfoundation/freeswitch:latest

# Install additional tools
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    awscli \
    ca-certificates \
    ffmpeg \
    gettext-base \
    && apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Copy custom configuration
COPY conf/ /usr/local/freeswitch/conf/

# Copy scripts
COPY scripts/ /usr/local/freeswitch/scripts/
RUN chmod +x /usr/local/freeswitch/scripts/*.sh

# Create recordings directory
RUN mkdir -p /recordings && \
    chown -R freeswitch:freeswitch /recordings

# Create volumes
VOLUME ["/recordings", "/usr/local/freeswitch/conf"]

# Expose ports
# 5060 - External SIP (UDP/TCP)
# 5080 - Internal SIP (UDP/TCP)
# 5061 - TLS SIP (TCP)
# 8021 - Event Socket (TCP)
EXPOSE 5060/udp 5060/tcp 5080/udp 5080/tcp 5061/tcp 8021/tcp

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD fs_cli -x "status" | grep -q "UP" || exit 1

# Start FreeSWITCH
CMD ["freeswitch", "-nonat"]
