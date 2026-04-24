# Music Industry Vertical — Architecture Notes

> **Platform**: AI-Powered Direct-to-Fan Voice Engagement
> **Status**: V2 rebuild — April 2026
> **Base Platform**: Hopwhistle (bbarnes4318/hoppwhistle)

---

## Product Position

This is NOT generic call tracking, lead gen, or a call center dashboard.

**Hopwhistle Music** is an AI-powered direct-to-fan outreach platform for artists, labels, managers, promoters, venues, and fan engagement teams.

Music teams launch AI voice campaigns to opted-in fan audiences to drive pre-saves, ticket sales, merch purchases, VIP upgrades, and verified fan engagement — with real-time proof of every interaction through recordings, transcripts, outcomes, and campaign analytics.

### Primary Metric
**Cost per Album Pre-Save**

### Music-Specific Terminology
| Generic Term | Music Term |
|---|---|
| Calls | Fan Interactions |
| Campaigns | Fan Campaigns |
| Leads | Fans |
| Buyers | Conversion Goals |
| Publishers | Audience Sources |
| Call Logs | Proof Log |
| Recordings | Fan Voice Proof |
| Transcripts | Fan Transcripts |
| Conversion | Verified Action |
| Revenue | Campaign Value |

---

## Demo Data

All data is local mock data in `features/music/data/demo-music-data.ts`.

| Entity | Count |
|---|---|
| Artists | 3 (Nova Eclipse, Kilo Blaze, Aria James) |
| Fan Campaigns | 5 |
| Fans | 50 |
| Fan Interactions | 320 |
| Proof Records | ~190 (completed interactions) |
| Transcript Snippets | 15 templates |

Data is generated deterministically using a seeded PRNG for SSR/hydration safety.

---

## Campaign Types (10)

1. Album Pre-Save
2. Tour Announcement
3. Ticket On-Sale
4. VIP Upgrade
5. Merch Drop
6. Fan Club Reactivation
7. Post-Show Feedback
8. New Single Launch
9. Festival Lineup Alert
10. Meet & Greet Waitlist

---

## Dashboard KPIs (10)

Fans Contacted · Human Answers · Verified Engagements · Pre-Saves · Ticket Intent · Merch Intent · Cost per Pre-Save · Engagement Rate · Proof Captured · Opt-Outs

---

## Where Real Integration Would Happen

| Area | Current | Future |
|---|---|---|
| Fan Interactions | `demo-music-data.ts` | `apiClient.get('/music/interactions')` — maps to existing Call model |
| Campaigns | `demo-music-data.ts` | `apiClient.get('/music/campaigns')` — maps to existing Campaign model |
| Recordings | Mock boolean | Existing recording infrastructure (S3) |
| Transcripts | Static snippets | Existing Vapi transcription pipeline |
| Fan Database | `demo-music-data.ts` | New `MusicFan` model or extension of Contact |
| Proof Records | Computed from interactions | Dedicated proof API or view over calls |
| Analytics | Computed in-browser | Backend aggregation endpoints |

---

## Files Untouched (Base Hopwhistle)

All existing dashboard, campaigns, calls, call-center, settings, billing, buyers, publishers, numbers, and voice-agents pages remain completely untouched.

---

## Route Structure

### Public
- `/music` — Landing page (AI voice engagement positioning)

### Protected (inside `(dashboard)` layout)
- `/music-console` — Dashboard with 10 KPI cards
- `/music-console/campaigns` — Fan campaigns
- `/music-console/fans` — Fan database
- `/music-console/proof` — Proof log with expandable transcripts
- `/music-console/reports` — Per-campaign analytics
- `/music-console/settings` — AI voice, compliance, recording config
