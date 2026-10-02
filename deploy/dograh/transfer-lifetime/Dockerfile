# syntax=docker/dockerfile:1.7

# Build from the exact Dograh API image currently deployed. The build fails
# rather than guessing when Dograh's ARI source has drifted from the reviewed
# 1.42.x/current source anchors.
ARG DOGRAH_BASE_IMAGE
FROM ${DOGRAH_BASE_IMAGE}

COPY patch_transfer_lifetime.py /opt/hopwhistle/patch_transfer_lifetime.py

RUN python /opt/hopwhistle/patch_transfer_lifetime.py --root /app --apply \
    && python /opt/hopwhistle/patch_transfer_lifetime.py --root /app --check \
    && python -m py_compile /app/api/services/telephony/providers/ari/strategies.py

LABEL com.hopwhistle.fix="dograh-transfer-lifetime-v1"
