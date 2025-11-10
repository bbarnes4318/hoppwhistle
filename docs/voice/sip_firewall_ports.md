# SIP Firewall Ports Configuration

This document outlines the firewall ports that must be opened for the voice stack to function properly.

## Required Ports

### Kamailio (SBC) - Edge Server

| Port | Protocol | Direction | Purpose                   |
| ---- | -------- | --------- | ------------------------- |
| 5060 | UDP      | Inbound   | SIP signaling (primary)   |
| 5060 | TCP      | Inbound   | SIP signaling (fallback)  |
| 5061 | TLS      | Inbound   | SIP over TLS (if enabled) |

### FreeSWITCH (Media Server)

| Port | Protocol | Direction | Purpose                       |
| ---- | -------- | --------- | ----------------------------- |
| 5080 | UDP      | Inbound   | SIP signaling (from Kamailio) |
| 5080 | TCP      | Inbound   | SIP signaling (from Kamailio) |
| 5081 | TLS      | Inbound   | SIP over TLS (if enabled)     |
| 8021 | TCP      | Inbound   | Event Socket Interface (ESL)  |

### RTPEngine (RTP Proxy)

| Port Range  | Protocol | Direction        | Purpose           |
| ----------- | -------- | ---------------- | ----------------- |
| 10000-20000 | UDP      | Inbound/Outbound | RTP media streams |

**Note**: The RTP port range is configurable via `RTP_START` and `RTP_END` environment variables.

## Cloud Provider Firewall Rules

### AWS Security Groups

```bash
# SIP Signaling
- Type: Custom UDP, Port: 5060, Source: 0.0.0.0/0
- Type: Custom TCP, Port: 5060, Source: 0.0.0.0/0
- Type: Custom TCP, Port: 5061, Source: 0.0.0.0/0 (if TLS enabled)

# FreeSWITCH Internal
- Type: Custom UDP, Port: 5080, Source: <Kamailio IP>
- Type: Custom TCP, Port: 5080, Source: <Kamailio IP>
- Type: Custom TCP, Port: 8021, Source: <API Server IP> (restrict to internal)

# RTP Media
- Type: Custom UDP, Port: 10000-20000, Source: 0.0.0.0/0
```

### Google Cloud Platform (GCP)

```bash
# Create firewall rules
gcloud compute firewall-rules create allow-sip-udp \
  --allow udp:5060 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow SIP UDP"

gcloud compute firewall-rules create allow-sip-tcp \
  --allow tcp:5060 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow SIP TCP"

gcloud compute firewall-rules create allow-rtp \
  --allow udp:10000-20000 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow RTP media"
```

### Azure Network Security Groups

```json
{
  "name": "Allow-SIP-UDP",
  "properties": {
    "protocol": "Udp",
    "sourcePortRange": "*",
    "destinationPortRange": "5060",
    "sourceAddressPrefix": "*",
    "destinationAddressPrefix": "*",
    "access": "Allow",
    "priority": 1000
  }
}
```

## Linux Firewall (iptables)

```bash
# SIP Signaling
iptables -A INPUT -p udp --dport 5060 -j ACCEPT
iptables -A INPUT -p tcp --dport 5060 -j ACCEPT
iptables -A INPUT -p tcp --dport 5061 -j ACCEPT

# FreeSWITCH Internal (restrict to Kamailio IP)
iptables -A INPUT -p udp --dport 5080 -s <KAMAILIO_IP> -j ACCEPT
iptables -A INPUT -p tcp --dport 5080 -s <KAMAILIO_IP> -j ACCEPT

# RTP Media
iptables -A INPUT -p udp --dport 10000:20000 -j ACCEPT

# Save rules
iptables-save > /etc/iptables/rules.v4
```

## Linux Firewall (firewalld)

```bash
# SIP Signaling
firewall-cmd --permanent --add-port=5060/udp
firewall-cmd --permanent --add-port=5060/tcp
firewall-cmd --permanent --add-port=5061/tcp

# RTP Media
firewall-cmd --permanent --add-port=10000-20000/udp

# Reload
firewall-cmd --reload
```

## Windows Firewall (PowerShell)

```powershell
# SIP UDP
New-NetFirewallRule -DisplayName "SIP UDP" -Direction Inbound -Protocol UDP -LocalPort 5060 -Action Allow

# SIP TCP
New-NetFirewallRule -DisplayName "SIP TCP" -Direction Inbound -Protocol TCP -LocalPort 5060 -Action Allow

# RTP UDP Range
New-NetFirewallRule -DisplayName "RTP Media" -Direction Inbound -Protocol UDP -LocalPort 10000-20000 -Action Allow
```

## SignalWire IP Ranges

Allow inbound SIP from SignalWire's SIP proxy IPs. Check SignalWire documentation for current IP ranges:

- SignalWire publishes their IP ranges in their documentation
- Common ranges include: `54.x.x.x/16`, `52.x.x.x/16` (verify current ranges)

## Outbound Ports

Ensure outbound connectivity for:

- **SIP Registration**: UDP/TCP 5060 to SignalWire proxies
- **HTTP/HTTPS**: TCP 443/80 for webhook callbacks to your API
- **DNS**: UDP 53 for domain resolution

## Testing Firewall Rules

```bash
# Test SIP port from external host
nc -u -v YOUR_PUBLIC_IP 5060

# Test RTP port range
nc -u -v YOUR_PUBLIC_IP 10000

# Check if ports are listening
netstat -tuln | grep -E '5060|5080|10000'
```

## Security Recommendations

1. **Restrict FreeSWITCH ports (5080, 8021)** to only allow connections from Kamailio and your API servers
2. **Use TLS for SIP** (port 5061) in production
3. **Monitor for port scans** and unauthorized access attempts
4. **Implement rate limiting** at the firewall level for SIP ports
5. **Use fail2ban** or similar to block malicious IPs
6. **Restrict RTP ports** to known carrier IP ranges if possible (may be difficult with dynamic IPs)

## Troubleshooting

### Calls Fail with "Connection Refused"

- Verify firewall rules are active: `iptables -L -n` or `firewall-cmd --list-all`
- Check if services are listening: `netstat -tuln`
- Test from external host: `telnet YOUR_IP 5060`

### One-Way Audio

- Verify RTP port range is open: `nc -u -v YOUR_IP 10000`
- Check RTPEngine logs: `docker logs rtpengine`
- Ensure `PUBLIC_IP` environment variable matches actual public IP

### Registration Fails

- Check outbound firewall allows connections to SignalWire
- Verify DNS resolution: `nslookup sip.us-east.sip.signalwire.com`
- Test connectivity: `nc -v sip.us-east.sip.signalwire.com 5060`
