# Phone Number Provisioning Service

Unified provisioning abstraction for managing phone numbers across multiple providers.

## Architecture

The provisioning system uses an **adapter pattern** to abstract provider-specific implementations:

```
ProvisioningService
  ├── LocalAdapter       (development/testing — no external calls)
  ├── FractelAdapter
  ├── AnveoAdapter
  ├── BulkvsAdapter
  ├── SignalWireAdapter
  ├── TelnyxAdapter
  ├── TwilioAdapter
  ├── VonageAdapter
  └── BandwidthAdapter
```

An adapter is registered only when `isConfigured()` is true, so an unconfigured
provider is absent rather than present-and-broken. `getAvailableProviders()`
reports what is actually usable in a given deployment.

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

### Telnyx Adapter

Telnyx REST API v2. Requires `TELNYX_API_KEY` and `TELNYX_CONNECTION_ID`; purchases
are assigned to that connection so inbound calls reach our edge.

### Twilio Adapter

Twilio REST API (2010-04-01).

**Configuration:**

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxx
# Either the account token…
TWILIO_AUTH_TOKEN=your-auth-token
# …or an API key pair (preferred — revocable on its own).
# TWILIO_API_KEY_SID / TWILIO_API_KEY_SECRET, or the TWILIO_API_KEY /
# TWILIO_API_SECRET names the carrier and CNAM lookups already use.
TWILIO_API_KEY_SID=SKxxxxxxxx
TWILIO_API_KEY_SECRET=your-api-key-secret
# Where purchased numbers are routed — one of these is required to buy.
TWILIO_TRUNK_SID=TKxxxxxxxx   # Elastic SIP Trunk (pairs with the `twilio` gateway)
TWILIO_VOICE_URL=             # …or a TwiML webhook
```

**Endpoints used** (all under `/Accounts/{AccountSid}`):

- `GET /AvailablePhoneNumbers/{Country}/Local.json` — search inventory
- `POST /IncomingPhoneNumbers.json` — purchase, and set the routing target
- `GET /IncomingPhoneNumbers.json` — list owned numbers
- `GET|POST /IncomingPhoneNumbers/{Sid}.json` — read / re-point a number
- `DELETE /IncomingPhoneNumbers/{Sid}.json` — release

**Notes:**

- Requests are `application/x-www-form-urlencoded`; a JSON body is rejected with a
  400 that names no field.
- Buying without a routing target is refused rather than silently landing a
  number on Twilio's demo greeting.
- The owned-number area-code filter is a `+1NPA*******` pattern; `AreaCode` only
  exists on the availability search.

### Vonage Adapter

Vonage (formerly Nexmo) Numbers API.

**Configuration:**

```env
VONAGE_API_KEY=your-api-key
VONAGE_API_SECRET=your-api-secret
# Where purchased numbers are routed — one of these is required to buy.
VONAGE_APPLICATION_ID=       # Voice application id
VONAGE_SIP_URI=              # …or a SIP URI (pairs with the `vonage` gateway)
VONAGE_DEFAULT_COUNTRY=US    # fallback when a number's country can't be read back
```

**Endpoints used** (`https://rest.nexmo.com`):

- `GET /number/search` — search inventory
- `POST /number/buy` — purchase
- `POST /number/update` — link the number to the application or SIP URI
- `GET /account/numbers` — list owned numbers / look one up
- `POST /number/cancel` — release

**Notes:**

- Numbers are MSISDNs (bare digits). The adapter converts to and from E.164 at
  the boundary; a `+` sent to Vonage matches nothing.
- There is no opaque number id — the MSISDN is the `providerId`.
- Cancelling needs the number's country, which the id cannot carry, so it is read
  back from the account before the cancel call.
- Several endpoints answer HTTP 200 with an `error-code` in the body, so the
  status line alone is not evidence of success.
- Purchase is two calls (buy, then route). If routing fails the error names the
  number, because it is already on the account and billing.

### Bandwidth Adapter

Bandwidth Dashboard API. Requires `BANDWIDTH_ACCOUNT_ID`, `BANDWIDTH_USERNAME`,
`BANDWIDTH_PASSWORD` and `BANDWIDTH_SITE_ID`.

## Provisioning is not routing

Buying a DID from a provider and _dialing out through_ that provider are separate
concerns with separate configuration:

|               | Provisioning (this service)          | Termination (carrier waterfall)                                 |
| ------------- | ------------------------------------ | --------------------------------------------------------------- |
| Configured by | provider API credentials             | a `Carrier` + `CarrierGateway` row and a FreeSWITCH `<gateway>` |
| Surface       | Numbers page                         | Settings → Carrier Routing                                      |
| Twilio        | `TWILIO_ACCOUNT_SID` + token/key     | `TWILIO_SIP_TERMINATION_DOMAIN`                                 |
| Vonage        | `VONAGE_API_KEY`/`VONAGE_API_SECRET` | `VONAGE_SIP_PROXY`                                              |

A provider can be usable for one and not the other. Numbers bought here carry
`phone_numbers.provider`, which is what a carrier's `numberProvider` matches to
find a caller ID it can attest to — so buying Twilio DIDs is what makes the
`TWILIO` carrier presentable on outbound legs.

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
