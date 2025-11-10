# DigitalOcean Environment Variables Setup Guide

## Required Environment Variables

### API Service

#### Required (Must Set):
- `JWT_SECRET` - Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- `S3_ENDPOINT` - Your S3/DigitalOcean Spaces endpoint
- `S3_BUCKET` - Your bucket name
- `S3_ACCESS_KEY` - Your S3 access key
- `S3_SECRET_KEY` - Your S3 secret key

#### SignalWire (Required for telephony):
- `SIGNALWIRE_PROJECT_ID` - Your SignalWire project ID (UUID)
- `SIGNALWIRE_API_TOKEN` - Your SignalWire API token (starts with PT)
- `SIGNALWIRE_SPACE_URL` - Your SignalWire space domain (e.g., `yourspace.signalwire.com`)

#### Telephony Services (If using external FreeSWITCH/RTPEngine):
- `RTPENGINE_URL` - Your RTPEngine URL (e.g., `http://rtpengine.example.com:22222`)
- `FREESWITCH_ESL_HOST` - Your FreeSWITCH host
- `FREESWITCH_ESL_PORT` - FreeSWITCH ESL port (default: `8021`)
- `FREESWITCH_ESL_PASSWORD` - FreeSWITCH ESL password

#### Optional:
- `CLICKHOUSE_URL` - ClickHouse analytics database URL
- `CLICKHOUSE_USER` - ClickHouse user (default: `default`)
- `CLICKHOUSE_PASSWORD` - ClickHouse password
- `CLICKHOUSE_DATABASE` - ClickHouse database name (default: `hopwhistle_analytics`)
- `TWILIO_API_KEY` - Twilio API key (if using Twilio)
- `TWILIO_API_SECRET` - Twilio API secret
- `TRUSTEDFORM_API_KEY` - TrustedForm API key (for consent verification)
- `JORNAYA_API_KEY` - Jornaya API key (for consent verification)
- `STRIPE_SECRET_KEY` - Stripe secret key (if using payments)
- `SMTP_HOST` - SMTP server host
- `SMTP_PORT` - SMTP port (default: `587`)
- `SMTP_USER` - SMTP username
- `SMTP_PASSWORD` - SMTP password
- `SMTP_FROM` - Email from address (default: `noreply@hopwhistle.com`)

### Web Service

#### Required:
- `NEXT_PUBLIC_API_URL` - Your API URL (e.g., `https://api-xxxxx.ondigitalocean.app`)
- `NEXT_PUBLIC_WS_URL` - Your WebSocket URL (e.g., `wss://api-xxxxx.ondigitalocean.app`)

#### Optional:
- `NEXT_PUBLIC_API_KEY` - API key for client-side requests
- `NEXT_PUBLIC_APP_NAME` - App name (default: `Hopwhistle`)

### Worker Service

#### Optional:
- `CLICKHOUSE_URL` - ClickHouse analytics database URL
- `CLICKHOUSE_USER` - ClickHouse user
- `CLICKHOUSE_PASSWORD` - ClickHouse password
- `CLICKHOUSE_DATABASE` - ClickHouse database name
- `STRIPE_SECRET_KEY` - Stripe secret key (if processing payments)

## How to Set in DigitalOcean

1. Go to your App in DigitalOcean dashboard
2. Click on each service (API, Web, Worker)
3. Go to **Settings** → **Environment Variables**
4. Click **Edit** or **Add Variable**
5. Add each variable with its value
6. Mark sensitive values as **Encrypted** (they'll be stored as secrets)

## SignalWire Setup

1. Go to SignalWire Dashboard: https://yourspace.signalwire.com
2. Navigate to **Settings** → **API**
3. Copy:
   - **Project ID** → `SIGNALWIRE_PROJECT_ID`
   - **API Token** (starts with PT) → `SIGNALWIRE_API_TOKEN`
   - **Space URL** → `SIGNALWIRE_SPACE_URL`

## S3/DigitalOcean Spaces Setup

### Option 1: DigitalOcean Spaces (Recommended)
1. Create a Space in DigitalOcean
2. Get endpoint: `https://your-region.digitaloceanspaces.com`
3. Create access keys in Spaces settings
4. Use:
   - `S3_ENDPOINT` = Your Spaces endpoint
   - `S3_BUCKET` = Your Space name
   - `S3_ACCESS_KEY` = Spaces access key
   - `S3_SECRET_KEY` = Spaces secret key
   - `S3_REGION` = Your region (e.g., `nyc3`)
   - `S3_FORCE_PATH_STYLE` = `false`

### Option 2: AWS S3
- Use your AWS S3 credentials
- `S3_ENDPOINT` = Leave empty or use AWS endpoint
- `S3_REGION` = Your AWS region (e.g., `us-east-1`)

## Quick Setup Checklist

- [ ] `JWT_SECRET` generated and set
- [ ] `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` set
- [ ] `SIGNALWIRE_PROJECT_ID`, `SIGNALWIRE_API_TOKEN`, `SIGNALWIRE_SPACE_URL` set
- [ ] `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` set (after first deploy)
- [ ] Optional services configured (ClickHouse, Stripe, SMTP, etc.)

