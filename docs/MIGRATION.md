# Legacy CPaaS Migration Guide

## Overview

This guide explains how to migrate legacy voice data from older CPaaS platforms (Ringba, CallRail, or internal exports) into the SignalWire-powered Hopwhistle platform.

## Prerequisites

- Database migrations applied
- SignalWire credentials configured (optional, for validation)
- CSV or JSON export files from legacy system

## Exporting Data from Legacy Systems

### Ringba

1. Navigate to **Numbers** → Export CSV
2. Include columns: `number`, `status`, `campaign_id`, `purchase_date`
3. Navigate to **Calls** → Export CSV
4. Include columns: `call_id`, `from`, `to`, `direction`, `status`, `duration`, `timestamp`, `cost`
5. Navigate to **Recordings** → Export CSV
6. Include columns: `call_id`, `recording_url`, `duration`, `created_at`

### CallRail

1. Navigate to **Numbers** → Export
2. Export as CSV with all fields
3. Navigate to **Call Logs** → Export
4. Export as CSV with all fields
5. Navigate to **Recordings** → Export
6. Export as CSV with recording URLs

### Custom/Internal Systems

Export data in CSV or JSON format with the following schemas:

#### Numbers CSV

```csv
number,status,tenant_id,campaign_id,purchase_date,release_date,tags
+15551234567,active,tenant-123,campaign-001,2024-01-01T00:00:00Z,,voice
```

#### Campaigns CSV

```csv
campaign_id,name,tenant_id,description
campaign-001,Summer Sale 2024,tenant-123,Promotional campaign
```

#### Calls CSV

```csv
call_id,from,to,direction,status,duration,timestamp,cost
call-001,+15551234567,+15559876543,inbound,completed,180,2024-01-15T10:30:00Z,0.05
```

#### Recordings CSV

```csv
call_id,recording_url,duration,created_at
call-001,https://recordings.example.com/call-001.wav,180,2024-01-15T10:30:00Z
```

## Data Normalization

### Phone Number Format

Phone numbers are automatically normalized to E.164 format:

- `(555) 123-4567` → `+15551234567`
- `5551234567` → `+15551234567`
- `+1 555 123 4567` → `+15551234567`

### Status Mapping

**Phone Numbers:**

- `active`, `assigned` → `ACTIVE`
- `inactive`, `released` → `INACTIVE`
- `porting` → `PORTING`
- `suspended` → `SUSPENDED`

**Calls:**

- `completed`, `answered` → `COMPLETED`
- `failed` → `FAILED`
- `busy` → `BUSY`
- `no_answer`, `no answer` → `NO_ANSWER`
- `cancelled`, `canceled` → `CANCELLED`

**Directions:**

- `inbound`, `in` → `INBOUND`
- `outbound`, `out` → `OUTBOUND`

## Running the Migration

### Step 1: Dry Run (Preview)

Always run a dry-run first to preview changes:

```bash
# Single file
pnpm --filter @hopwhistle/api migrate --input ./legacy-numbers.csv --dry-run

# Directory with multiple files
pnpm --filter @hopwhistle/api migrate --input ./exports/ --dry-run

# With tenant ID
pnpm --filter @hopwhistle/api migrate --input ./legacy.csv --dry-run --tenant-id <tenant-id>
```

**Dry-run output:**

```
✅ 212 numbers ready to import
⚠️ 5 duplicates skipped
✅ 420 recordings verified
❌ 3 unreachable recording URLs
```

### Step 2: Review Output

Check the dry-run summary for:

- ✅ Items ready to import
- ⚠️ Duplicates that will be skipped
- ❌ Errors that need fixing

### Step 3: Fix Issues

Common issues and fixes:

**Unreachable Recording URLs:**

- Verify URLs are publicly accessible
- Check if URLs require authentication
- Update URLs if they've moved

**Duplicate Numbers:**

- Review duplicates to ensure they're actually duplicates
- Update source data if needed

**Missing Tenant ID:**

- Add `tenant_id` column to CSV
- Or use `--tenant-id` flag

### Step 4: Commit Import

Once dry-run looks good, commit the import:

```bash
pnpm --filter @hopwhistle/api migrate --input ./exports/ --commit --tenant-id <tenant-id>
```

**Commit mode:**

- Actually imports data into database
- Updates existing records if duplicates found
- Marks all imported numbers with `provider = 'signalwire'`
- Sets `import_source = 'legacy'`

## SignalWire Validation

By default, the migration validates that imported numbers exist in your SignalWire account.

### Enable Validation (Default)

```bash
pnpm --filter @hopwhistle/api migrate --input ./numbers.csv --commit
```

### Disable Validation

```bash
pnpm --filter @hopwhistle/api migrate --input ./numbers.csv --commit --no-validate
```

**When to disable:**

- Numbers are being ported to SignalWire
- Numbers will be purchased after import
- Testing without SignalWire credentials

