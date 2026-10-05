#!/usr/bin/env bash
set -euo pipefail

DOCKER_CHAIN="HOPWHISTLE_SIP_GUARD"
HOST_CHAIN="HOPWHISTLE_HOST_GUARD"
V6_CHAIN="HOPWHISTLE_V6_GUARD"
WAN_IF="${WAN_IF:-eth0}"
DOCKER_NET="${DOCKER_NET:-172.16.0.0/12}"
SCRIPT_PATH="/usr/local/sbin/hopwhistle-sip-firewall"
UNIT_PATH="/etc/systemd/system/hopwhistle-sip-firewall.service"

cat > "$SCRIPT_PATH" <<'FIREWALL'
#!/usr/bin/env bash
set -euo pipefail

DOCKER_CHAIN="HOPWHISTLE_SIP_GUARD"
HOST_CHAIN="HOPWHISTLE_HOST_GUARD"
V6_CHAIN="HOPWHISTLE_V6_GUARD"
WAN_IF="${WAN_IF:-eth0}"
DOCKER_NET="${DOCKER_NET:-172.16.0.0/12}"

# Complete FracTEL signaling allowlist used by Hopwhistle FreeSWITCH and
# Dograh Asterisk. Carrier list updates must be committed here before use.
CARRIER_IPS=(
  137.220.61.54
  144.202.122.62
  74.201.72.61
  45.77.108.216
  14.1.29.149
  64.42.183.253
  64.42.183.254
  14.1.29.150
  74.201.72.62
)

# Additional carriers allowed to deliver INBOUND calls to FreeSWITCH's external
# profile (5080). Of these, only Twilio may also reach Dograh Asterisk (5062),
# for in-dialog requests on outbound AI calls; see the host chain below.
# Entries may be single IPs or CIDR ranges.
#
# Anveo Direct signaling IPs (https://www.anveodirect.com/about/faq). Anveo
# does not proxy media, so RTP arrives from arbitrary carrier IPs -- the RTP
# range is intentionally left unfiltered below.
ANVEO_SIP_SOURCES=(
  169.48.232.158
  204.216.109.55
  176.9.39.206
  72.9.149.25
)

# Twilio Elastic SIP Trunking signaling ranges (North America). Re-check
# against https://www.twilio.com/docs/sip-trunking/ip-addresses before relying
# on Twilio inbound; a missing range shows up as dropped Twilio INVITEs.
TWILIO_SIP_SOURCES=(
  54.172.60.0/30
  54.244.51.0/30
  168.86.128.0/18
)

# ---------------------------------------------------------------------------
# Docker-published Hopwhistle telephony ports (IPv4)
# ---------------------------------------------------------------------------
iptables -w -N "$DOCKER_CHAIN" 2>/dev/null || true
iptables -w -F "$DOCKER_CHAIN"
while iptables -w -C DOCKER-USER -j "$DOCKER_CHAIN" 2>/dev/null; do
  iptables -w -D DOCKER-USER -j "$DOCKER_CHAIN"
done
iptables -w -I DOCKER-USER 1 -j "$DOCKER_CHAIN"

iptables -w -A "$DOCKER_CHAIN" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

for ip in "${CARRIER_IPS[@]}"; do
  # Hopwhistle containers may originate SIP only toward approved FracTEL hosts.
  iptables -w -A "$DOCKER_CHAIN" -s "$DOCKER_NET" -d "$ip/32" -p udp --dport 5060 -j RETURN
  iptables -w -A "$DOCKER_CHAIN" -s "$DOCKER_NET" -d "$ip/32" -p tcp --dport 5060 -j RETURN

  # Carrier signaling may reach only FreeSWITCH's external profile.
  iptables -w -A "$DOCKER_CHAIN" -i "$WAN_IF" -s "$ip/32" -p udp --dport 5080 -j RETURN
  iptables -w -A "$DOCKER_CHAIN" -i "$WAN_IF" -s "$ip/32" -p tcp --dport 5080 -j RETURN
done

for src in "${ANVEO_SIP_SOURCES[@]}" "${TWILIO_SIP_SOURCES[@]}"; do
  iptables -w -A "$DOCKER_CHAIN" -i "$WAN_IF" -s "$src" -p udp --dport 5080 -j RETURN
  iptables -w -A "$DOCKER_CHAIN" -i "$WAN_IF" -s "$src" -p tcp --dport 5080 -j RETURN
done

# ESL is available only to internal Docker workloads.
iptables -w -A "$DOCKER_CHAIN" -s "$DOCKER_NET" -p tcp --dport 8021 -j RETURN

# Block untrusted public SIP, the unused legacy 5070 profile, plain WebSocket,
# and the FreeSWITCH event socket. Browser phones use authenticated WSS 7443.
for port in 5060 5070 5080; do
  iptables -w -A "$DOCKER_CHAIN" -i "$WAN_IF" -p udp --dport "$port" -j DROP
  iptables -w -A "$DOCKER_CHAIN" -i "$WAN_IF" -p tcp --dport "$port" -j DROP
