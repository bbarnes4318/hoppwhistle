# FreeSWITCH SIP Profiles

This directory contains SIP profile configurations for FreeSWITCH.

## Profiles

### internal.xml

- **Port**: 5080 (UDP/TCP)
- **Purpose**: Internal SIP communications (phones, softphones)
- **Authentication**: Required
- **TLS**: Optional (disabled by default)
- **SRTP**: Optional (disabled by default)
- **Context**: `internal`

### external.xml

- **Port**: 5060 (UDP/TCP)
- **Purpose**: External trunk connections (carriers, providers)
- **Authentication**: Required (IP-based or SIP auth)
- **TLS**: Optional (configurable via `ENABLE_TLS` env var)
- **SRTP**: Optional (configurable via `ENABLE_SRTP` env var)
- **Context**: `trunk`

## Environment Variables

- `ENABLE_TLS`: Enable TLS for external profile (true/false)
- `ENABLE_SRTP`: Enable SRTP (true/false/optional)
- `TRUNK_AUTH_IP`: IP address for trunk authentication

## TLS Configuration

To enable TLS:

1. Set `ENABLE_TLS=true` in environment
2. Place certificates in `/usr/local/freeswitch/conf/tls/`
3. TLS will be available on port 5061

## SRTP Configuration

To enable SRTP:

1. Set `ENABLE_SRTP=true` or `ENABLE_SRTP=optional` in environment
2. Clients must support SRTP for secure media
