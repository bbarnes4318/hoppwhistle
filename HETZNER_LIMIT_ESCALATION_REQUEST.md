Subject: Escalation: Cloud project still blocked by server_limit after retry

Hello Hetzner Support,

We are following up on a production migration blocker for our Hoppwhistle application.

We attempted to provision a Cloud server again, but the API still returned:

  resource_limit_exceeded
  server limit reached
  The project limit for server_limit has been exceeded.

This is blocking our production migration from AWS to Hetzner.

Current impact:
- We cannot create any Cloud server in this project.
- No Hetzner VM can be provisioned.
- Docker validation cannot run.
- Database restore validation cannot run.
- Recordings/S3 validation cannot run.
- FreeSWITCH/SIP/WSS validation cannot run.
- DNS/carrier cutover is blocked.

Please confirm:
1. Whether the Cloud server limit for this exact project is still set to 0.
2. Whether the limit increase was applied to a different project or account.
3. Whether additional billing/account verification is required.
4. Whether our API token/project is restricted from creating servers.
5. What exact action is required so we can create at least one CX33 server.

Requested minimum capacity:
- At least 1 production validation server now.
- Preferably ability to create 2 servers temporarily during migration/rollback validation.
- Server type: CX33 or equivalent.
- Public IPv4 enabled.
- Firewall support.
- Optional volume/backups support.

Use case:
- Production VoIP / communications application.
- Docker-based deployment.
- PostgreSQL, Redis, ClickHouse, and S3/MinIO-compatible storage.
- FreeSWITCH/SIP/WSS validation before production cutover.
- AWS remains the current source of truth until Hetzner validation passes.

Please advise once the limit is active on this exact project so we can retry provisioning.

Thank you.
