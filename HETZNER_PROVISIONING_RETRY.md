# Hetzner Provisioning Retry Checklist

Do not retry production cutover. Retry provisioning only.

## Do not retry blindly

Do not keep retrying server creation until one of the following is confirmed:

- Hetzner support confirms the `server_limit` has been raised on the exact project.
- The account owner confirms billing/account verification is complete.
- The correct project has been selected.
- The API token has Read & Write permission for the correct project.
- The Hetzner Console shows the project can create at least one server.

If the same `resource_limit_exceeded` error appears again, stop and escalate instead of retrying repeatedly.

---

## Prerequisites:
- Hetzner confirms server limit has been increased.
- Billing/account verification is complete.
- API token has Read & Write permission.
- SSH key `hetzner_pvn` is available.
- Correct Hetzner project is selected.
- Correct location and server type are selected.

## Retry steps:
1. Confirm project limits allow at least 1 server.
2. Upload or confirm SSH key `hetzner_pvn` exists.
3. Create server:
   - Type: CX33 or selected production size
   - Image: Ubuntu 24.04 LTS or approved production image
   - Public IPv4: enabled
   - Backups: enabled if desired
   - Firewall: attach production firewall rules
   - Name: `hopwhistle-prod-hetzner`
4. Confirm server has public IPv4.
5. SSH into server.
6. Install Docker, Docker Compose, Git, AWS CLI, rclone, wscat, and required OS packages.
7. Clone/pull branch `edit-campaign-buyer-fix`.
8. Run `HETZNER_DEPLOYMENT_VALIDATION.md`.
9. Do not approve DNS/carrier cutover until every validation passes.

---

## Authorized fallback options

If this project remains blocked, the account owner may choose one of these options:

1. Ask Hetzner to apply the server limit increase to the correct project.
2. Create a new Hetzner Cloud project under the same verified account and generate a new Read/Write API token.
3. Use another verified Hetzner account/project only if authorized by the business owner.
4. Temporarily continue operating on AWS until Hetzner provisioning is available.

*   Do not use Vultr as the migration source.
*   Do not cut DNS to an unvalidated server.
*   Do not stop AWS production services.

---

## Firewall Requirements

Required ports to review before SIP/call testing:
- 22 TCP: SSH, restricted to admin IPs if possible
- 80 TCP: HTTP / cert validation
- 443 TCP: HTTPS / web / WSS
- 3000 TCP: web app if exposed temporarily, preferably internal only
- 3001 TCP: API if exposed temporarily, preferably internal only
- 5060 UDP/TCP: SIP
- 5061 TCP: SIP TLS if used
- 5070 UDP/TCP: Vapi SIP profile if used
- 5080 UDP/TCP: FreeSWITCH external SIP if used
- 7443 TCP: secure WebSocket/WebRTC if used
- 8082/8083 TCP: FreeSWITCH event/socket/web interfaces only if required and protected
- 16384-16484 UDP or configured RTP range: RTP media
- 8021 TCP: FreeSWITCH ESL, do NOT expose publicly

Security warning:
Do not expose PostgreSQL, Redis, ClickHouse, MinIO admin, FreeSWITCH ESL, or Docker ports publicly unless explicitly secured.
