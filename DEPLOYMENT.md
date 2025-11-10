# DigitalOcean App Platform Deployment Guide

This application is configured to deploy to DigitalOcean App Platform. No Docker required!

## Quick Setup

### 1. Push to GitHub

Make sure your code is pushed to: https://github.com/bbarnes4318/hopwhistle.git

```bash
git remote add origin https://github.com/bbarnes4318/hopwhistle.git
git push -u origin main
```

### 2. Connect to DigitalOcean

1. Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
2. Click "Create App"
3. Select "GitHub" as source
4. Authorize DigitalOcean to access your GitHub account
5. Select repository: `bbarnes4318/hopwhistle`
6. Select branch: `main`
7. Click "Next"

### 3. Configure App Spec

DigitalOcean will detect the `.do/app.yaml` file automatically. Review the configuration:

- **API Service**: Port 3001, runs `pnpm --filter @hopwhistle/api start`
- **Web Service**: Port 3000, runs `pnpm --filter @hopwhistle/web start`
- **Worker Service**: Port 9091, runs `pnpm --filter @hopwhistle/worker start`
- **PostgreSQL Database**: Version 16
- **Redis Database**: Version 7

### 4. Set Environment Variables

In the DigitalOcean dashboard, set these environment variables:

#### API Service:

- `JWT_SECRET` - Generate with: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- `S3_ENDPOINT` - Your S3 endpoint (or DigitalOcean Spaces)
- `S3_BUCKET` - Your S3 bucket name
- `S3_ACCESS_KEY` - Your S3 access key
- `S3_SECRET_KEY` - Your S3 secret key

#### Web Service:

- `NEXT_PUBLIC_API_URL` - Your API URL (e.g., `https://api-your-app.ondigitalocean.app`)
- `NEXT_PUBLIC_WS_URL` - Your WebSocket URL (e.g., `wss://api-your-app.ondigitalocean.app`)

### 5. Deploy

Click "Create Resources" and DigitalOcean will:

1. Provision databases (PostgreSQL + Redis)
2. Build all services
3. Run database migrations
4. Deploy all services

## Post-Deployment

### Run Database Migrations

After first deployment, run migrations:

```bash
# Connect to your API service via DigitalOcean console or SSH
pnpm --filter @hopwhistle/api db:migrate:deploy
```

### Seed Database (Optional)

```bash
pnpm --filter @hopwhistle/api db:seed
```

## Environment Variables Reference

### API Service Required:

- `DATABASE_URL` - Auto-provided by DigitalOcean
- `REDIS_URL` - Auto-provided by DigitalOcean
- `JWT_SECRET` - Set manually
- `S3_ENDPOINT` - Set manually
- `S3_BUCKET` - Set manually
- `S3_ACCESS_KEY` - Set manually
- `S3_SECRET_KEY` - Set manually

### Web Service Required:

- `NEXT_PUBLIC_API_URL` - Set manually (your API URL)
- `NEXT_PUBLIC_WS_URL` - Set manually (your WebSocket URL)

### Worker Service Required:

- `DATABASE_URL` - Auto-provided by DigitalOcean
- `REDIS_URL` - Auto-provided by DigitalOcean

## Updating the App

Just push to GitHub:

```bash
git add .
git commit -m "Your changes"
git push origin main
```

DigitalOcean will automatically rebuild and deploy!

## Monitoring

- View logs in DigitalOcean dashboard
- Check health endpoints:
  - API: `https://your-api-url/health`
  - Worker: `https://your-worker-url/health`

## Costs

Estimated monthly costs:

- API Service (Basic XXS): ~$5/month
- Web Service (Basic XXS): ~$5/month
- Worker Service (Basic XXS): ~$5/month
- PostgreSQL (Basic): ~$15/month
- Redis (Basic): ~$15/month

**Total: ~$45/month**

## Troubleshooting

### Build Fails

- Check build logs in DigitalOcean dashboard
- Ensure `pnpm-lock.yaml` is committed
- Verify Node.js version (requires >= 18.0.0)

### Database Connection Issues

- Verify `DATABASE_URL` is set correctly
- Check database is provisioned and running
- Run migrations: `pnpm --filter @hopwhistle/api db:migrate:deploy`

### Services Not Starting

- Check environment variables are set
- Review service logs in dashboard
- Verify health check endpoints are accessible
