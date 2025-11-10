# Cost Controls & Quotas

## Overview

Hopwhistle implements comprehensive per-tenant quotas and budget controls to prevent runaway spend. The system enforces hard limits with optional override tokens and sends alerts when thresholds are exceeded.

## Features

### Quotas

- **Max Concurrent Calls**: Limits the number of simultaneous active calls
- **Max Minutes Per Day**: Limits total call minutes per day
- **Max Phone Numbers**: Limits the number of phone numbers a tenant can own
- **Max Recording Retention Days**: Limits how long recordings are retained
- **Max Storage GB**: Limits total storage usage

### Budgets

- **Daily Budget**: Maximum spend per day (USD)
- **Monthly Budget**: Maximum spend per month (USD)
- **Alert Threshold**: Percentage at which to send alerts (default: 80%)
- **Hard Stop**: Block new calls when budget exceeded
- **Override Token**: Secure token to bypass budget limits temporarily

### Alerts

- **Email Alerts**: Sent to configured email addresses
- **Slack Alerts**: Sent to configured Slack webhook
- **Alert Types**:
  - Daily threshold reached
  - Daily budget exceeded
  - Monthly threshold reached
  - Monthly budget exceeded

## API Usage

### Check Quota Status

```bash
GET /admin/api/v1/tenants/:tenantId/quota/status
```

Returns current usage for all quotas and budgets.

### Update Quota

```bash
PATCH /admin/api/v1/tenants/:tenantId/quota
Content-Type: application/json

{
  "maxConcurrentCalls": 100,
  "maxMinutesPerDay": 10000,
  "maxPhoneNumbers": 50,
  "maxRecordingRetentionDays": 90,
  "maxStorageGB": 1000,
  "enabled": true
}
```

### Update Budget

```bash
PATCH /admin/api/v1/tenants/:tenantId/budget
Content-Type: application/json

{
  "monthlyBudget": 1000,
  "dailyBudget": 50,
  "alertThreshold": 80,
  "alertEmails": ["admin@example.com", "finance@example.com"],
  "alertSlackWebhook": "https://hooks.slack.com/services/...",
  "hardStopEnabled": true,
  "enabled": true
}
```

### Generate Override Token

```bash
POST /admin/api/v1/tenants/:tenantId/budget/override-token
Content-Type: application/json

{
  "expiresInHours": 24
}
```

Returns:

```json
{
  "token": "qot_abc123...",
  "expiresAt": "2024-01-02T12:00:00Z",
  "expiresInHours": 24
}
```

### Use Override Token

Include the token in the `X-Quota-Override` header:

```bash
POST /api/v1/calls
X-Quota-Override: qot_abc123...
Content-Type: application/json

{
  "toNumber": "+15551234567",
  "estimatedMinutes": 5,
  "estimatedCost": 0.10
}
```

## Call Creation with Quota Checks

When creating a call via `POST /api/v1/calls`, the system automatically checks:

1. **Concurrent Calls Quota**: Ensures tenant hasn't exceeded max concurrent calls
2. **Daily Minutes Quota**: Ensures estimated minutes won't exceed daily limit
3. **Budget**: Ensures estimated cost won't exceed daily/monthly budget

If any check fails, the request returns `403 Forbidden` with details:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Concurrent call limit exceeded: 10/10",
    "current": 10,
    "limit": 10,
    "remaining": 0
  }
}
```

## Admin UI

Access quota management at `/settings/quotas`:

- **Current Usage Dashboard**: Real-time view of quota and budget usage
- **Quota Settings**: Configure all quota limits
- **Budget Settings**: Configure budgets and alerts
- **Override Tokens**: Generate and manage override tokens
- **Quota Overrides**: View and manage temporary quota overrides

## Testing

Run the quota overage test script:

```bash
pnpm --filter @hopwhistle/api quota:test --tenant=<tenant-id>
```

This script:

1. Sets up test quotas with low limits
2. Simulates quota overages
3. Verifies alerts are sent
4. Verifies hard stops work
5. Tests override tokens

## Database Schema

### TenantQuota

```prisma
model TenantQuota {
  id                    String   @id @default(uuid())
  tenantId              String   @unique
  maxConcurrentCalls    Int?
  maxMinutesPerDay      Int?
  maxRecordingRetentionDays Int?
  maxPhoneNumbers       Int?
  maxStorageGB          Decimal?
  enabled               Boolean  @default(true)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}
```

### TenantBudget

```prisma
model TenantBudget {
  id                    String   @id @default(uuid())
  tenantId              String   @unique
  monthlyBudget         Decimal?
  dailyBudget           Decimal?
  alertThreshold        Decimal  @default(80)
  alertEmails           String[]
  alertSlackWebhook     String?
  hardStopEnabled       Boolean  @default(true)
  overrideToken         String?  @unique
  overrideTokenExpiresAt DateTime?
  currentMonthSpend     Decimal  @default(0)
  currentDaySpend        Decimal  @default(0)
  lastAlertSentAt       DateTime?
  lastAlertType         BudgetAlertType?
  enabled               Boolean  @default(true)
}
```

### BudgetAlert

```prisma
model BudgetAlert {
  id          String   @id @default(uuid())
  tenantId    String
  budgetId    String
  type        BudgetAlertType
  threshold   Decimal
  actual      Decimal
  sentVia     String[]
  sentAt      DateTime @default(now())
  metadata    Json?
}
```

### QuotaOverride

```prisma
model QuotaOverride {
  id          String   @id @default(uuid())
  tenantId    String
  quotaType   String
  overrideValue Int?
  reason      String
  expiresAt   DateTime?
  createdBy   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

## Implementation Details

### Quota Service

Located at `apps/api/src/services/quota-service.ts`:

- `checkConcurrentCalls()`: Validates concurrent call limit
- `checkDailyMinutes()`: Validates daily minute limit
- `checkPhoneNumberQuota()`: Validates phone number limit
- `checkBudget()`: Validates budget limits
- `recordCallCost()`: Records call cost and updates budget
- `checkAndSendAlerts()`: Checks thresholds and sends alerts

### Budget Alert Service

Located at `apps/api/src/services/budget-alert-service.ts`:

- `sendAlert()`: Sends alerts via email and Slack
- `sendEmailAlert()`: Sends email alerts (integrate with email service)
- `sendSlackAlert()`: Sends Slack webhook alerts

### Audit Trail

All quota and budget operations are audited:

- Quota changes
- Budget changes
- Override token generation/revocation
- Quota overrides
- Quota/budget violations

## Best Practices

1. **Set Realistic Limits**: Start with conservative limits and adjust based on usage
2. **Monitor Alerts**: Set up email/Slack alerts to catch issues early
3. **Use Override Tokens Sparingly**: Only for emergency situations
4. **Regular Audits**: Review quota usage regularly to optimize limits
5. **Test Overages**: Use the test script to verify alerts and blocks work

## Future Enhancements

- [ ] Email service integration (SendGrid, SES)
- [ ] SMS alerts
- [ ] Webhook alerts for custom integrations
- [ ] Automatic quota adjustments based on usage patterns
- [ ] Quota recommendations based on historical data
- [ ] Multi-tier quota plans (free, pro, enterprise)
