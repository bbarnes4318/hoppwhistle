# Phone Number Provisioning Service

Unified provisioning abstraction for managing phone numbers across multiple providers (SignalWire, Telnyx, Bandwidth, and local inventory).

## Architecture

The provisioning system uses an **adapter pattern** to abstract provider-specific implementations:

```
ProvisioningService
  ├── LocalAdapter (development/testing)
  ├── SignalWireAdapter (production)
  ├── TelnyxAdapter (placeholder)
  └── BandwidthAdapter (placeholder)
```

## Core Interface

All adapters implement the `ProvisioningAdapter` interface:

- `listNumbers(options?)` - List available or owned numbers
- `purchaseNumber(request)` - Purchase a number from provider
- `releaseNumber(providerId)` - Release a number back to provider
- `getNumber(providerId)` - Get details about a specific number
- `configureNumber(providerId, features)` - Configure number features
- `isConfigured()` - Check if adapter is properly configured

## Providers

### Local Adapter

For development and testing. Manages numbers from the local database without hitting external APIs.

**Features:**

- Generates mock phone numbers for testing
- Simulates purchase/release operations
- Always available (no configuration required)

### SignalWire Adapter

Production-ready integration with SignalWire REST API.

**Configuration:**

```env
SIGNALWIRE_PROJECT_ID=your-project-id
SIGNALWIRE_API_TOKEN=your-api-token
SIGNALWIRE_SPACE_URL=your-space.signalwire.com
```

**Where to find these values:**

- **Project ID**: SignalWire Dashboard → Settings → API → Project ID (UUID format)
- **API Token**: SignalWire Dashboard → Settings → API → API Token (starts with `PT`, NOT the signing key `PSK_`)
- **Space URL**: Your SignalWire space domain (e.g., `leadzer.signalwire.com`)

**Important:** Use the API Token (starts with `PT`) for REST API calls, NOT the signing key (starts with `PSK_`). The signing key is only used for webhook signature verification.

**API Endpoints Used:**

- `GET /api/relay/rest/phone_numbers` - List numbers
- `POST /api/relay/rest/phone_numbers` - Purchase number
- `DELETE /api/relay/rest/phone_numbers/{id}` - Release number
- `GET /api/relay/rest/phone_numbers/{id}` - Get number details
- `PATCH /api/relay/rest/phone_numbers/{id}` - Configure number

### Telnyx Adapter (Placeholder)

Placeholder for future Telnyx integration. Currently throws "not yet implemented" errors.

### Bandwidth Adapter (Placeholder)

Placeholder for future Bandwidth integration. Currently throws "not yet implemented" errors.

## Usage

### Programmatic Usage

```typescript
import { provisioningService } from './services/provisioning/provisioning-service.js';

// Purchase a number
const number = await provisioningService.purchaseNumber(
  'signalwire',
  {
    areaCode: '555',
    features: { voice: true, sms: true },
  },
  {
    tenantId: 't_123',
    userId: 'u_456',
    ipAddress: '127.0.0.1',
    requestId: 'req_789',
  }
);

// Assign to campaign
await provisioningService.assignNumberToCampaign(
  {
    tenantId: 't_123',
    campaignId: 'c_abc',
    number: '+15551234567',
  },
  { tenantId: 't_123', ipAddress: '127.0.0.1' }
);

// Audit inventory
const audit = await provisioningService.auditInventory('signalwire', 't_123');
console.log('Discrepancies:', audit.discrepancies);
```

### CLI Commands

#### Import Numbers from CSV

```bash
pnpm exec numbers:import --file=numbers.csv
```

**CSV Format:**

```csv
number,tenant_id,campaign_id,provider
+15551234567,t_123,c_abc,signalwire
+15559876543,t_123,c_def,local
```

**Options:**

- `--file=FILE` - CSV file path (required)
- `--skip-header` - Skip first line (CSV header)
- `--number-column=N` - Column index for phone number
- `--tenant-column=N` - Column index for tenant ID
- `--campaign-column=N` - Column index for campaign ID
- `--provider-column=N` - Column index for provider

#### Assign Number to Campaign

```bash
pnpm exec numbers:assign --tenant=t_123 --campaign=c_abc --number=+15551234567
```

**Options:**

- `--tenant=ID` - Tenant ID (required)
- `--campaign=ID` - Campaign ID (required)
- `--number=NUMBER` - Phone number in E.164 format (required)

#### Audit Inventory

```bash
pnpm exec numbers:audit --provider=signalwire --tenant=t_123
```

**Options:**

- `--provider=PROVIDER` - Provider to audit (required)
- `--tenant=ID` - Optional tenant ID filter

**Output:**

- Lists numbers missing in provider
- Lists numbers missing in local DB
- Shows status mismatches
- Exits with code 1 if discrepancies found

## Database Schema

The `phone_numbers` table includes provisioning fields:

```prisma
model PhoneNumber {
  id            String   @id @default(uuid())
  tenantId      String
  number        String   // E.164 format
  campaignId    String?  // Assigned campaign
  provider      String?  // local | signalwire | telnyx | bandwidth | clec
  status        PhoneNumberStatus @default(ACTIVE)
  capabilities  Json?    // SMS, MMS, Voice, etc.
  metadata      Json?
  purchasedAt   DateTime?
  releasedAt    DateTime?
  // ...
}
```

## Audit Trail

All provisioning operations are automatically logged to the audit trail:

- **Purchase**: Logs number purchase with provider details
- **Release**: Logs number release with before/after status
- **Assignment**: Logs campaign assignment changes

## Error Handling

The service handles common errors:

- **Rate Limiting**: SignalWire 429 errors with retry-after guidance
- **Authentication**: Clear error messages for credential issues
- **Not Found**: Graceful handling of missing numbers
- **Validation**: Tenant/campaign existence checks

## Future Enhancements

- [ ] Implement Telnyx adapter
- [ ] Implement Bandwidth adapter
- [ ] Add CLEC/SIP adapter for self-hosted trunks (Kamailio, FreeSWITCH)
- [ ] Support number porting operations
- [ ] Add bulk operations (purchase/release multiple numbers)
- [ ] Add webhook support for provider events
- [ ] Add number search/filtering by features/region