### Validation Process

1. For each number, queries SignalWire API: `GET /api/relay/rest/phone_numbers`
2. Checks if number exists in your SignalWire account
3. Skips numbers not found (with warning)
4. Continues with numbers that exist

## File Formats

### CSV Format

- Headers must match exactly (case-insensitive)
- UTF-8 encoding
- Comma-separated values
- Dates in ISO 8601 format

### JSON Format

```json
[
  {
    "number": "+15551234567",
    "status": "active",
    "tenant_id": "tenant-123",
    "campaign_id": "campaign-001"
  }
]
```

### Directory Input

When providing a directory, files are auto-detected by name:

- `numbers.csv` or `*number*.csv` → Numbers
- `campaigns.csv` or `*campaign*.csv` → Campaigns
- `calls.csv` or `*call*.csv` → Calls
- `recordings.csv` or `*recording*.csv` → Recordings

## Import Behavior

### Deduplication

The migration uses import hashes to prevent duplicates:

- **Phone Numbers**: Based on `number` + `tenant_id`
- **Calls**: Based on `call_id` (external ID)
- **Recordings**: Based on `call_id` + `url`

### Updates vs. Inserts

- **New records**: Inserted with `provider = 'signalwire'`
- **Existing records**: Updated with new data, preserves existing `provider`
- **Duplicates**: Skipped (with option to update)

### Metadata

All imported records include:

```json
{
  "importSource": "legacy",
  "importHash": "sha256-hash",
  "migratedAt": "2024-01-15T12:00:00Z"
}
```

## Verification

### Dashboard

1. Navigate to `/numbers`
2. Filter by `provider = signalwire`
3. Verify imported numbers appear

### API

```bash
# List imported numbers
GET /api/v1/numbers?provider=signalwire

# Get specific number
GET /api/v1/numbers/{id}
```

### SignalWire Console

1. Log into SignalWire dashboard
2. Navigate to **Phone Numbers**
3. Verify numbers appear in your account

## Example Files

Sample CSV files are available in `apps/api/src/cli/examples/`:

- `numbers.csv` - Example phone numbers export
- `campaigns.csv` - Example campaigns export
- `calls.csv` - Example call logs export
- `recordings.csv` - Example recordings export

## Troubleshooting

### "Tenant ID required"

**Solution**: Add `tenant_id` column to CSV or use `--tenant-id` flag

### "Number not found in SignalWire"

**Solution**:

- Verify number exists in SignalWire account
- Use `--no-validate` to skip validation
- Purchase number in SignalWire first

### "Recording URL unreachable"

**Solution**:

- Verify URL is publicly accessible
- Check URL hasn't expired
- Update URLs if they've moved

### "Duplicate detected"

**Solution**:

- Review if it's actually a duplicate
- Update existing record instead of creating new
- Remove duplicate from source file

### Import fails mid-way

**Solution**:

- Migration is idempotent - safe to re-run
- Duplicates will be skipped
- Only new records will be imported

## Best Practices

1. **Always dry-run first** - Preview changes before committing
2. **Backup database** - Before running commit mode
3. **Validate SignalWire** - Ensure numbers exist before import
4. **Test with small dataset** - Import 10-20 records first
5. **Review duplicates** - Understand what will be updated
6. **Verify recordings** - Ensure URLs are accessible
7. **Document source** - Note where data came from

## Post-Migration

### Verify Import

```bash
# Check imported numbers
psql -c "SELECT COUNT(*) FROM phone_numbers WHERE provider = 'signalwire' AND import_source = 'legacy';"

# Check imported calls
psql -c "SELECT COUNT(*) FROM calls WHERE import_hash IS NOT NULL;"

# Check imported recordings
psql -c "SELECT COUNT(*) FROM recordings WHERE import_hash IS NOT NULL;"
```

### Clean Up

After successful migration:

1. Archive original export files
2. Document migration date and source
3. Update any external references

## Advanced Usage

### Custom Tenant Mapping

If your CSV has different tenant IDs, create a mapping file:

```json
{
  "legacy-tenant-1": "new-tenant-uuid-1",
  "legacy-tenant-2": "new-tenant-uuid-2"
}
```

Then update CSV before import.

### Batch Processing

For large datasets, split into smaller files:

```bash
# Process in batches
for file in exports/batch-*.csv; do
  pnpm --filter @hopwhistle/api migrate --input "$file" --commit
done
```

### Incremental Import

Import new data incrementally:

```bash
# Only import records after a certain date
# Filter CSV first, then import
pnpm --filter @hopwhistle/api migrate --input ./new-records.csv --commit
```

## References

- [SignalWire REST API](https://developer.signalwire.com/apis/docs/overview)
- [E.164 Format](https://en.wikipedia.org/wiki/E.164)
- [CSV Parser Documentation](https://csv.js.org/parse/)
