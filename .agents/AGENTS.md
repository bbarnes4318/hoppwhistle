# Project Rules: Phone Code Lockdown

To prevent accidental changes and regressions to the telephony infrastructure and configurations, the following files and directories are locked down.

## CRITICAL INSTRUCTION FOR ALL AI AGENTS
> [!IMPORTANT]
> Do NOT modify, delete, rename, or touch any of the following telephony-related files and directories, **unless the user explicitly and specifically instructs you to modify them in their current prompt.**
> 
> When fulfilling any request, you must complete your changes in other files without editing these protected files.

## Protected Telephony Files & Directories

### 1. Infrastructure Services
- `apps/freeswitch/` (and all sub-directories/files)
- `apps/kamailio/` (and all sub-directories/files)
- `apps/rtpengine/` (and all sub-directories/files)

### 2. Custom Routing Parser
- `packages/routing-dsl/` (and all sub-directories/files)

### 3. Root Scripts & Vapi Assets
- `dial.py`
- `check-sip.sh`
- `create-sip-user.sh`
- `agent.json`
- All audio assets (e.g., `*.wav` files)

### 4. API Endpoints & Routes
- `apps/api/src/routes/agent-phone.ts`
- `apps/api/src/routes/freeswitch-mock.ts`
- `apps/api/src/routes/anveo-procurement.ts`
- `apps/api/src/routes/did-routes.ts`
- `apps/api/src/routes/signalwire-webhooks.ts`

### 5. API Backend Services
- `apps/api/src/services/freeswitch-service.ts`
- `apps/api/src/services/vapi-carrier-service.ts`
- `apps/api/src/services/fronter-bot.ts`
- `apps/api/src/services/recording-reconciler.ts`
- `apps/api/src/services/recording-service.ts`
