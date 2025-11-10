FROM debian:12-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    rtpengine \
    gettext-base \
    && rm -rf /var/lib/apt/lists/*

COPY rtpengine.conf /etc/rtpengine/rtpengine.conf.template
COPY docker-entrypoint.sh /docker-entrypoint.sh

RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["rtpengine", "--config-file=/etc/rtpengine/rtpengine.conf"]

