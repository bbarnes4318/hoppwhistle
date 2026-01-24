# Hopwhistle Current State (Phase 0: Reconnaissance)

> Generated: 2026-01-24T09:10:00-05:00
> Branch: `resdesign`

---

## Tech Stack Summary

| Layer        | Technology                      |
| ------------ | ------------------------------- |
| Package Mgr  | pnpm 8.15.0 (Monorepo)          |
| Language     | TypeScript 5.3.x                |
| Frontend     | Next.js 14 (App Router)         |
| Backend API  | Fastify (Node.js)               |
| Database ORM | Prisma 6.19                     |
| Styling      | Tailwind CSS                    |
| Infra        | Docker Compose (Dev/Prod)       |
| Telephony    | FreeSWITCH, Kamailio, RTPEngine |
| Testing      | Vitest, Playwright, k6 (perf)   |

---

## Directory Structure Overview

```
hopbot/
├── apps/                 # 8 Core Applications
│   ├── api/              # Fastify API (112 files)
│   │   └── src/
│   │       ├── routes/   # 19 route files
│   │       ├── services/ # 40 service files
│   │       └── middleware/
│   ├── web/              # Next.js 14 Frontend (116 files)
│   │   └── src/
│   │       ├── app/      # 40 pages/layouts
│   │       ├── components/ # 64 components
│   │       └── lib/
│   ├── worker/           # Background jobs (BullMQ)
│   ├── freeswitch/       # Telephony SIP engine
│   ├── kamailio/         # SIP proxy
│   ├── rtpengine/        # Media relay
│   ├── media/            # FFmpeg/transcription
│   └── monitor/          # Health checks
│
├── packages/             # Shared Libraries
│   ├── shared/           # Common types & utilities
│   ├── routing-dsl/      # Custom call routing language
│   └── sdk/              # TypeScript SDK
│
├── infra/                # Infrastructure
│   └── docker/
│       ├── docker-compose.yml      # Base config
│       ├── docker-compose.dev.yml  # Dev overlay
│       ├── docker-compose.prod.yml # Prod overlay
│       └── docker-compose.voice.yml # Telephony stack
│
├── docs/                 # Documentation (39 files)
├── tests/                # Test suites (SIP, k6 perf)
└── scripts/              # Utility scripts
```

---

## Key Configuration Files

| File                 | Purpose                       |
| -------------------- | ----------------------------- |
| `.env`               | Environment variables (6.4KB) |
| `package.json`       | Root workspace config         |
| `Makefile`           | Common dev/deploy tasks       |
| `docker-compose.yml` | Base Docker orchestration     |
| `tsconfig.json`      | Root TypeScript config        |

---

## Existing Documentation

- `README.md` - Main project docs
- `DEPLOYMENT.md` - Deployment guide
- `QUICKSTART.md` - Quick start guide
- `START_HERE.md` - Onboarding
- `FILE_TREE.md` - Project structure reference

---

## Status

✅ Write access verified  
✅ Codebase scanned  
⏳ Gap analysis pending (in `findings.md`)
