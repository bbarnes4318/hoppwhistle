# Industry Research — Report V2 Architecture (Phase 1)

Ground truth from the real schema (`packages/shared/.../types.ts` → `StructuredReport`)
and one real completed report (run `d8253e89`, "Residential gutter cleaning, Austin TX",
Full DD, CONDITIONAL_GO / 62, 82 sources, 20 claims). Saved as a labeled dev fixture at
`__fixtures__/report-d8253e89.json`.

## 1. Data inventory — what is actually populated

Audited field-fill across the real report. This is decisive: it determines what can be
honestly visualized vs. what must be presented as prose or "Not established".

| Data | Fill in real report | Verdict for V2 |
|---|---|---|
| `executiveVerdict` | Fully populated. `verdict`, `overallScore` (62), `confidence` (0.6); `bestSegment/Customer/BusinessModel`, `timeToFirstRevenue`, `initialCapital`, `biggestOpportunity/Risk`, `oneSentenceConclusion` are **rich prose** (e.g. capital = "$25,000 (…reserve most for insurance…)") | **Hero.** Extract headline value + keep the qualifier. Drives the score gauge + confidence. |
| `rankedOpportunities` (5) | **Only `rank`, `opportunity`, `opportunityScore`.** customer/offer/revenueModel/price/startupCost/time/margin/difficulty/regulatory/defensibility = **all empty** | Rank + name + **score-ranking bars only.** Detail comes from `ranked_opportunities` + `entry_thesis` prose. **No fabricated opportunity matrix.** Drawer shows what exists + honest "Not established". |
| `unitEconomicsScenarios` (3) | **Only `name`** (conservative/base/aggressive). asp/grossMargin/cac/payback/ltv/notes = **all empty** | **No scenario-number table, no scenario bars.** Economics = `economics` section prose (which *does* contain the numbers as text) + capital + assumptions. `deriveEconomicVerdict` → "Not established" (honest). |
| `competitors` (12) | **Only `name`.** All detail empty | Competitor **name chips** + `competitive_intelligence` prose (which contains a real markdown comparison table). **No fabricated competitor matrix from structured fields.** |
| `evidenceLedger` (20 claims) | **Rich:** `category`, `classification` (verified_fact 6 / reported_experience 11 / estimate 2 / unverified 1), `confidence`, `materiality`, `notes`, `text`, `supportingSourceIds` | **Primary viz source.** Classification mix, confidence×materiality, category coverage. |
| `sources` (82) | `url`, `provider` (xai/perplexity/google), `validated`, `title` (often junk) | Provenance viz (by provider, validation rate) + sources workspace. |
| `killCriteria` (7) | Rich sentences | **Lead the Risk section** — prominent, visually distinct stop-conditions. |
| `assumptions` (4) | `field`/`value`/`rationale` | Assumptions table in Economics/Evidence. |
| `contradictions` (4) | `topic`/`positionA`/`positionB`/`cause` | Reconciliation cards in Evidence. |
| `unknowns` (5) | `topic`/`whyItMatters`/`howToObtain` | "What must be validated" cards. |
| `verification.adversarial` | All weakness arrays **empty** here (verdict pass_with_caveats, conf 0.55) | Risk register = 1 row from `biggestRisk`; **rely on killCriteria + regulation prose.** Independent-review summary still shown. |
| `sections` (23) | 16 canonical keyed + **7 duplicate title-keyed** shorter copies | **Dedupe** (prefer canonical keys). Prose is the real substance; render with proper typography incl. tables + linkified citations. |
| `confidenceAssessment` | 1001-char prose | Evidence section. |

Canonical section keys (deduped, render order source): `executive_verdict, outsiders_wrong,
industry_structure, market_evidence, customer_truth, operator_truth,
competitive_intelligence, economics, sales_distribution, regulation_risk,
ranked_opportunities, entry_thesis, first_customer_plan, ninety_day_plan,
validation_tests, evidence_ledger_note`.

