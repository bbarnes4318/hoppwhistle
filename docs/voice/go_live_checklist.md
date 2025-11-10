# Go-Live Checklist

Use this checklist before deploying the voice stack to production.

## Pre-Deployment

### Infrastructure

- [ ] VM/server provisioned with sufficient resources (CPU, RAM, disk)
- [ ] Public IP address assigned and static
- [ ] DNS records configured:
  - [ ] `sbc.yourdomain.com` → SBC public IP
  - [ ] `media.yourdomain.com` → Media server public IP (if different)
- [ ] Firewall rules configured (see `sip_firewall_ports.md`)
- [ ] TLS certificates generated/obtained (if using TLS)
- [ ] Recording storage path created with sufficient space

### Configuration

- [ ] `.env.voice` file created from `.env.voice.example`
- [ ] All environment variables filled with production values
- [ ] `PUBLIC_IP` matches actual server public IP
- [ ] `SBC_DOMAIN` and `MEDIA_DOMAIN` match DNS records
- [ ] SignalWire SIP credentials configured
- [ ] `API_BASE_URL` points to production API
- [ ] `API_ADMIN_TOKEN` is valid and has required permissions
- [ ] RTP port range (`RTP_START`-`RTP_END`) doesn't conflict with other services

### SignalWire Setup

- [ ] SIP credentials created in SignalWire Console
- [ ] SIP endpoint/trunk configured with SBC IP
- [ ] DIDs assigned to inbound trunk
- [ ] Outbound proxy configured correctly
- [ ] Test DID available for smoke testing

### Security

- [ ] TLS certificates installed (if using TLS)
- [ ] Firewall restricts FreeSWITCH ports to Kamailio IP only
- [ ] `FS_ESL_PASSWORD` changed from default
- [ ] API admin token is strong and secure
- [ ] Recording storage has appropriate permissions
- [ ] Logs don't contain sensitive credentials

## Deployment

### Build and Start Services

- [ ] Docker images built: `docker compose -f infra/docker/docker-compose.voice.yml build`
- [ ] Services started: `docker compose -f infra/docker/docker-compose.voice.yml up -d`
- [ ] All containers running: `docker ps`
- [ ] No container crashes: `docker ps -a`

### Verification

- [ ] Kamailio listening on port 5060: `netstat -tuln | grep 5060`
- [ ] FreeSWITCH listening on port 5080: `netstat -tuln | grep 5080`
- [ ] RTPEngine running: `docker logs rtpengine | grep -i started`
- [ ] FreeSWITCH gateway registered to SignalWire:
  - [ ] Check SignalWire Console → SIP → Registrations
  - [ ] Or: `docker exec freeswitch fs_cli -x "sofia status gateway signalwire"`
- [ ] Kamailio dispatcher configured: `docker exec sbc-kamailio kamcmd dispatcher.list`

### Smoke Test

- [ ] Run smoke test script: `./scripts/smoke_call_test.sh`
- [ ] Place test call to DID:
  - [ ] Call connects
  - [ ] IVR plays
  - [ ] Audio is clear (both directions)
  - [ ] Call records successfully
- [ ] Check recording file exists: `ls -lh ${RECORDINGS_PATH}`
- [ ] Verify webhook received: Check API logs for `recording.ready` event

### Monitoring

- [ ] Log aggregation configured (if applicable)
- [ ] Metrics collection enabled (if applicable)
- [ ] Alerting configured for:
  - [ ] Service downtime
  - [ ] High error rates
  - [ ] Disk space (recordings)
  - [ ] CPU/memory usage

## Post-Deployment

### Documentation

- [ ] Network topology diagram updated
- [ ] Runbook created for common issues
- [ ] Escalation contacts documented
- [ ] Rollback procedure tested

### Backup

- [ ] Configuration files backed up
- [ ] TLS certificates backed up securely
- [ ] Recording retention policy configured
- [ ] Backup storage configured (if applicable)

### Testing

- [ ] Inbound calls work from multiple carriers
- [ ] Outbound calls work to multiple destinations
- [ ] Recording quality acceptable
- [ ] Webhook delivery reliable
- [ ] Load testing completed (if applicable)

## Rollback Plan

If issues occur:

1. **Stop services**: `docker compose -f infra/docker/docker-compose.voice.yml down`
2. **Review logs**: `docker logs sbc-kamailio`, `docker logs freeswitch`, `docker logs rtpengine`
3. **Check configuration**: Verify `.env.voice` values
4. **Test connectivity**: Verify firewall and network
5. **Restore from backup** (if configuration changed)
6. **Restart services**: `docker compose -f infra/docker/docker-compose.voice.yml up -d`

## Common Issues

### Services Won't Start

- Check Docker logs: `docker logs <container-name>`
- Verify environment variables: `docker exec <container> env`
- Check port conflicts: `netstat -tuln | grep -E '5060|5080'`
- Verify file permissions on mounted volumes

### Registration Fails

- Verify SignalWire credentials
- Check firewall allows outbound SIP
- Verify `SIGNALWIRE_OUTBOUND_PROXY` is correct
- Check FreeSWITCH logs for authentication errors

### One-Way Audio

- Verify RTP ports are open
- Check `PUBLIC_IP` matches actual IP
- Verify RTPEngine is running
- Check NAT traversal settings

### Recordings Not Created

- Verify recording path exists and is writable
- Check FreeSWITCH logs for recording errors
- Verify disk space available
- Check dialplan recording configuration

## Support Contacts

- **SignalWire Support**: [support.signalwire.com](https://support.signalwire.com)
- **Internal Escalation**: [Your team contact]
- **On-Call Engineer**: [Contact info]

## Sign-Off

- [ ] Technical Lead: **\*\*\*\***\_**\*\*\*\*** Date: **\_\_\_**
- [ ] Operations Lead: **\*\*\*\***\_**\*\*\*\*** Date: **\_\_\_**
- [ ] Product Owner: **\*\*\*\***\_**\*\*\*\*** Date: **\_\_\_**

---

**Last Updated**: [Date]
**Version**: 1.0