done
iptables -w -A "$DOCKER_CHAIN" -i "$WAN_IF" -p tcp --dport 8021 -j DROP
iptables -w -A "$DOCKER_CHAIN" -i "$WAN_IF" -p tcp --dport 8083 -j DROP
iptables -w -A "$DOCKER_CHAIN" -j RETURN

# ---------------------------------------------------------------------------
# Host-network Dograh Asterisk ports (IPv4)
# ---------------------------------------------------------------------------
# dograh-asterisk uses network_mode=host, so its traffic bypasses DOCKER-USER
# and must be protected in INPUT.
iptables -w -N "$HOST_CHAIN" 2>/dev/null || true
iptables -w -F "$HOST_CHAIN"
while iptables -w -C INPUT -j "$HOST_CHAIN" 2>/dev/null; do
  iptables -w -D INPUT -j "$HOST_CHAIN"
done
iptables -w -I INPUT 1 -j "$HOST_CHAIN"

iptables -w -A "$HOST_CHAIN" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
iptables -w -A "$HOST_CHAIN" -i lo -j RETURN

# Dograh API containers may reach Asterisk control interfaces internally.
for port in 5038 8088 8089; do
  iptables -w -A "$HOST_CHAIN" -s "$DOCKER_NET" -p tcp --dport "$port" -j RETURN
done

# FracTEL is the only public source allowed to signal Dograh Asterisk on 5062.
for ip in "${CARRIER_IPS[@]}"; do
  iptables -w -A "$HOST_CHAIN" -i "$WAN_IF" -s "$ip/32" -p udp --dport 5062 -j RETURN
  iptables -w -A "$HOST_CHAIN" -i "$WAN_IF" -s "$ip/32" -p tcp --dport 5062 -j RETURN
done

# Twilio carries Dograh's outbound AI calls on the `twilio` PJSIP trunk
# (deploy/dograh/twilio-trunk). Its in-dialog requests -- the BYE when the
# callee hangs up, session-timer re-INVITEs -- can arrive after the UDP
# conntrack entry has expired, and from a different Twilio edge IP than the
# one Asterisk dialled, so they are not covered by ESTABLISHED above. Without
# this, a callee hangup is dropped and the AI keeps talking to dead air.
# New inbound calls from Twilio are still refused: the trunk's context is
# `twilio-no-inbound`, which hangs up.
for src in "${TWILIO_SIP_SOURCES[@]}"; do
  iptables -w -A "$HOST_CHAIN" -i "$WAN_IF" -s "$src" -p udp --dport 5062 -j RETURN
  iptables -w -A "$HOST_CHAIN" -i "$WAN_IF" -s "$src" -p tcp --dport 5062 -j RETURN
done

iptables -w -A "$HOST_CHAIN" -i "$WAN_IF" -p udp --dport 5062 -j DROP
iptables -w -A "$HOST_CHAIN" -i "$WAN_IF" -p tcp --dport 5062 -j DROP
for port in 5038 8088 8089; do
  iptables -w -A "$HOST_CHAIN" -i "$WAN_IF" -p tcp --dport "$port" -j DROP
done
iptables -w -A "$HOST_CHAIN" -j RETURN

# ---------------------------------------------------------------------------
# IPv6 telephony attack-surface closure
# ---------------------------------------------------------------------------
# FracTEL signaling is configured with IPv4 addresses only. Block all IPv6
# access to SIP and control ports so Docker's [::] listeners cannot bypass the
# IPv4 allowlists. Authenticated browser WSS on 7443 remains available.
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -w -N "$V6_CHAIN" 2>/dev/null || true
  ip6tables -w -F "$V6_CHAIN"
  while ip6tables -w -C INPUT -j "$V6_CHAIN" 2>/dev/null; do
    ip6tables -w -D INPUT -j "$V6_CHAIN"
  done
  ip6tables -w -I INPUT 1 -j "$V6_CHAIN"

  ip6tables -w -A "$V6_CHAIN" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN
  ip6tables -w -A "$V6_CHAIN" -i lo -j RETURN

  for port in 5060 5070 5080 5062; do
    ip6tables -w -A "$V6_CHAIN" -i "$WAN_IF" -p udp --dport "$port" -j DROP
    ip6tables -w -A "$V6_CHAIN" -i "$WAN_IF" -p tcp --dport "$port" -j DROP
  done
  for port in 8021 8083 5038 8088 8089; do
    ip6tables -w -A "$V6_CHAIN" -i "$WAN_IF" -p tcp --dport "$port" -j DROP
  done
  ip6tables -w -A "$V6_CHAIN" -j RETURN
fi