Section markdown contains: `**bold labels**`, bullet lists, inline citations `[xai-src-5]`
(→ map to `sources[].sourceId`), and GFM pipe tables. → V2 needs a markdown renderer that
handles tables + linkifies citations (current renderer does neither).

## 2. Decision narrative → section order

1. **Executive Decision Brief** — verdict, score, confidence, best opportunity, capital, time-to-revenue, one reason for / against, next action. (`executiveVerdict`)
2. **Opportunity Overview** — ranked score bars + cards; drawer for detail. (`rankedOpportunities` + prose)
3. **Why it can work / can fail** — balanced two-column factors. (`deriveReasonsFor/Against`, `biggestOpportunity/Risk`, killCriteria)
4. **Economics** — capital, per-job & scenario economics *from prose*, assumptions, honest "unit economics not quantified" note. (`economics` section + `assumptions` + `initialCapital`)
5. **Customer & Demand** — `customer_truth` (+ operator_truth) prose, well typeset.
6. **Competition & Position** — `competitive_intelligence` prose/table + competitor chips.
7. **Risk & Kill Criteria** — biggest risk callout → **7 kill-criteria stop-conditions** (distinct red) → `regulation_risk` prose → risk register (what exists).
8. **Entry Strategy** — `entry_thesis` + `first_customer_plan` as a blueprint.
9. **30/60/90 Execution** — `ninety_day_plan` parsed into a real timeline + `validation_tests`.
10. **AI Briefing Studio** — 4 briefing modes + avatar, intentional panel.
11. **Evidence & Sources** — evidence profile viz, assumptions/contradictions/unknowns, sources workspace, confidence assessment (progressive disclosure).

## 3. Component plan

- `InstitutionalReportV2.tsx` — orchestrator: outer layout (sticky TOC rail + single reading column), search (data-rv-mark scan, prev/next), IntersectionObserver active section, collapse/expand, copy, download MD/JSON, opportunity drawer, mobile nav, back-to-top, print. Reuses honest helpers from `ui/report-helpers.ts` + `ui/report-story.ts`.
- `ReportExecutiveBrief.tsx` — hero: dominant verdict + score gauge + confidence, one-line conclusion, 4 subordinate facts, for/against one-liners, next action.
- `ReportOpportunitySection.tsx` — ranking bars + opportunity cards + drawer trigger.
- `ReportEconomicsSection.tsx` — capital figure, economics prose, assumptions, honesty note.
- `ReportRiskSection.tsx` — biggest-risk callout, kill-criteria stop cards, regulation prose, risk register.
- `ReportExecutionSection.tsx` — 30/60/90 timeline (parsed) + validation tests.
- `ReportEvidenceSection.tsx` — evidence profile charts, assumptions/contradictions/unknowns, sources workspace (reuses `SourcesWorkspace`), confidence assessment.
- `ReportBriefingStudio.tsx` — wraps `AiBriefings` in an intentional studio frame (mode explainers, one-session note).
- `charts-v2.tsx` — `ScoreGauge`, `ConfidenceBar`, `OpportunityRanking`, `ClassificationBar`, `ConfidenceMaterialityPlot`, `CategoryCoverage`, `SourceProvenance`.
- `report-md.tsx` — markdown renderer: pipe-table extraction → styled responsive table; citation linkify; search highlight.
- `report-v2.css` — `--rv-*` spacing/type tokens + `rv-*` component classes, scoped under `[data-product="industry-research"]`, incl. `@media` responsive + `@media print`. Consumes existing institutional color tokens.

## 4. Visualization inventory (every chart answers a question, real fields only)

