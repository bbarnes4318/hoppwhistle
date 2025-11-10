# CallFabric Monorepo File Tree

```
callfabric/
├── .editorconfig                 # Editor configuration
├── .eslintrc.json                # ESLint configuration
├── .gitignore                    # Git ignore rules
├── .lintstagedrc.json            # lint-staged configuration
├── .prettierignore               # Prettier ignore rules
├── .prettierrc.json              # Prettier configuration
├── commitlint.config.js          # Commitlint configuration
├── Makefile                      # Common tasks
├── package.json                  # Root package.json with workspaces
├── pnpm-workspace.yaml           # pnpm workspace configuration
├── README.md                     # Main documentation
├── tsconfig.json                 # Root TypeScript configuration
│
├── .husky/                       # Git hooks
│   ├── commit-msg                # Commit message validation
│   └── pre-commit                # Pre-commit linting
│
├── .vscode/                      # VS Code settings
│   ├── extensions.json           # Recommended extensions
│   └── settings.json             # Workspace settings
│
├── apps/                         # Applications
│   ├── api/                      # Node + Fastify + TypeScript API
│   │   ├── env.example           # Environment variables template
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts        # Build configuration
│   │   ├── vitest.config.ts       # Test configuration
│   │   └── src/
│   │       └── index.ts          # API entry point
│   │
│   ├── worker/                   # Background jobs & queues
│   │   ├── env.example
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   └── src/
│   │       └── index.ts
│   │
│   ├── web/                      # Next.js 14 App Router frontend
│   │   ├── .eslintrc.json
│   │   ├── env.example
│   │   ├── next.config.js
│   │   ├── package.json
│   │   ├── playwright.config.ts  # E2E test configuration
│   │   ├── postcss.config.js
│   │   ├── tailwind.config.ts
│   │   ├── tsconfig.json
│   │   ├── e2e/
│   │   │   └── example.spec.ts
│   │   └── src/
│   │       └── app/
│   │           ├── globals.css
│   │           ├── layout.tsx
│   │           └── page.tsx
│   │
│   ├── freeswitch/               # Dockerized FreeSWITCH
│   │   ├── Dockerfile
│   │   ├── README.md
│   │   └── conf/
│   │       └── vars.xml
│   │
│   ├── kamailio/                 # Dockerized Kamailio
│   │   ├── Dockerfile
│   │   ├── kamailio.cfg
│   │   └── README.md
│   │
│   ├── rtpengine/                # Dockerized RTPEngine
│   │   ├── Dockerfile
│   │   └── README.md
│   │
│   └── media/                    # FFmpeg utilities & transcription
│       ├── env.example
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       └── src/
│           └── index.ts
│
├── packages/                     # Shared packages
│   ├── shared/                   # Shared types & utilities
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types/
│   │       │   └── index.ts
│   │       └── utils/
│   │           └── index.ts
│   │
│   ├── routing-dsl/              # Custom routing DSL parser
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsup.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── parser.ts
│   │       └── executor.ts
│   │
│   └── sdk/                      # TypeScript client SDK
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsup.config.ts
│       └── src/
│           ├── index.ts
│           ├── client.ts
│           └── types.ts
│
├── infra/                        # Infrastructure as code
│   ├── docker/                   # Docker Compose configurations
│   │   ├── docker-compose.yml
│   │   ├── docker-compose.prod.yml
│   │   └── env.template
│   │
│   ├── k8s/                      # Kubernetes manifests
│   │   └── README.md
│   │
│   └── terraform/                # Terraform IaC
│       ├── main.tf
│       └── README.md
│
├── docs/                         # Documentation
│   ├── README.md
│   └── api/
│       └── openapi.yaml          # OpenAPI specification
│
└── scripts/                      # Utility scripts
    ├── setup.sh                  # Setup script (bash)
    └── setup.ps1                 # Setup script (PowerShell)
```

## Key Files Summary

### Root Configuration

- `package.json` - Monorepo root with workspace scripts
- `pnpm-workspace.yaml` - pnpm workspace configuration
- `tsconfig.json` - Shared TypeScript configuration
- `.eslintrc.json` - ESLint rules
- `.prettierrc.json` - Prettier formatting rules
- `Makefile` - Common development tasks

### Quality Gates

- `.husky/` - Git hooks for pre-commit and commit-msg
- `.lintstagedrc.json` - Lint staged files on commit
- `commitlint.config.js` - Enforce conventional commits

### Applications

Each app has:

- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `env.example` - Environment variable template
- Source code in `src/` directory

### Packages

Each package:

- Exports TypeScript types
- Uses tsup for building
- Can be imported via workspace protocol

### Infrastructure

- Docker Compose for local development
- Kubernetes manifests (placeholder)
- Terraform for cloud infrastructure (placeholder)
