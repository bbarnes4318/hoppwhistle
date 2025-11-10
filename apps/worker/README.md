# Billing Worker

Event-driven billing pipeline that processes call events and generates invoices.

## Features

- **Rate Card Interpreter**: Flexible rating for per-minute, per-call, connection fees, recording fees, and CPA
- **Accrual Ledger**: Daily accrual tracking per tenant/publisher/buyer
- **Invoice Generator**: PDF invoice generation with Puppeteer
- **Stripe Integration**: Invoice creation and Connect payouts (behind feature flag)

## Architecture

### Rate Card Structure

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
    "perCall": 0.25,
    "perMinute": 0.02
  },
  "cpa": {
    "amount": 25.0,
    "triggerEvent": "conversion.confirmed"
  }
}
```

### Event Processing

The worker consumes:

- `call.completed` - Creates accruals for call minutes, connection fees, recording fees
- `conversion.confirmed` - Creates CPA accruals

### Accrual Ledger

Accruals are created per call/event and grouped by:

- `periodDate` (daily)
- `billingAccountId`
- `publisherId` (optional)
- `buyerId` (optional)

Accruals remain `closed = false` until period is closed and invoice is generated.

## Usage

### Start Worker

```bash
cd apps/worker
npm run dev
```

### Simulate Calls

```bash
npm run simulate:calls -- --tenant-id=xxx --billing-account-id=xxx --count=100
```

### Close Period and Generate Invoice

```bash
curl -X POST http://localhost:3001/api/v1/admin/billing/close-period \
  -H "Content-Type: application/json" \
  -d '{
    "billingAccountId": "xxx",
    "periodDate": "2024-01-15",
    "dueDate": "2024-01-30"
  }'
```

### Generate PDF

```bash
curl http://localhost:3001/api/v1/admin/billing/invoices/:invoiceId/pdf \
  --output invoice.pdf
```

## API Endpoints

### Admin - Rate Cards

**Create Rate Card:**

```http
POST /api/v1/admin/billing/rate-cards
Content-Type: application/json

{
  "billingAccountId": "xxx",
  "name": "Standard Rates",
  "rates": {
    "inbound": { "perMinute": 0.05, "connectionFee": 0.10 },
    "outbound": { "perMinute": 0.10, "connectionFee": 0.15 },
    "recording": { "perCall": 0.25 },
    "cpa": { "amount": 25.00 }
  },
  "effectiveFrom": "2024-01-01T00:00:00Z"
}
```

**List Rate Cards:**

```http
GET /api/v1/admin/billing/rate-cards?billingAccountId=xxx
```

### Admin - Period Management

**Close Period:**

```http
POST /api/v1/admin/billing/close-period
Content-Type: application/json

{
  "billingAccountId": "xxx",
  "periodDate": "2024-01-15",
  "dueDate": "2024-01-30",
  "publisherId": "xxx", // optional
  "buyerId": "xxx"      // optional
}
```

**Get Period Summary:**

```http
GET /api/v1/admin/billing/period-summary?billingAccountId=xxx&periodDate=2024-01-15
```

**Generate Invoice PDF:**

```http
GET /api/v1/admin/billing/invoices/:invoiceId/pdf
```

**Create Stripe Payout:**

```http
POST /api/v1/admin/billing/payouts
Content-Type: application/json

{
  "billingAccountId": "xxx",
  "amount": 1000.00,
  "currency": "USD"
}
```

## Configuration

### Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...

# Redis
REDIS_URL=redis://...

# Stripe (optional)
STRIPE_ENABLED=true
STRIPE_SECRET_KEY=sk_test_...
```

## Rate Calculation Examples

### Inbound Call (2 minutes 5 seconds, answered)

- Duration: 125 seconds → 3 minutes (rounded up)
- Connection fee: $0.10
- Per-minute: 3 × $0.05 = $0.15
- **Total: $0.25**

### Outbound Call (1 minute, answered, with recording)

- Duration: 60 seconds → 1 minute
- Connection fee: $0.15
- Per-minute: 1 × $0.10 = $0.10
- Recording fee: $0.25 (per call)
- **Total: $0.50**

### CPA Conversion

- CPA amount: $25.00
- Triggered by `conversion.confirmed` event
- **Total: $25.00**

## Rounding Rules

- **Minutes**: Always rounded UP (1 second = 1 minute, 61 seconds = 2 minutes)
- **Amounts**: Stored with 4 decimal places, displayed with 2 decimal places
- **Rounding method**: Half-up (0.125 → 0.13, 0.124 → 0.12)

## Testing

### Unit Tests

```bash
npm test
```

Tests cover:

- Rate calculation edge cases
- Rounding precision
- Zero-duration calls
- Unanswered calls
- Recording fee calculations

### Integration Test

```bash
npm run simulate:calls -- --count=100
```

Then verify:

1. Accruals created in `accrual_ledger` table
2. Period summary shows correct totals
3. Invoice generation works
4. PDF is generated correctly

## Database Schema

### AccrualLedger

- Tracks all charges before invoicing
- Links to calls, invoices, publishers, buyers
- Supports daily period closes
- Indexed for fast queries

### Invoice

- Generated from closed accruals
- Contains line items
- Supports PDF generation
- Links to Stripe (optional)

## Stripe Integration

When `STRIPE_ENABLED=true`:

1. **Invoice Creation**: Automatically creates Stripe invoice when period is closed
2. **Connect Payouts**: Supports Stripe Connect for publisher/buyer payouts
3. **Customer Management**: Links billing accounts to Stripe customers
4. **Metadata**: Stores Stripe IDs in invoice metadata

## Success Criteria

✅ Can simulate 100 calls and produce invoices:

1. Run `npm run simulate:calls -- --count=100`
2. Wait for worker to process events
3. Close period via API
4. Generate invoice PDF
5. Verify totals match expected amounts
