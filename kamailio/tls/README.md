# TLS Certificates

Place your TLS certificate and private key files here:

- `server.crt` - TLS certificate (PEM format)
- `server.key` - TLS private key (PEM format)

## Generating Self-Signed Certificates (for testing)

```bash
openssl req -x509 -newkey rsa:4096 -keyout server.key -out server.crt -days 365 -nodes \
  -subj "/CN=sbc.yourdomain.com"
```

## Production Certificates

For production, use certificates from:

- Let's Encrypt (via certbot)
- Your CA
- SignalWire's recommended CA

Ensure the certificate CN or SAN matches your SBC_DOMAIN.
