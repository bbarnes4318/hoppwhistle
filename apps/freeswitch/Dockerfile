# Stage 1: Get openssl CLI and curl binaries from matching Debian image
# The safarov base already has libssl.so.3/libcrypto.so.3/libcurl.so.4 — only the CLI/binaries are missing
FROM debian:bookworm-slim AS donor
RUN apt-get update && apt-get install -y --no-install-recommends openssl curl && rm -rf /var/lib/apt/lists/*

# Stage 1b: The English prompts (Callie, 8 kHz).
#
# The safarov base image ships with NO sound files: its own entrypoint downloads
# them at start when SOUND_RATES/SOUND_TYPES are set, and this image replaces
# that entrypoint and never set them. So every `playback ivr/...` failed on the
# spot: a caller nobody could take heard ~1s of silence and a hang-up instead of
# "no one is available", and the agent-cell "press 1 to accept" prompt never
# played, so a forwarded cell could not take the call.
#
# Fetched at BUILD time, not at start, so a running FreeSWITCH never depends on
# files.freeswitch.org being up. If the download fails, the build fails, and
# `docker compose up --build` leaves the running container untouched -- a
# deploy is refused rather than shipping a phone system with no prompts.
# 8 kHz only: the PSTN legs are 8 kHz, and FreeSWITCH resamples for WebRTC.
FROM donor AS sounds
# The last two tests are the prompts inbound_route.lua plays; the build fails if
# either is missing.
ARG CALLIE_SOUNDS_URL=https://files.freeswitch.org/releases/sounds/freeswitch-sounds-en-us-callie-8000-1.0.53.tar.gz
# ca-certificates is needed for the HTTPS download and only in this stage: the
# donor installs curl with --no-install-recommends, which leaves it without a
# CA bundle (curl exit 77). Nothing from here but /sounds reaches the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /sounds \
    && curl -fsSL --retry 3 --retry-delay 5 "$CALLIE_SOUNDS_URL" -o /tmp/callie.tar.gz \
    && echo "callie sounds sha256: $(sha256sum /tmp/callie.tar.gz | cut -d' ' -f1)" \
    && tar -xzf /tmp/callie.tar.gz -C /sounds \
    && rm -f /tmp/callie.tar.gz \
    && { test -f /sounds/en/us/callie/ivr/8000/ivr-no_user_response.wav \
         && test -f /sounds/en/us/callie/ivr/8000/ivr-accept_reject_voicemail.wav \
         || { echo "prompts not where vars.xml expects them; extracted layout:"; \
              find /sounds -maxdepth 5 -type d | head -40; exit 1; }; }

# Stage 2: Build the FreeSWITCH image
# Use safarov FreeSWITCH image which includes mod_verto for WebRTC
FROM safarov/freeswitch:1.10.12

# Graft openssl CLI and curl binaries
COPY --from=donor /usr/bin/openssl /usr/bin/openssl
COPY --from=donor /usr/bin/curl /usr/bin/curl

# The prompts. vars.xml points sound_prefix at en/us/callie.
COPY --from=sounds /sounds/ /usr/share/freeswitch/sounds/

# Create additional directories
RUN mkdir -p /recordings /tmp/recordings && chmod 777 /recordings /tmp/recordings

# The base image uses /usr/share/freeswitch/conf/vanilla/ as default config
# We need to copy our customizations there to MERGE with the base config

# Copy our custom autoload_configs (merges/overwrites only what we provide)
COPY apps/freeswitch/conf/autoload_configs/*.xml /usr/share/freeswitch/conf/vanilla/autoload_configs/

# Copy our custom sip_profiles
COPY apps/freeswitch/conf/sip_profiles/*.xml /usr/share/freeswitch/conf/vanilla/sip_profiles/
COPY apps/freeswitch/conf/sip_profiles/external/ /usr/share/freeswitch/conf/vanilla/sip_profiles/external/

# Copy our custom dialplan
COPY apps/freeswitch/conf/dialplan/*.xml /usr/share/freeswitch/conf/vanilla/dialplan/

# Copy our custom directory users (including vapi.xml for SIP auth)
COPY apps/freeswitch/conf/directory/default.xml /usr/share/freeswitch/conf/vanilla/directory/default.xml
COPY apps/freeswitch/conf/directory/default/*.xml /usr/share/freeswitch/conf/vanilla/directory/default/

# Copy vars.xml for environment variable substitution
COPY apps/freeswitch/conf/vars.xml /usr/share/freeswitch/conf/vanilla/vars.xml

# Copy scripts
RUN mkdir -p /usr/share/freeswitch/scripts
COPY apps/freeswitch/scripts/ /usr/share/freeswitch/scripts/

# Campaign transfers to external buyer phones must present a verified FracTEL DID
# with the same SIP caller-ID fields proven by the direct originate test.
COPY scripts/apply-campaign-external-buyer-cid.sh /tmp/apply-campaign-external-buyer-cid.sh
RUN chmod +x /tmp/apply-campaign-external-buyer-cid.sh \
    && /tmp/apply-campaign-external-buyer-cid.sh /usr/share/freeswitch/scripts/inbound_route.lua \
    && rm -f /tmp/apply-campaign-external-buyer-cid.sh

# Copy entrypoint
COPY apps/freeswitch/docker-entrypoint.sh /docker-entrypoint.sh

# Fix Windows line endings and make executable for ALL scripts
RUN sed -i 's/\r$//' /docker-entrypoint.sh && chmod +x /docker-entrypoint.sh
RUN find /usr/share/freeswitch/scripts -name '*.sh' -exec sed -i 's/\r$//' {} + \
    && chmod +x /usr/share/freeswitch/scripts/*.sh 2>/dev/null || true

# Expose ports (SIP, ESL, RTP, Verto WebSocket, Vapi SIP)
EXPOSE 5060/udp 5060/tcp 5066/tcp 5070/udp 5070/tcp 5080/udp 5080/tcp 7443/tcp 8021/tcp 8082/tcp 8083/tcp 16384-32768/udp

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["freeswitch", "-nf", "-c"]