| Chart | Question | Fields | Why chart > text | Missing-data behavior |
|---|---|---|---|---|
| **ScoreGauge** | How strong is the overall case? | `executiveVerdict.overallScore` (0–100), `verdict` (color) | Instant magnitude + verdict color in one focal mark | Always present (score always exists) |
| **ConfidenceBar** | How sure is the analysis? | `executiveVerdict.confidence` (0–1) | Small meter subordinate to score | Always present |
| **OpportunityRanking** | Which entry paths rank highest, by how much? | `rankedOpportunities[].rank/opportunity/opportunityScore` | Relative gaps between options are visible | Hidden if <2 opportunities |
| **ClassificationBar** | How solid is the evidence base? | `evidenceLedger[].classification` counts | Composition (fact vs anecdote) reads at a glance | Hidden if 0 claims |
| **ConfidenceMaterialityPlot** | Are the high-stakes claims well-supported? | `evidenceLedger[].confidence × materiality` | Reveals unsupported high-materiality claims (top-left) | Hidden if <3 claims |
| **CategoryCoverage** | Where is research concentrated / thin? | `evidenceLedger[].category` counts | Coverage balance obvious as bars | Hidden if 0 claims |
| **SourceProvenance** | Who found the evidence & how much is validated? | `sources[].provider`, `.validated` | Provider mix + validation rate at a glance | Hidden if 0 sources |

**Explicitly NOT charted** (data absent → would be fabrication): unit-economics scenario
numbers, opportunity capital/time/margin per option, competitor comparison matrix. These are
presented as prose or "Not established".

## 5. Layout / wireframe

**Desktop (≥1200px)** — outer 2-col grid: sticky TOC rail (240px) + single reading column
(max 1080px, centered). No permanent right rail (its content folds into the hero + risk).

```
┌───────────────────────────────────────────────────────────────┐
│ wordmark · industry · geography · mode        [search][MD][PDF]│  sticky bar
├──────────┬────────────────────────────────────────────────────┤
│ TOC rail │  ▄▄ EXECUTIVE DECISION BRIEF ▄▄                     │
│ (sticky) │  ┌───────────────┐  CONDITIONAL GO                  │
│ • Brief  │  │  ◕ 62 / 100   │  one-sentence conclusion…        │
│ • Oppty  │  │   gauge       │  ┌ capital ┐┌ time ┐┌ best ┐     │
│ • Why    │  └───────────────┘  └─────────┘└──────┘└──────┘     │
│ • Econ   │  Why work ▸ … | Why fail ▸ …   → Next action        │
│ • Cust   │ ─────────────────────────────────────────────────  │
│ • Comp   │  OPPORTUNITY OVERVIEW   [ranking bars] [cards→drawer]│
│ • Risk   │  ECONOMICS · CUSTOMER · COMPETITION (typeset prose) │
│ • Entry  │  RISK ▸ biggest risk ▸ 7 kill cards ▸ prose         │
│ • Plan   │  30/60/90 TIMELINE                                  │
│ • Brief° │  AI BRIEFING STUDIO                                 │
│ • Evid   │  EVIDENCE PROFILE (charts) ▸ sources workspace      │
└──────────┴────────────────────────────────────────────────────┘
```

**Mobile (≤820px)** — single column; TOC becomes a bottom-sheet "Sections" button; hero
stacks (gauge above facts); ranking bars full width; cards 1-up; tables stack to label/value
rows (no horizontal scroll); timeline vertical.

```
┌──────────────────┐
│ industry · mode  │
│ [search]         │
│ ── BRIEF ──      │
│  ◕ 62  COND GO   │
│  conclusion…     │
│ [cap][time]      │
│ [best][conf]     │
│ why✓ / why✗      │
│ → next action    │
│ ── OPPTY ──      │
│  bars (full)     │
│  card            │
│  card            │
│ …                │
│ [ Sections ▾ ]   │ ← fixed
└──────────────────┘
```

## 6. Dev preview / comparison

`app/(research)/tools/industry-research/v2-preview/page.tsx` (dev-only, unlinked): renders
Current vs V2 from the same fixture via `?v=current|v2` toggle. Production report untouched;
V2 is **not** wired as the default. Promotion to default requires explicit approval.
