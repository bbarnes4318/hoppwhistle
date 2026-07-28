#!/usr/bin/env bash
set -euo pipefail

CHAIN="HOPWHISTLE_SIP_GUARD"
WAN_IF="${WAN_IF:-eth0}"
DOCKER_NET="${DOCKER_NET:-172.16.0.0/12}"
SCRIPT_PATH="/usr/local/sbin/hopwhistle-sip-firewall"
UNIT_PATH="/etc/systemd/system/hopwhistle-sip-firewall.service"

CARRIER_IPS=(
  137.220.61.54
  144.202.122.62
  74.201.72.61
  45.77.108.216
  14.1.29.149
  64.42.183.253
)

cat > "$SCRIPT_PATH" <<'FIREWALL'
#!/usr/bin/env bash
set -euo pipefail

CHAIN="HOPWHISTLE_SIP_GUARD"
WAN_IF="${WAN_IF:-eth0}"
DOCKER_NET="${DOCKER_NET:-172.16.0.0/12}"
CARRIER_IPS=(
  137.220.61.54
  144.202.122.62
  74.201.72.61
  45.77.108.216
  14.1.29.149
  64.42.183.253
)

iptables -w -N "$CHAIN" 2>/dev/null || true
iptables -w -F "$CHAIN"

# Ensure exactly one jump at the top of DOCKER-USER.
while iptables -w -C DOCKER-USER -j "$CHAIN" 2>/dev/null; do
  iptables -w -D DOCKER-USER -j "$CHAIN"
done
iptables -w -I DOCKER-USER 1 -j "$CHAIN"

iptables -w -A "$CHAIN" -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN

for ip in "${CARRIER_IPS[@]}"; do
  # Permit Hopwhistle containers to originate SIP toward approved FracTEL gateways.
  iptables -w -A "$CHAIN" -s "$DOCKER_NET" -d "$ip/32" -p udp --dport 5060 -j RETURN
  iptables -w -A "$CHAIN" -s "$DOCKER_NET" -d "$ip/32" -p tcp --dport 5060 -j RETURN

  # Permit approved carrier traffic to FreeSWITCH's external SIP profile only.
  iptables -w -A "$CHAIN" -i "$WAN_IF" -s "$ip/32" -p udp --dport 5080 -j RETURN
  iptables -w -A "$CHAIN" -i "$WAN_IF" -s "$ip/32" -p tcp --dport 5080 -j RETURN
done

# ESL is internal Docker traffic only.
iptables -w -A "$CHAIN" -s "$DOCKER_NET" -p tcp --dport 8021 -j RETURN

# Block all untrusted public SIP, the unused legacy 5070 profile, plain WebSocket,
# and the FreeSWITCH event socket. Browser phones use authenticated WSS on 7443.
for port in 5060 5070 5080; do
  iptables -w -A "$CHAIN" -i "$WAN_IF" -p udp --dport "$port" -j DROP
  iptables -w -A "$CHAIN" -i "$WAN_IF" -p tcp --dport "$port" -j DROP
done
iptables -w -A "$CHAIN" -i "$WAN_IF" -p tcp --dport 8021 -j DROP
iptables -w -A "$CHAIN" -i "$WAN_IF" -p tcp --dport 8083 -j DROP
iptables -w -A "$CHAIN" -j RETURN
FIREWALL

chmod 0755 "$SCRIPT_PATH"

cat > "$UNIT_PATH" <<'UNIT'
[Unit]
Description=Hopwhistle persistent SIP firewall
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

echo "=== PERSISTENT SIP FIREWALL ==="
systemctl is-enabled hopwhistle-sip-firewall.service
systemctl is-active hopwhistle-sip-firewall.service
iptables -C DOCKER-USER -j "$CHAIN"
iptables -S "$CHAIN"

echo "PERSISTENT SIP FIREWALL INSTALLED"
