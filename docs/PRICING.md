# Pricing Configuration Guide

## Overview

Hopwhistle uses a **fully configurable pricing system** with no hardcoded rates. All pricing is set per tenant via **Rate Cards**, which can be configured through the Admin API or UI.

## Rate Card Structure

Rate cards define pricing for:

- **Inbound calls** (per-minute and connection fees)
- **Outbound calls** (per-minute and connection fees)
- **Recording fees** (per-minute or per-call)
- **CPA (Cost Per Acquisition)** (flat amount triggered by events)

### Example Rate Card

```json
{
  "inbound": {
    "perMinute": 0.05,
    "connectionFee": 0.1
  },
  "outbound": {
    "perMinute": 0.1,
    "connectionFee": 0.15
  },
  "recording": {
    "perCall": 0.25
  },
  "cpa": {
    "amount": 25.0,
    "triggerEvent": "conversion.confirmed"
  }
}
```

## Configuration Methods

### 1. Admin API

**Create Rate Card:**

```http
POST /api/v1/admin/billing/rate-cards
Content-Type: application/json
Authorization: Bearer <admin-token>

{
  "billingAccountId": "xxx",
  "name": "Standard Rates Q1 2024",
  "rates": {
    "inbound": { "perMinute": 0.05, "connectionFee": 0.10 },
    "outbound": { "perMinute": 0.10, "connectionFee": 0.15 },
    "recording": { "perCall": 0.25 },
    "cpa": { "amount": 25.00 }
  },
  "effectiveFrom": "2024-01-01T00:00:00Z",
  "effectiveTo": "2024-03-31T23:59:59Z"
}
```

**List Rate Cards:**

```http
GET /api/v1/admin/billing/rate-cards?billingAccountId=xxx
```

**Update Rate Card:**

```http
PATCH /api/v1/admin/billing/rate-cards/:rateCardId
```

### 2. Admin UI

Navigate to **Settings > Billing > Rate Cards** to:

- View active rate cards
- Create new rate cards
- Update existing rate cards
- Set effective dates

### 3. Database (Direct)

Rate cards are stored in the `rate_cards` table:

```sql
INSERT INTO rate_cards (
  id, billing_account_id, name, rates, effective_from, status
) VALUES (
  'rc_xxx',
  'ba_xxx',
  'Standard Rates',
  '{"inbound": {"perMinute": 0.05, "connectionFee": 0.10}}'::jsonb,
  NOW(),
  'ACTIVE'
);
```

## Pricing Calculation

### Call Charges

1. **Connection Fee** (one-time, if call answered)
2. **Per-Minute Charges** (rounded UP to nearest minute)
   - Example: 61 seconds = 2 minutes

### Recording Fees

- **Per-Call:** Fixed fee per recording
- **Per-Minute:** Fee based on recording duration

### CPA Charges

- Triggered by specific events (e.g., `conversion.confirmed`)
- Flat amount charged once per conversion

## Rate Card Priority

When multiple rate cards exist for a billing account:

1. Active rate cards only (`status = 'ACTIVE'`)
2. Effective date range (`effective_from <= NOW() AND (effective_to IS NULL OR effective_to >= NOW())`)
3. Most recent effective date wins

## Default Rates

**Important:** There are **no default rates**. Each tenant must have a rate card configured before billing can occur.

### Setting Up Default Rates

1. **Create Billing Account:**

   ```http
   POST /api/v1/admin/billing/accounts
   {
     "tenantId": "xxx",
     "name": "Default Billing Account",
     "currency": "USD"
   }
   ```

2. **Create Rate Card:**
   ```http
   POST /api/v1/admin/billing/rate-cards
   {
     "billingAccountId": "xxx",
     "name": "Default Rates",
     "rates": {
       "inbound": { "perMinute": 0.05, "connectionFee": 0.10 },
       "outbound": { "perMinute": 0.10, "connectionFee": 0.15 },
       "recording": { "perCall": 0.25 }
     },
     "effectiveFrom": "2024-01-01T00:00:00Z"
   }
   ```

## Rate Card Templates

While not yet implemented, future versions may include:

- Pre-configured rate card templates
- Industry-standard rate structures
- Bulk rate card import/export

## Pricing Toggles

All pricing features are **stubbed and ready** for configuration:

- ✅ Rate card creation/update API endpoints
- ✅ Rate card UI in Admin settings
- ✅ Billing calculation logic
- ✅ Invoice generation
- ✅ Accrual ledger tracking

**Note:** Rates are set per tenant via rate cards. No hardcoded pricing exists in the codebase.

## Testing Pricing

### Using Demo Seed

The demo seed script (`pnpm db:seed:demo`) creates sample rate cards:

```typescript
// Example from demo-seed.ts
const rateCard = {
  inbound: { perMinute: 0.03, connectionFee: 0.1 },
  outbound: { perMinute: 0.05, connectionFee: 0.15 },
  recording: { perCall: 0.25 },
  cpa: { amount: 25.0 },
};
```

### Manual Testing

1. Create a test billing account
2. Create a rate card with test rates
3. Generate test calls
4. Verify accruals are created correctly
5. Generate invoice and verify line items

## Best Practices

1. **Version Control:** Use descriptive names with dates (e.g., "Standard Rates Q1 2024")
2. **Effective Dates:** Always set `effectiveFrom` and `effectiveTo` for clarity
3. **Testing:** Test rate cards in a staging environment before production
4. **Documentation:** Document rate changes in tenant notes/metadata
5. **Audit:** Review rate cards periodically for accuracy

## Troubleshooting

### No Billing Occurring

- Check that billing account exists and is ACTIVE
- Check that rate card exists and is ACTIVE
- Check that rate card effective dates include current date
- Check worker logs for billing errors

### Incorrect Charges

- Verify rate card `rates` JSON structure
- Check that correct rate card is being used (most recent effective date)
- Review accrual ledger entries for calculation details

### Rate Card Not Found

- Ensure rate card `status = 'ACTIVE'`
- Ensure `effective_from <= NOW()`
- Ensure `effective_to IS NULL OR effective_to >= NOW()`

---

**Last Updated:** [Date]  
**Version:** 0.1.0
