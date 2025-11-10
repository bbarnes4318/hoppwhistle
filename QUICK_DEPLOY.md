# 🚀 Quick Deploy to DigitalOcean - 5 Minutes

## Step 1: Push to GitHub

```bash
cd C:\Users\jimbo\Downloads\hopwhistle
git init
git add .
git commit -m "Initial commit - DigitalOcean ready"
git branch -M main
git remote add origin https://github.com/bbarnes4318/hopwhistle.git
git push -u origin main
```

## Step 2: Create DigitalOcean App

1. Go to: https://cloud.digitalocean.com/apps
2. Click **"Create App"**
3. Select **"GitHub"** as source
4. Authorize DigitalOcean (if needed)
5. Select repository: **bbarnes4318/hopwhistle**
6. Select branch: **main**
7. Click **"Next"**

## Step 3: Review Configuration

DigitalOcean will automatically detect `.do/app.yaml`. You'll see:

- ✅ **API Service** (Port 3001)
- ✅ **Web Service** (Port 3000)
- ✅ **Worker Service** (Port 9091)
- ✅ **PostgreSQL Database** (Auto-provisioned)
- ✅ **Redis Database** (Auto-provisioned)

## Step 4: Set Environment Variables

In the DigitalOcean dashboard, add these secrets:

### API Service:

- `JWT_SECRET` = (generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)
- `S3_ENDPOINT` = Your S3 endpoint (or DigitalOcean Spaces endpoint)
- `S3_BUCKET` = Your bucket name
- `S3_ACCESS_KEY` = Your access key
- `S3_SECRET_KEY` = Your secret key

### Web Service:

- `NEXT_PUBLIC_API_URL` = `https://api-xxxxx.ondigitalocean.app` (you'll get this after deploy)
- `NEXT_PUBLIC_WS_URL` = `wss://api-xxxxx.ondigitalocean.app` (same as above)

**Note:** You can update the Web env vars after first deployment once you have the API URL.

## Step 5: Deploy!

Click **"Create Resources"** and wait ~5-10 minutes.

DigitalOcean will:

1. ✅ Provision PostgreSQL database
2. ✅ Provision Redis database
3. ✅ Build all services
4. ✅ Deploy everything

## Step 6: Run Migrations

After deployment completes:

1. Go to your API service in DigitalOcean dashboard
2. Click **"Console"** tab
3. Run:
   ```bash
   pnpm --filter @hopwhistle/api db:migrate:deploy
   ```

## Step 7: Update Web Environment Variables

Once you have your API URL:

1. Go to Web service → Settings → Environment Variables
2. Update:
   - `NEXT_PUBLIC_API_URL` = Your actual API URL
   - `NEXT_PUBLIC_WS_URL` = Your WebSocket URL (same domain)
3. Save and redeploy

## ✅ Done!

Your app is now live at:

- **Web**: `https://web-xxxxx.ondigitalocean.app`
- **API**: `https://api-xxxxx.ondigitalocean.app`

## 🔄 Future Updates

Just push to GitHub:

```bash
git add .
git commit -m "Your changes"
git push origin main
```

DigitalOcean will automatically rebuild and deploy!

## 💰 Estimated Cost

- API: ~$5/month
- Web: ~$5/month
- Worker: ~$5/month
- PostgreSQL: ~$15/month
- Redis: ~$15/month

**Total: ~$45/month**

## 🆘 Need Help?

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed troubleshooting.
