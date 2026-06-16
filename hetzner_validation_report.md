# BLOCKER: Hetzner Cloud server_limit is 0

Provisioning failed because the Hetzner Cloud project rejected server creation with `resource_limit_exceeded` / `server_limit` reached.

Current impact:
- No Hetzner VM can be created.
- Docker validation cannot run.
- Application stack cannot be started.
- Database restore cannot be tested.
- Recordings sync cannot be tested.
- FreeSWITCH/SIP/WSS cannot be tested.
- DNS/carrier cutover is blocked.

Required resolution:
- Project/account administrator must resolve Hetzner Cloud server limit.
- Request a server limit increase from Hetzner support or complete any required account/billing verification.
- After the limit is raised, retry provisioning.

---

# Hetzner Server Validation Report

This report documents the status of the Hetzner server validation checks executed as part of the AWS-to-Hetzner migration for Hoppwhistle.

---

## 1. Executive Summary

During the initial server provisioning stage, the Hetzner Cloud API returned a **Forbidden / Resource Limit Exceeded** error when attempting to create the target virtual server instance. No virtual servers currently exist in the project, indicating that the current limit is set to zero (0). Because of this blocker, we cannot access the Hetzner host or execute any server-level validation checks.

*   **Final Status**: **NOT READY — BLOCKERS FOUND**
*   **Recommendation**: Contact Hetzner Cloud support or the account administrator to request a limit increase for the `server_limit` parameter in the `hopwhistle` project.

---

## 2. Detailed Validation Report

### A. Server
- **Hostname**: `BLOCKED — Server could not be provisioned`
- **Docker**: `BLOCKED`
- **Docker Compose**: `BLOCKED`
- **RAM**: `BLOCKED`
- **Disk**: `BLOCKED`

### B. Branch
- **Branch**: `edit-campaign-buyer-fix`
- **Local SHA**: `799f7f55c5a60f4ce1f5407e71ad9e37b6fa987c`
- **Remote SHA**: `799f7f55c5a60f4ce1f5407e71ad9e37b6fa987c`
- **Match**: `BLOCKED`
- **Working tree clean**: `BLOCKED`

### C. Environment
- **.env exists**: `BLOCKED`
- **Required env vars present**: `BLOCKED`
- **Missing vars**: `N/A (env file could not be verified on target host)`

### D. Docker
- **compose config**: `BLOCKED`
- **build**: `BLOCKED`
- **up -d**: `BLOCKED`
- **running containers**: `None`
- **failed containers**: `None`

### E. App health
- **API live**: `BLOCKED`
- **API ready**: `BLOCKED`
- **Web**: `BLOCKED`

### F. Data services
- **PostgreSQL**: `BLOCKED`
- **Redis**: `BLOCKED`
- **ClickHouse**: `BLOCKED`
- **S3/MinIO**: `BLOCKED`

### G. Telephony
- **FreeSWITCH**: `BLOCKED`
- **external profile**: `BLOCKED`
- **vapi profile**: `BLOCKED`
- **public_ip variable**: `BLOCKED`
- **sip_public_ip variable**: `BLOCKED`
- **domain variable**: `BLOCKED`
- **WSS**: `BLOCKED`
- **outbound call**: `NOT TESTED`
- **inbound call**: `NOT TESTED`
- **two-way audio**: `NOT TESTED`

### H. Recordings
- **AWS recordings sync**: `NOT TESTED`
- **S3 bucket accessible**: `BLOCKED`
- **upload test**: `NOT TESTED`
- **playback test**: `NOT TESTED`

---

## 3. Final Recommendation

**NOT READY — BLOCKERS FOUND**

*This branch must not be used for DNS/carrier cutover until the Hetzner host is provisioned, and all validation steps in `HETZNER_DEPLOYMENT_VALIDATION.md` successfully pass.*
