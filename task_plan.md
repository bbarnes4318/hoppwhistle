# Task Plan (B.L.A.S.T. Protocol)

> Phases, goals, and checklists for the Hopwhistle Redesign project.

---

## Current Phase: 🔎 Phase 0 - Reconnaissance

### Objectives

- [x] Verify write access to file system
- [x] Scan existing codebase structure
- [x] Create `current_state.md`
- [x] Create `findings.md`
- [x] Create `progress.md`
- [ ] Create `gemini.md` (Project Constitution)
- [ ] Complete Gap Analysis

---

## Phase 1: 🏗️ Blueprint (Vision & Logic)

> **BLOCKED**: Awaiting answers to Discovery Questions.

### Discovery Questions

- [ ] 1. **North Star**: What is the singular desired outcome?
- [ ] 2. **Integrations**: Which external services? Are keys ready?
- [ ] 3. **Source of Truth**: Where does primary data live?
- [ ] 4. **Delivery Payload**: How/where should results be delivered?
- [ ] 5. **Behavioral Rules**: How should the system "act"?

### Post-Discovery

- [ ] Define Data Schema (Input/Output shapes) in `gemini.md`
- [ ] Research relevant GitHub repos/documentation
- [ ] Get user approval on Blueprint

---

## Phase 2: ⚡ Link (Connectivity)

- [ ] Verify all API connections
- [ ] Test `.env` credentials
- [ ] Build handshake scripts in `tools/`

---

## Phase 3: ⚙️ Architect (3-Layer Build)

### Layer 1: Architecture

- [ ] Create SOPs in `architecture/`

### Layer 2: Navigation

- [ ] Define decision routing logic

### Layer 3: Tools

- [ ] Build atomic Python scripts in `tools/`

---

## Phase 4: ✨ Stylize (Refinement & UI)

- [ ] Format outputs for professional delivery
- [ ] Apply UI/UX polish to frontend components
- [ ] Present to user for feedback

---

## Phase 5: 🛰️ Trigger (Deployment)

- [ ] Move logic to production environment
- [ ] Set up automation triggers
- [ ] Finalize Maintenance Log in `gemini.md`

---

## Notes

- **Halt Condition**: No scripts in `tools/` until Discovery Questions answered and Data Schema defined.
- **Branch**: `resdesign`
