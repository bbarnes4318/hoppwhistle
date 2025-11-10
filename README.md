# Hopwhistle

Production-grade monorepo for a telephony platform with backend (Node/TypeScript), telephony services, frontend (Next.js/React), infrastructure, and shared libraries.

## 🏗️ Architecture

```
hopwhistle/
├── apps/
│   ├── api/              # Node + Fastify + TypeScript API server
│   ├── worker/           # Node + TypeScript background jobs & queues
│   ├── web/              # Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui
│   ├── freeswitch/       # Dockerized FreeSWITCH configs
│   ├── kamailio/         # Dockerized Kamailio configs
│   ├── rtpengine/        # Dockerized RTPEngine configs
│   └── media/            # FFmpeg utilities, transcription services
├── packages/
│   ├── shared/           # Shared TypeScript types & utilities
│   ├── routing-dsl/       # Custom routing DSL + parser
│   └── sdk/              # TypeScript client SDK for API
├── infra/
│   ├── docker/           # docker-compose files, env templates
│   ├── k8s/              # Helm charts / Kubernetes manifests
│   └── terraform/        # DigitalOcean + Hetzner + S3 infrastructure
└── docs/                 # Architecture diagrams, ADRs, OpenAPI
```

## 🚀 Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **Docker** & Docker Compose (for telephony services)
- **Make** (optional, for convenience commands)

### Installation

```bash
# Install all dependencies
pnpm install

# Or use Make
make install
```

### Development

```bash
# Start all apps in development mode
pnpm dev

# Or use Make
make dev

# Start individual apps
pnpm --filter @hopwhistle/api dev
pnpm --filter @hopwhistle/web dev
pnpm --filter @hopwhistle/worker dev
```

### Build

```bash
# Build all packages and apps
pnpm build

# Or use Make
make build
```

### Testing

```bash
# Run all tests
pnpm test

# Run tests for a specific package/app
pnpm --filter @hopwhistle/api test
pnpm --filter @hopwhistle/web test
```

### Linting & Formatting

```bash
# Lint all code
pnpm lint

# Fix linting issues
pnpm lint:fix

# Format all code
pnpm format

# Check formatting
pnpm format:check
```

## 📦 Workspace Packages

### Apps

- **@hopwhistle/api** - Main API server (Fastify + TypeScript)
- **@hopwhistle/worker** - Background job processor (BullMQ)
- **@hopwhistle/web** - Next.js frontend application

### Packages

- **@hopwhistle/shared** - Shared types and utilities
- **@hopwhistle/routing-dsl** - Custom routing DSL parser
- **@hopwhistle/sdk** - TypeScript client SDK

## 🐳 Docker Services

Start all telephony services and dependencies:

```bash
# Start services
make docker-up
# or
docker-compose -f infra/docker/docker-compose.yml up -d

# View logs
make docker-logs
# or
docker-compose -f infra/docker/docker-compose.yml logs -f

# Stop services
make docker-down
# or
docker-compose -f infra/docker/docker-compose.yml down
```

Services include:

- PostgreSQL (port 5432)
- Redis (port 6379)
- FreeSWITCH (ports 5060, 5080, 8021)
- Kamailio (port 5060)
- RTPEngine (port 22222)

## ☁️ Deployment (DigitalOcean App Platform)

**No Docker required!** This application is configured to deploy directly to DigitalOcean App Platform.

### Quick Deploy

1. **Push to GitHub:**

   ```bash
   git remote add origin https://github.com/bbarnes4318/hopwhistle.git
   git push -u origin main
   ```

