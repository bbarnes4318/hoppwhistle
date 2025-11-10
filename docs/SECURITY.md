# Security, Authorization, and Audit Implementation

## Overview

This document describes the comprehensive security, authorization, and audit system implemented for Hopwhistle, ensuring least privilege access with full traceability.

## Features Implemented

### 1. Role-Based Access Control (RBAC)

**Roles:**

- `OWNER` - Full access to all resources (admin:\*)
- `ADMIN` - Full management access except tenant-level operations
- `ANALYST` - Read-only access to calls, recordings, reports, campaigns, flows, numbers
- `PUBLISHER` - Can read/write/publish flows and campaigns, read calls and recordings
- `BUYER` - Can read/write calls, read recordings and campaigns
- `READONLY` - Read-only access to calls, recordings, campaigns, flows, numbers, reports

**Permission System:**

- Granular permissions following `resource:action` pattern (e.g., `calls:read`, `users:write`)
- Wildcard support (`admin:*` grants all permissions)
- Role-based permission mappings with custom permission overrides

**Usage:**

```typescript
import { requirePermission } from '@/middleware/rbac';

// Protect route with permission check
fastify.post(
  '/users',
  {
    preHandler: [authenticate, requirePermission('users:write')],
  },
  handler
);
```

### 2. API Key Scopes

**Features:**

- Per-tenant API keys with scoped permissions
- Database-backed validation with SHA-256 hashing
- Expiration and status tracking
- Last-used timestamp updates

**Scope Format:**

- Array of permission strings (e.g., `["calls:read", "calls:write"]`)
- Supports same permission format as RBAC

**Database Schema:**

```prisma
model ApiKey {
  scopes      Json     // Array of scope strings
  rateLimit   Int?     // Requests per minute
  expiresAt   DateTime?
  status      ApiKeyStatus
}
```

### 3. Rate Limiting

**Implementation:**

- Per-API-key rate limiting (configurable per key)
- Per-IP rate limiting (default: 100 requests/minute)
- Redis-backed distributed rate limiting
- Rate limit headers in responses (`X-RateLimit-*`)

**Configuration:**

- Default: 100 requests per minute per IP
- API keys can have custom rate limits
- Configurable time windows

**Audit:**

- All rate limit violations are logged to audit trail

### 4. CSRF Protection

**Features:**

- HMAC-based CSRF token generation
- Session-bound tokens
- Protection for state-changing operations (POST, PUT, PATCH, DELETE)
- Skipped for API key authentication (browser sessions only)

**Implementation:**

- Tokens generated per session
- Verified on state-changing requests
- Failed attempts logged to audit trail

**Usage:**

```typescript
import { csrfProtection } from '@/middleware/csrf';

fastify.post(
  '/sensitive-action',
  {
    preHandler: [authenticate, csrfProtection],
  },
  handler
);
```

### 5. Session Management

**Features:**

- Secure HTTP-only cookies
- Strict SameSite policy
- Redis-backed session storage
- Configurable session duration (default: 24 hours)

**Security:**

- `httpOnly: true` - Prevents JavaScript access
- `secure: true` in production - HTTPS only
- `sameSite: 'strict'` - CSRF protection

### 6. Audit Trail

**Comprehensive Logging:**

- All entity changes (create, update, delete)
- Sensitive reads (user data, API keys, etc.)
- Authentication events (login, logout, failures)
- Authorization failures
- Rate limit violations
- CSRF violations

**Audit Log Schema:**

```prisma
model AuditLog {
  tenantId    String
  userId      String?
  apiKeyId    String?
  action      String      // e.g., "user.create", "call.read"
  entityType  String      // e.g., "User", "Call"
  entityId    String?
  resource    String?     // Resource path
  method      String?     // HTTP method
  changes     Json?       // Before/after values
  ipAddress   String?
  userAgent   String?
  requestId   String?     // Request correlation ID
  success     Boolean
  error       String?
}
```

**Helper Functions:**

```typescript
import { auditCreate, auditUpdate, auditDelete, auditRead } from '@/services/audit';

// Log entity creation
await auditCreate(tenantId, 'User', userId, data, { userId, ipAddress, ... });

// Log entity update
await auditUpdate(tenantId, 'User', userId, before, after, { userId, ... });

// Log sensitive read
await auditRead(tenantId, 'User', userId, '/api/users/123', { userId, ... });
```

### 7. Secrets Management

**Implementation:**

- Development: `dotenv-flow` for environment-based secrets
- Production: Placeholder for DigitalOcean Secrets Manager / AWS KMS
- Centralized secrets access via `SecretsManager`

**Usage:**

```typescript
import { secrets } from '@/services/secrets';

const jwtSecret = secrets.getRequired('JWT_SECRET');
const dbUrl = secrets.get('DATABASE_URL');
```

## Security Best Practices

### Authentication

- JWT tokens with user validation
- API keys hashed with SHA-256
- User status and tenant status checks
- Last login tracking

### Authorization

- Least privilege principle enforced
- Permission checks on all protected routes
- Role-based access with custom permission overrides
- API key scopes for programmatic access

### Rate Limiting

- Per-key and per-IP limits
- Distributed rate limiting via Redis
- Configurable limits per API key

### CSRF Protection

- Session-bound tokens
- HMAC verification
- Only for browser sessions (not API keys)

### Audit Trail

- Immutable audit logs
- Full request context (IP, user agent, request ID)
- Success/failure tracking
- Correlation via request IDs

## Privilege Escalation Prevention

**Test Coverage:**

- Tests prevent READONLY users from assigning OWNER role
- Tests prevent creating users with elevated roles
- Tests verify API key scope enforcement
- All attempts are audited

**Implementation:**

- Database constraints prevent direct role assignment
- Authorization middleware checks permissions before operations
- Failed attempts logged to audit trail

## Migration Required

After implementing these changes, run:

```bash
# Generate Prisma client with new schema
pnpm --filter @hopwhistle/api db:generate

# Create migration
pnpm --filter @hopwhistle/api db:migrate

# Seed default roles
# (Update seed.ts to create OWNER, ADMIN, ANALYST, PUBLISHER, BUYER, READONLY roles)
```

## Environment Variables

```bash
# Required
JWT_SECRET=your-secret-key-change-in-production
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# Optional (for production secrets manager)
DIGITALOCEAN_TOKEN=...
AWS_KMS_KEY_ID=...

# CSRF (defaults to JWT_SECRET if not set)
CSRF_SECRET=...
```

## Testing

Run security tests:

```bash
pnpm --filter @hopwhistle/api test security
```

The test suite verifies:

- Privilege escalation prevention
- API key scope enforcement
- Rate limiting
- Audit trail logging
