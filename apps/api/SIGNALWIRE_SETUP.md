# SignalWire Setup Guide

## Quick Setup

Add these environment variables to your `apps/api/.env` file:

```env
SIGNALWIRE_PROJECT_ID=76a632c4-83d0-4571-afb3-f6865d45d3fe
SIGNALWIRE_API_TOKEN=PTe320e4593c436917869d778613dc7fa4e010ad2f3be812b5
SIGNALWIRE_SPACE_URL=leadzer.signalwire.com
```

## Important Notes

**API Token vs Signing Key:**

- **API Token** (starts with `PT`): Used for REST API authentication - **USE THIS**
- **Signing Key** (starts with `PSK_`): Used only for webhook signature verification - **DO NOT USE THIS**

The provisioning service uses the API Token for all REST API calls to SignalWire.

## Testing the Configuration

Once configured, you can test the SignalWire adapter:

```bash
# List available numbers
pnpm exec numbers:audit --provider=signalwire

# Or use the provisioning service programmatically
```

## Security Notes

- Never commit your `.env` file to version control
- The API token (signing key) provides full access to your SignalWire account
- Rotate tokens regularly for security
- Use different tokens for development and production