# ---------------------------------------------------------------------------
# Phone traffic leaves from the floating IP
# ---------------------------------------------------------------------------
# PHONE_IP is a Hetzner floating IP used only for telephony; the website, DNS
# and SSH stay on the host's primary IP. Carriers authorise calls by source
# IP (FracTEL's trunk is set to PHONE_IP), but the kernel sends from the
# primary IP unless told otherwise: FreeSWITCH is behind Docker's MASQUERADE
# and Dograh Asterisk (host network) uses the default route's source. Both
# are rewritten here by source port.
#
# Hetzner does not configure a floating IP on the interface, and neither the
# address nor these NAT rules survive a reboot, which is why they live here.
PHONE_IP="${PHONE_IP:-5.161.16.107}"
SNAT_CHAIN="HOPWHISTLE_PHONE_SNAT"

# `replace` adds the address, or leaves it as is when already present.
ip addr replace "$PHONE_IP/32" dev "$WAN_IF"

iptables -w -t nat -N "$SNAT_CHAIN" 2>/dev/null || true
iptables -w -t nat -F "$SNAT_CHAIN"
while iptables -w -t nat -C POSTROUTING -o "$WAN_IF" -j "$SNAT_CHAIN" 2>/dev/null; do
  iptables -w -t nat -D POSTROUTING -o "$WAN_IF" -j "$SNAT_CHAIN"
done
# First in POSTROUTING, so it runs before Docker's MASQUERADE.
iptables -w -t nat -I POSTROUTING 1 -o "$WAN_IF" -j "$SNAT_CHAIN"

# FreeSWITCH: SIP 5070/5080, RTP 16384-16484.
iptables -w -t nat -A "$SNAT_CHAIN" -p udp -m multiport --sports 5070,5080,16384:16484 -j SNAT --to-source "$PHONE_IP"
iptables -w -t nat -A "$SNAT_CHAIN" -p tcp -m multiport --sports 5070,5080 -j SNAT --to-source "$PHONE_IP"
# Dograh Asterisk: SIP 5062, RTP 20000-20500 (/opt/dograh-asterisk/etc/rtp.conf).
iptables -w -t nat -A "$SNAT_CHAIN" -p udp -m multiport --sports 5062,20000:20500 -j SNAT --to-source "$PHONE_IP"
iptables -w -t nat -A "$SNAT_CHAIN" -p tcp --sport 5062 -j SNAT --to-source "$PHONE_IP"
iptables -w -t nat -A "$SNAT_CHAIN" -j RETURN

# The same rules were first added by hand, straight into POSTROUTING; drop
# those copies so there is one source of truth.
for spec in \
  "-p udp -m multiport --sports 5070,5080,16384:16484" \
  "-p tcp -m multiport --sports 5070,5080" \
  "-p udp --sport 5062" \
  "-p tcp --sport 5062" \
  "-p udp --sport 20000:20500"; do
  # shellcheck disable=SC2086
  while iptables -w -t nat -C POSTROUTING -o "$WAN_IF" $spec -j SNAT --to-source "$PHONE_IP" 2>/dev/null; do
    iptables -w -t nat -D POSTROUTING -o "$WAN_IF" $spec -j SNAT --to-source "$PHONE_IP"
  done
done

# Long-lived SIP flows (OPTIONS keepalives) keep the NAT mapping they were
# created with, so clear them or they go on leaving from the primary IP.
if command -v conntrack >/dev/null 2>&1; then
  for port in 5062 5070 5080; do
    conntrack -D -p udp --orig-port-src "$port" >/dev/null 2>&1 || true
  done
fi
FIREWALL

chmod 0755 "$SCRIPT_PATH"

cat > "$UNIT_PATH" <<'UNIT'
[Unit]
Description=Hopwhistle and Dograh persistent telephony firewall
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/hopwhistle-sip-firewall
ExecReload=/usr/local/sbin/hopwhistle-sip-firewall
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now hopwhistle-sip-firewall.service
systemctl restart hopwhistle-sip-firewall.service

echo "=== PERSISTENT TELEPHONY FIREWALL ==="
systemctl is-enabled hopwhistle-sip-firewall.service
systemctl is-active hopwhistle-sip-firewall.service
iptables -C DOCKER-USER -j "$DOCKER_CHAIN"
iptables -C INPUT -j "$HOST_CHAIN"
iptables -S "$DOCKER_CHAIN"
iptables -S "$HOST_CHAIN"
if command -v ip6tables >/dev/null 2>&1; then
  ip6tables -C INPUT -j "$V6_CHAIN"
  ip6tables -S "$V6_CHAIN"
fi
ip -4 addr show dev "$WAN_IF" | grep inet
iptables -t nat -S HOPWHISTLE_PHONE_SNAT
iptables -t nat -S POSTROUTING

echo "PERSISTENT TELEPHONY FIREWALL INSTALLED"