# Gemini.md - Project Constitution

> **This is LAW.** All data schemas, behavioral rules, and architectural invariants are defined here.

---

## Project Identity

| Field    | Value                                                     |
| -------- | --------------------------------------------------------- |
| Name     | Hopwhistle → Project Cortex                               |
| Version  | 0.1.0                                                     |
| Branch   | `resdesign` → `feature/project-cortex`                    |
| Protocol | B.L.A.S.T. (Blueprint, Link, Architect, Stylize, Trigger) |
| Codename | The Synthetic Sovereign Transition                        |

---

## Discovery Answers (Phase 1 Complete)

### 1. North Star

Transmute Hopwhistle into the **Active Sovereign** of the call intelligence market via "Neuro-Luminescent" brand identity and "Command Grid" UI. **Zero downtime. Zero logic regression.**

### 2. Integrations

| Technology    | Version | Purpose                |
| ------------- | ------- | ---------------------- |
| React         | 19      | Concurrent Mode        |
| Tailwind CSS  | 4       | Electric Cyber styling |
| Framer Motion | Latest  | Liquid Node animations |

### 3. Source of Truth

- **Data**: Existing Prisma/PostgreSQL (READ-ONLY for telephony schemas)
- **Logic**: Backend API Controllers & SIP Routing (Iron Dome - UNTOUCHABLE)
- **Design**: `STRATEGIC REDESIGN AND BRAND IDENTITY.txt` CSS Variables Appendix

### 4. Delivery Payload

Git branch `feature/project-cortex` containing:

- `tailwind.config.js` with Electric Cyber palette
- "Neural Orb" component (active call indicator)
- "Neon Stream" data visualization library
- `SAFETY_PROTOCOL.md` artifact

### 5. Behavioral Rules

**Persona**: "The Architect of Noise" — Precision-Engineered, Propulsive, Non-Apologetic.

---

## Data Schemas

### Call State Schema (READ-ONLY from PhoneProvider)

```typescript
interface CallState {
  callId: string;
  direction: 'inbound' | 'outbound';
  state: 'idle' | 'ringing' | 'connected' | 'on-hold' | 'ended';
  phoneNumber: string;
  callerName?: string;
  startTime?: Date;
  duration: number;
  isMuted: boolean;
  isOnHold: boolean;
}
```

### UI Component Output Schema

```typescript
interface NeuralOrbProps {
  isActive: boolean;
  pulseIntensity: 'idle' | 'vectoring' | 'locked';
  callDuration: number;
  animationState: 'dormant' | 'awakening' | 'pulsing';
}

interface NeonStreamDataPoint {
  timestamp: number;
  value: number;
  label: string;
  tier: 'primary' | 'secondary' | 'accent';
}
```

---

## Color Palette (Electric Cyber)

| Token           | Hex       | Usage              |
| --------------- | --------- | ------------------ |
| `void-charcoal` | `#0B0D10` | Primary background |
| `electric-cyan` | `#00E5FF` | Primary accent     |
| `neon-magenta`  | `#FF00FF` | Secondary accent   |
| `plasma-white`  | `#F0F4F8` | Text primary       |
| `grid-line`     | `#1A1D23` | Borders, dividers  |

### 🚫 BANNED Colors

- Picton Blue `#1CB0E7` — Legacy SaaS aesthetic
- Standard Gray `#6B7280` — Generic, non-sovereign

---

## Behavioral Constraints (Iron Dome)

1. **DO NOT** modify, refactor, or delete any files related to SIP signaling, call routing, or backend voice APIs.
2. **DO NOT** use "Picton Blue" or "Standard SaaS Gray."
3. **DO NOT** default to Light Mode. Initialize in Dark Mode.
4. **DO NOT** use passive language ("Tracking"). Use active lexicon ("Vectoring", "Telemetry", "Command Grid").
5. **Reliability over Speed**: Never guess at business logic.
6. **Deterministic Tools**: All scripts in `tools/` must be atomic and testable.

---

## Architectural Invariants

1. Updates to logic → Update corresponding SOP in `architecture/` FIRST.
2. Environment variables → Stored in `.env` only.
3. Intermediate files → Use `.tmp/` directory.
4. Native Antigravity artifacts → Mirror to file system as Markdown.
5. Iron Dome files → Listed in `.antigravityignore` (READ-ONLY).

---

## Maintenance Log

| Date       | Change                           | Author       |
| ---------- | -------------------------------- | ------------ |
| 2026-01-24 | Project Constitution initialized | System Pilot |
| 2026-01-24 | Discovery answers documented     | System Pilot |
| 2026-01-24 | Iron Dome quarantine defined     | System Pilot |

---

## Status

| Phase   | Status               |
| ------- | -------------------- |
| Phase 0 | ✅ Complete          |
| Phase 1 | 🔶 AWAITING APPROVAL |
| Phase 2 | ⏳ Pending           |
| Phase 3 | ⏳ Pending           |
| Phase 4 | ⏳ Pending           |
| Phase 5 | ⏳ Pending           |

**Blocked On**: User approval of `SAFETY_PROTOCOL.md`
