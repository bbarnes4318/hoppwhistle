# Demo Mode & Sample Data

## Overview

Demo mode allows you to showcase Hopwhistle with realistic synthetic data without requiring real calls or infrastructure. Perfect for sales demos, marketing materials, and presentations.

## Features

- **7 Days of Synthetic Data**: Realistic call history spanning the past week
- **Complete Data Set**: Calls, buyers, publishers, campaigns, invoices, and transcripts
- **UI Toggle**: Easy switch between live and demo data
- **Screenshot Export**: Export dashboards and charts as PNG images for marketing

## Generating Demo Data

### Prerequisites

- Database migrations applied
- Database connection configured

### Generate Demo Data

```bash
# From the project root
pnpm --filter @hopwhistle/api db:seed:demo
```

This will:

1. Create a demo tenant (slug: `demo`)
2. Generate 10 phone numbers
3. Create 5 publishers
4. Create 5 buyers (with endpoints)
5. Create 6 campaigns
6. Generate 7 days of calls (50-200 calls per day)
7. Create recordings for 70% of completed calls
8. Create transcriptions for 50% of calls with recordings
9. Generate 4 invoices spanning the last 30 days

### Demo Data Summary

After generation, you'll see:

- **Phone Numbers**: 10 active numbers
- **Publishers**: 5 publishers with various sources
- **Buyers**: 5 buyers across different verticals
- **Campaigns**: 6 active campaigns
- **Calls**: ~700-1400 calls over 7 days
- **Invoices**: 4 invoices (2 paid, 1 pending, 1 draft)

## Using Demo Mode

### Enable Demo Mode in UI

1. Navigate to the Dashboard
2. Click the "Demo Mode" toggle in the top right
3. The page will reload showing demo data
4. All dashboards, charts, and reports will display demo data

### Disable Demo Mode

1. Click the "Demo Mode" toggle again
2. The page will reload showing your live data

### Demo Mode Indicator

When demo mode is active, you'll see an alert banner indicating you're viewing synthetic data.

## Screenshot Export

### Export Dashboard

1. Navigate to Dashboard
2. Click the "Export Screenshot" button
3. Choose export type:
   - **Export Dashboard**: Full dashboard view
   - **Export Chart**: Individual chart (if available)
   - **Export Element**: Custom element selection

### Export Options

- **Format**: PNG (high quality)
- **Scale**: 2x for crisp images
- **Background**: White background
- **Filename**: Auto-generated with timestamp

### Use Cases

- Marketing website screenshots
- Sales presentations
- Documentation images
- Social media posts
- Blog posts and articles

## API Endpoints

### Demo Status

```bash
GET /api/v1/demo/status
```

Returns:

```json
{
  "enabled": true,
  "tenantId": "demo-tenant-id"
}
```

### Toggle Demo Mode

```bash
POST /api/v1/demo/toggle
Content-Type: application/json

{
  "enabled": true
}
```

### Demo Statistics

```bash
GET /api/v1/demo/stats
```

Returns:

```json
{
  "calls": {
    "total": 1234,
    "completed": 1056,
    "completionRate": 85.6
  },
  "publishers": 5,
  "buyers": 5,
  "campaigns": 6,
  "invoices": 4,
  "revenue": 1234.56
}
```

## Data Characteristics

### Calls

- **Distribution**: Realistic call volume throughout the day (8 AM - 8 PM)
- **Duration**: 30 seconds to 10 minutes
- **Status**: 85% completed, 10% failed, 5% no answer
- **Direction**: 70% inbound, 30% outbound
- **Cost**: $0.01-$0.05 per minute

### Publishers

- **Sources**: Google, Facebook, Twitter, Direct
- **Quality**: Mix of high, medium, and low quality
- **Contact Info**: Realistic email and phone numbers

### Buyers

- **Verticals**: Insurance, Mortgage, Solar, Debt, Education
- **Endpoints**: Mix of SIP and PSTN
- **Capacity**: 10-50 concurrent calls

### Campaigns

- **Names**: Realistic campaign names (Summer Sale, Holiday Campaign, etc.)
- **Status**: All active
- **Publishers**: Assigned to various publishers

### Invoices

- **Periods**: Weekly invoices over 30 days
- **Status**: Mix of paid, pending, and draft
- **Line Items**: Call minutes, phone numbers, transcriptions
- **Totals**: Calculated from actual call costs

### Transcripts

- **Coverage**: 50% of calls with recordings
- **Language**: English (en-US)
- **Confidence**: 85-99%
- **Provider**: Deepgram (simulated)
- **Text**: Realistic conversation snippets

## Regenerating Demo Data

To regenerate demo data:

```bash
# This will clean up existing demo data and regenerate
pnpm --filter @hopwhistle/api db:seed:demo
```

**Note**: This will delete all existing demo data and create fresh data.

## Customization

### Adjusting Call Volume

Edit `apps/api/prisma/demo-seed.ts`:

```typescript
const callsPerDay = randomInt(50, 200); // Change range here
```

### Adjusting Date Range

```typescript
const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
// Change to 30 days: - 30 * 24 * 60 * 60 * 1000
```

### Adding More Entities

Simply add more iterations in the seed script:

```typescript
for (let i = 0; i < 10; i++) {
  // Increase from 5 to 10
  // Create publisher
}
```

## Best Practices

1. **Regenerate Regularly**: Refresh demo data weekly for fresh presentations
2. **Customize for Audience**: Adjust data to match your target vertical
3. **Export Screenshots**: Create a library of dashboard screenshots
4. **Document Scenarios**: Note specific demo scenarios for different use cases
5. **Test Before Demo**: Always verify demo mode works before presentations

## Troubleshooting

### Demo Data Not Showing

1. Verify demo tenant exists: `SELECT * FROM tenants WHERE slug = 'demo'`
2. Check demo mode is enabled in localStorage
3. Verify API is receiving `X-Demo-Tenant-Id` header

### Screenshot Export Fails

1. Ensure `html2canvas` is installed: `pnpm install`
2. Check browser console for errors
3. Try exporting a smaller element first

### Performance Issues

1. Demo data can be large (1000+ calls)
2. Consider pagination for large datasets
3. Use database indexes for faster queries

## Examples

### Sales Demo Flow

1. Enable demo mode
2. Navigate to Dashboard
3. Show call volume charts
4. Show campaign performance
5. Show buyer/publisher stats
6. Export screenshot for follow-up

### Marketing Materials

1. Enable demo mode
2. Customize dashboard filters
3. Export multiple screenshots
4. Use in website, presentations, docs

## References

- Demo Seed Script: `apps/api/prisma/demo-seed.ts`
- Demo Routes: `apps/api/src/routes/demo.ts`
- Demo Toggle Component: `apps/web/src/components/demo/demo-toggle.tsx`
- Screenshot Utilities: `apps/web/src/lib/screenshot.ts`
