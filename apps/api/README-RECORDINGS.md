# Recording Storage & Lifecycle Management

This document describes the recording storage and lifecycle management system.

## Features

- **S3-Compatible Storage**: Upload recordings to S3 (or MinIO for local development)
- **Signed URLs**: Generate time-bound signed URLs for secure playback
- **Lifecycle Management**: Automatic tiering (hot → warm → cold) and deletion
- **Metadata Tracking**: Size, format, checksum stored in database
- **CLI Tools**: Backfill missing metadata

## Architecture

### Storage Service (`src/services/storage.ts`)

Handles all S3 operations:

- Upload recordings with checksum calculation
- Generate signed URLs for playback
- Stream recordings
- Move between storage tiers
- Delete recordings

### Recording Service (`src/services/recording-service.ts`)

Business logic for recordings:

- Upload from FreeSWITCH callback
- Generate signed URLs
- Backfill metadata

### Lifecycle Service (`src/services/recording-lifecycle.ts`)

Manages recording lifecycle:

- Move from hot → warm → cold storage
- Schedule deletions based on tenant policy
- Process lifecycle updates in batches

## Configuration

### Environment Variables

```bash
# S3 Storage
S3_ENDPOINT=http://localhost:9000  # MinIO endpoint
S3_BUCKET=recordings
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true  # Required for MinIO

# Lifecycle Policies (days)
RECORDING_HOT_TO_WARM_DAYS=30
RECORDING_WARM_TO_COLD_DAYS=90
RECORDING_RETENTION_DAYS=365
RECORDING_LIFECYCLE_ENABLED=true
```

## API Endpoints

### Upload Recording

```http
POST /api/v1/recordings/upload
Content-Type: multipart/form-data

{
  "callId": "uuid",
  "legId": "uuid (optional)",
  "format": "wav (optional)",
  "file": <binary>
}
```

Or with URL:

```http
POST /api/v1/recordings/upload
Content-Type: application/json

{
  "callId": "uuid",
  "url": "http://example.com/recording.wav",
  "format": "wav",
  "duration": 120
}
```

### List Recordings

```http
GET /api/v1/recordings?page=1&limit=20&callId=xxx&status=COMPLETED
```

### Get Recording

```http
GET /api/v1/recordings/:recordingId
```

### Get Signed URL

```http
GET /api/v1/recordings/:recordingId/url?expiresIn=3600
```

Returns:

```json
{
  "url": "https://s3.../signed-url",
  "expiresIn": 3600,
  "expiresAt": "2024-01-01T12:00:00Z"
}
```

### Stream Recording

```http
GET /api/v1/recordings/:recordingId/stream
```

Redirects to signed URL (24-hour expiration).

### Backfill Metadata

```http
POST /api/v1/recordings/:recordingId/backfill
```

## CLI Tools

### Backfill All Recordings

```bash
npm run recordings:backfill
# or
npm run recordings:backfill -- --limit=50
```

### Backfill Specific Recording

```bash
npm run recordings:backfill:one=abc-123-def
```

## Database Schema

### Recording Model

```prisma
model Recording {
  id                  String   @id @default(uuid())
  callId              String
  legId               String?
  url                 String
  storageKey          String?  // S3 key
  duration            Int?     // Seconds
  format              String   @default("wav")
  size                BigInt?  // Bytes
  checksum            String?  // SHA256
  storageTier         RecordingStorageTier @default(HOT)
  status              RecordingStatus @default(PROCESSING)
  metadata            Json?
  lifecyclePolicyId   String?
  movedToWarmAt       DateTime?
  scheduledDeletionAt DateTime?
  deletedAt           DateTime?
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```

### Storage Tiers

- **HOT**: Frequently accessed, fast storage (default)
- **WARM**: Less frequently accessed, cheaper storage
- **COLD**: Rarely accessed, cheapest storage (archived)

## Lifecycle Policies

Lifecycle policies control when recordings move between tiers and when they're deleted:

1. **Hot → Warm**: After `RECORDING_HOT_TO_WARM_DAYS` (default: 30 days)
2. **Warm → Cold**: After `RECORDING_WARM_TO_COLD_DAYS` (default: 90 days)
3. **Deletion**: After `RECORDING_RETENTION_DAYS` (default: 365 days)

Policies are tenant-specific and can be configured per tenant.

## Local Development with MinIO

### Start MinIO

```bash
cd infra/docker
docker-compose up minio
```

MinIO console: http://localhost:9001

- Username: `minioadmin`
- Password: `minioadmin`

### Create Bucket

1. Open MinIO console
2. Create bucket named `recordings`
3. Set bucket policy to allow public read (optional)

### Test Upload

```bash
curl -X POST http://localhost:3001/api/v1/recordings/upload \
  -F "callId=test-call-id" \
  -F "file=@recording.wav"
```

### Test Playback

```bash
# Get signed URL
curl http://localhost:3001/api/v1/recordings/:id/url

# Stream (redirects to signed URL)
curl -L http://localhost:3001/api/v1/recordings/:id/stream
```

## FreeSWITCH Integration

FreeSWITCH uploads recordings via callback:

```bash
# In FreeSWITCH dialplan
<action application="record_session" data="/recordings/${callSid}.wav"/>

# Upload script calls:
curl -X POST http://api:3001/api/v1/recordings/upload \
  -H "Content-Type: application/json" \
  -d '{
    "callId": "${callSid}",
    "url": "http://freeswitch/recordings/${callSid}.wav",
    "format": "wav"
  }'
```

## Production Considerations

1. **S3 Configuration**: Use AWS S3 or compatible service
2. **Bucket Policies**: Configure appropriate access policies
3. **Lifecycle Policies**: Use S3 lifecycle policies for automatic tiering
4. **Monitoring**: Track upload failures, storage usage
5. **Backup**: Consider backup strategy for critical recordings
6. **Encryption**: Enable S3 server-side encryption
7. **CDN**: Use CloudFront for playback URLs

## Troubleshooting

### Upload Fails

- Check S3 credentials
- Verify bucket exists
- Check network connectivity
- Review logs for errors

### Signed URLs Don't Work

- Verify S3 credentials
- Check URL expiration
- Verify bucket policy allows GetObject

### Lifecycle Not Processing

- Check `RECORDING_LIFECYCLE_ENABLED` is true
- Verify cron job is running (if using scheduled tasks)
- Check recording age matches policy thresholds