2. **Connect to DigitalOcean:**
   - Go to [DigitalOcean App Platform](https://cloud.digitalocean.com/apps)
   - Click "Create App"
   - Connect your GitHub repository
   - DigitalOcean will automatically detect `.do/app.yaml`

3. **Set Environment Variables:**
   - `JWT_SECRET` - Generate a secure random string
   - `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` - Your S3/Spaces credentials
   - `NEXT_PUBLIC_API_URL` - Your API URL
   - `NEXT_PUBLIC_WS_URL` - Your WebSocket URL

4. **Deploy:**
   - Click "Create Resources"
   - DigitalOcean will provision databases and deploy all services

### Post-Deployment

After first deployment, run migrations:

```bash
# Via DigitalOcean console or SSH
pnpm --filter @hopwhistle/api db:migrate:deploy
```

**See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed instructions.**

## 🗄️ Database Setup

The API uses PostgreSQL with Prisma ORM. The schema supports multi-tenant call tracking with comprehensive features.

### Initial Setup

```bash
# Generate Prisma Client
pnpm --filter @hopwhistle/api db:generate

# Run migrations (creates database schema)
pnpm db:migrate

# Seed database with test data
pnpm db:seed
```

### Database Scripts

```bash
# Create and apply migration
pnpm --filter @hopwhistle/api db:migrate

# Deploy migrations (production)
pnpm --filter @hopwhistle/api db:migrate:deploy

# Reset database (WARNING: deletes all data)
pnpm --filter @hopwhistle/api db:migrate:reset

# Seed database
pnpm db:seed

# Open Prisma Studio (database GUI)
pnpm --filter @hopwhistle/api db:studio

# Push schema changes (dev only, no migration)
pnpm --filter @hopwhistle/api db:push
```

### Schema Documentation

- [Database Schema Documentation](./docs/SCHEMA.md)
- ERD diagram: Generated at `docs/erd.png` after running `pnpm db:generate`

The seed script creates:

- Test tenant (`test-org`)
- Admin user (`admin@test.callfabric.local` / `password123`)
- Publisher and buyer with endpoints
- Sample campaign
- Flow with IVR → Queue → Buyer Failover nodes
- Billing account, rate card, and balance
- DNC list and webhook configuration

## ⚙️ Environment Variables

Each app requires environment variables. Create `.env` files based on the examples below:

### API (`apps/api/.env`)

```env
PORT=3001
HOST=0.0.0.0
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/callfabric
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key-change-in-production
RTPENGINE_URL=http://localhost:22222
FREESWITCH_ESL_HOST=localhost
FREESWITCH_ESL_PORT=8021
FREESWITCH_ESL_PASSWORD=ClueCon
```

### Worker (`apps/worker/.env`)

```env
NODE_ENV=development
REDIS_URL=redis://localhost:6379
DATABASE_URL=postgresql://user:password@localhost:5432/callfabric
RTPENGINE_URL=http://localhost:22222
FREESWITCH_ESL_HOST=localhost
FREESWITCH_ESL_PORT=8021
FREESWITCH_ESL_PASSWORD=ClueCon
WORKER_CONCURRENCY=5
```

### Web (`apps/web/.env`)

```env
NEXT_PUBLIC_API_URL=http://localhost:3001
NODE_ENV=development
NEXT_PUBLIC_APP_NAME=CallFabric
```

### Media (`apps/media/.env`)

```env
NODE_ENV=development
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
TRANSCRIPTION_API_KEY=your-api-key
TRANSCRIPTION_SERVICE_URL=https://api.example.com/transcribe
STORAGE_BUCKET=callfabric-media
STORAGE_REGION=us-east-1
```

## 🛠️ Tooling

### TypeScript

- Strict mode enabled
- Path aliases configured for workspace packages
- Shared `tsconfig.json` with project references

### Code Quality

- **ESLint** - Linting with TypeScript support
- **Prettier** - Code formatting
- **EditorConfig** - Consistent editor settings
- **Husky** - Git hooks
- **lint-staged** - Run linters on staged files
- **commitlint** - Enforce conventional commits

### Testing

- **Vitest** - Unit tests for API and packages
- **Playwright** - E2E tests for web app
- **Supertest** - API integration tests

### Build Tools

- **tsup** - Fast TypeScript bundler for packages
- **Next.js** - Built-in build system for web app

## 📝 Git Workflow

This project uses conventional commits. Commit messages should follow the format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`

Example:

```
feat(api): add call routing endpoint

Implements POST /api/v1/calls/route endpoint for handling call routing logic.
```

## 🏗️ Infrastructure

### Docker

- Development docker-compose setup in `infra/docker/`
- Production overrides available

### Kubernetes

- Manifests and Helm charts in `infra/k8s/`
- Customize based on your cluster configuration

### Terraform

- Infrastructure as code in `infra/terraform/`
- Supports DigitalOcean, Hetzner, and S3-compatible storage

## 📚 Documentation

- Architecture diagrams: `docs/architecture/`
- ADRs: `docs/adr/`
- API documentation: `docs/api/openapi.yaml`

## 🧪 Available Scripts

### Root Level

- `pnpm dev` - Start all apps in dev mode
- `pnpm build` - Build all packages and apps
- `pnpm test` - Run all tests
- `pnpm lint` - Lint all code
- `pnpm lint:fix` - Fix linting issues
- `pnpm format` - Format all code
- `pnpm typecheck` - Type check all packages
- `pnpm clean` - Clean all build artifacts

### Per Package/App

Each package and app has its own scripts. Use `pnpm --filter <package-name> <script>` to run them.

## 🤝 Contributing

1. Create a feature branch
2. Make your changes
3. Ensure tests pass: `pnpm test`
4. Ensure linting passes: `pnpm lint`
5. Commit using conventional commits
6. Push and create a pull request

## 📄 License

[Add your license here]

## 🔗 Links

- [API Documentation](./docs/api/openapi.yaml)
- [Architecture Decisions](./docs/adr/)
