# GitHub Actions Workflows

This directory contains CI/CD workflows for Hopwhistle.

## Workflows

### `pr.yml` - Pull Request Quality Gates

Runs on every pull request to `main` or `develop` branches.

**Jobs:**

1. **Quality Gates** - Runs all quality checks:
   - Install dependencies
   - Lint code
   - Format check
   - Type check
   - Unit tests
   - Build all packages
   - Upload build artifacts

2. **SIP Tests** - Runs SIP integration tests:
   - Starts docker-compose services
   - Runs SIPp test scenarios
   - Collects logs on failure

**Success Criteria:**

- All linting passes
- All type checks pass
- All unit tests pass
- All builds succeed
- SIP tests pass

### `release.yml` - Release and Publish

Runs on:

- Push of version tags (`v*.*.*`)
- Manual workflow dispatch

**Jobs:**

1. **Determine Version** - Extracts version from tag or input
2. **Build and Publish**:
   - Bumps version in package.json files
   - Builds all packages
   - Publishes SDK to npm (private)
   - Builds Docker images for API, Web, Worker
   - Pushes images to GitHub Container Registry (GHCR)
   - Creates GitHub Release

**Docker Images:**

- `ghcr.io/<org>/hopwhistle/api:<version>`
- `ghcr.io/<org>/hopwhistle/web:<version>`
- `ghcr.io/<org>/hopwhistle/worker:<version>`

**Tags:**

- Semantic version (e.g., `1.0.0`)
- Major.Minor (e.g., `1.0`)
- Major (e.g., `1`)
- `latest` (for default branch)

### `deploy.yml` - Deployment

Runs on:

- Push to `main` branch
- Push of version tags
- Manual workflow dispatch

**Deployment Targets:**

1. **DigitalOcean App Platform**
   - Uses `doctl` CLI
   - Deploys from `.do/app.yaml` spec
   - Requires: `DIGITALOCEAN_ACCESS_TOKEN`, `DIGITALOCEAN_APP_ID`

2. **DigitalOcean Droplet (SSH)**
   - Connects via SSH
   - Pulls Docker images
   - Updates docker-compose
   - Runs migrations
   - Health checks
   - Requires: `DEPLOY_SSH_KEY`, `DEPLOY_HOST`, `DEPLOY_USER`

3. **Kubernetes (Helm)**
   - Uses Helm charts from `infra/k8s/helm/hopwhistle`
   - Deploys to Kubernetes cluster
   - Requires: `KUBECONFIG` (base64 encoded)

## Required Secrets

### NPM Publishing

- `NPM_TOKEN` - npm authentication token with publish permissions

### DigitalOcean

- `DIGITALOCEAN_ACCESS_TOKEN` - DO API token
- `DIGITALOCEAN_APP_ID` - App Platform app ID

### SSH Deployment

- `DEPLOY_SSH_KEY` - Private SSH key for server access
- `DEPLOY_HOST` - Server hostname/IP
- `DEPLOY_USER` - SSH username

### Kubernetes

- `KUBECONFIG` - Base64 encoded kubeconfig file

## Usage

### Creating a Release

1. **Using Conventional Commits (Recommended):**

   ```bash
   # Make changes and commit with conventional commit message
   git commit -m "feat(api): add new endpoint"

   # Create version tag
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Manual Release:**
   - Go to Actions → Release → Run workflow
   - Enter version (e.g., `1.0.0`)
   - Click "Run workflow"

### Deploying

1. **Automatic (on push to main):**
   - Push to `main` branch
   - Deployment runs automatically

2. **Manual:**
   - Go to Actions → Deploy → Run workflow
   - Select environment (staging/production)
   - Select target (digitalocean-apps/digitalocean-droplet/kubernetes)
   - Click "Run workflow"

## Version Bumping

The release workflow automatically:

- Extracts version from git tag (e.g., `v1.0.0` → `1.0.0`)
- Updates `package.json` files
- Commits version changes
- Creates GitHub release

## Docker Images

All images are pushed to GitHub Container Registry:

- `ghcr.io/<org>/hopwhistle/api`
- `ghcr.io/<org>/hopwhistle/web`
- `ghcr.io/<org>/hopwhistle/worker`

To pull images:

```bash
docker pull ghcr.io/<org>/hopwhistle/api:latest
```

## Troubleshooting

### PR Checks Failing

1. Check linting errors: `pnpm lint`
2. Check type errors: `pnpm typecheck`
3. Check test failures: `pnpm test`
4. Check build errors: `pnpm build`

### Release Failing

1. Ensure `NPM_TOKEN` secret is set
2. Verify SDK package.json has correct publishConfig
3. Check Docker build logs in Actions

### Deployment Failing

1. Verify secrets are set correctly
2. Check SSH key permissions
3. Verify server connectivity
4. Check docker-compose logs on server

## Workflow Status Badge

Add to README.md:

```markdown
![CI](https://github.com/<org>/hopwhistle/workflows/PR%20Quality%20Gates/badge.svg)
```
