Subject: Request to increase Hetzner Cloud server limit for production migration

Hello Hetzner Support,

We are preparing a production migration for our Hoppwhistle application from AWS to Hetzner Cloud.

When attempting to provision a Cloud server in our project, the API returned:

  resource_limit_exceeded
  server limit reached
  The project limit for server_limit has been exceeded.

The project appears to have a server limit of 0, so we cannot create even one virtual server.

Please increase the Cloud server limit for this project so we can provision at least one production VM.

Initial requested capacity:
- 1 production server, preferably CX33 or equivalent
- Ability to add at least 1 additional temporary validation/rollback server if needed
- Public IPv4
- Firewall support
- Volume support if required

Use case:
- Production VoIP / communications application
- Docker-based deployment
- PostgreSQL, Redis, ClickHouse, MinIO/S3-compatible storage
- FreeSWITCH / SIP / WSS validation before cutover
- Migration source is AWS; Hetzner will become the production target after validation

We can provide any billing/account verification information required.

Thank you.
