import 'dotenv-flow/config';

import {
  RESEARCH_MODES,
  STAGE_DEFINITIONS,
  normalizeBrief,
  preflightRun,
  resolveAssignments,
  structuredReportSchema,
  type CanonicalBrief,
  type ProviderRole,
  type ResearchBriefInput,
} from '@hopwhistle/shared';

import { ResearchOrchestrator } from '../services/industry-research/orchestrator.js';

// REAL end-to-end pipeline test against LIVE provider APIs, using an in-memory
// store (the configured Postgres is unreachable from this host). The orchestrator
// and RealAdapter run their true code paths with real HTTP calls — no mock.
//
//   pnpm --filter @hopwhistle/worker exec tsx src/scripts/industry-research-live-inmemory.ts
//   FULL=1 … → full due diligence (google+perplexity+xai+anthropic synth+verify)

type Row = Record<string, unknown>;

function applyData(target: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in (v as Row)) {
      target[k] = ((target[k] as number) ?? 0) + ((v as { increment: number }).increment ?? 0);
    } else target[k] = v;
  }
}

function fakePrisma() {
  const runs = new Map<string, Row>();
  const stages: Row[] = [];
  const reports: Row[] = [];
  let seq = 0;
  return {
    _runs: runs,
    _stages: stages,
    _reports: reports,
    researchRun: {
      findUnique: ({ where, include }: any) => {
        const run = runs.get(where.id);
        if (!run) return Promise.resolve(null);
        if (include?.stages)
          return Promise.resolve({ ...run, stages: stages.filter(s => s.runId === where.id) });
        return Promise.resolve({ ...run });
      },
      update: ({ where, data }: any) => {
        applyData(runs.get(where.id)!, data);
        return Promise.resolve({ ...runs.get(where.id)! });
      },
    },
    researchStage: {
      findFirst: ({ where }: any) =>
        Promise.resolve(
          stages.find(s => s.runId === where.runId && s.stageKey === where.stageKey) ?? null
        ),
      findMany: ({ where }: any) =>
        Promise.resolve(
          stages.filter(s => s.runId === where.runId && where.stageKey.in.includes(s.stageKey))
        ),
      update: ({ where, data }: any) => {
        applyData(stages.find(s => s.id === where.id)!, data);
        return Promise.resolve({});
      },
    },
    researchReport: {
      create: ({ data }: any) => {
        const row = { id: `report-${++seq}`, ...data };
        reports.push(row);
        return Promise.resolve(row);
      },
      findFirst: ({ where }: any) =>
        Promise.resolve(
          reports
            .filter(r => r.runId === where.runId)
            .sort((a, b) => (b.version as number) - (a.version as number))[0] ?? null
        ),
    },
  };
}

function short(s: unknown): string {
  const v = typeof s === 'string' ? s : '';
  return v ? (v.length > 14 ? `${v.slice(0, 8)}…${v.slice(-4)}` : v) : '—';
}

async function main() {
  const mode = (
    process.env.FULL === '1' ? 'full_due_diligence' : 'rapid_scan'
  ) as ResearchBriefInput['mode'];
  const input: ResearchBriefInput = {
    industry: process.env.TEST_INDUSTRY || 'Commercial HVAC maintenance services',
    geography: 'United States',
    customer: 'Small and mid-sized commercial property operators',
    businessModel: 'Open to any model',
    timeToFirstRevenue: '30 days',
    capabilities: ['ai-development-and-integration', 'cold-calling', 'saas-development'],
    mode,
    maxBudgetUsd: Number(process.env.TEST_BUDGET || 25),
  };

  console.log(`\n=== Industry Research LIVE (in-memory) — ${mode} ===`);
  const pf = preflightRun(process.env, input);
  console.log('Preflight OK:', pf.ok, '| assignments:', JSON.stringify(pf.assignments));
  if (!pf.ok) {
    console.error('Preflight errors:', pf.errors);
    process.exit(2);
  }

  const brief: CanonicalBrief = normalizeBrief(input, {
    researchBriefId: crypto.randomUUID(),
    now: new Date(),
  });
  const assignments = resolveAssignments(process.env, input);
  const runId = crypto.randomUUID();
  const fake = fakePrisma();
  fake._runs.set(runId, {
    id: runId,
    tenantId: 'live',
    userId: 'live',
    status: 'queued',
    brief,
    providerAssignments: assignments,
    maxBudgetUsd: input.maxBudgetUsd,
    accruedCostUsd: 0,
    progress: [],
    startedAt: null,
    finishedAt: null,
  });
  const active = new Set<ProviderRole>(RESEARCH_MODES[mode].roles);
  for (const d of STAGE_DEFINITIONS) {
    const skipped = Boolean(d.role) && !active.has(d.role as ProviderRole);
    fake._stages.push({
      id: `stage-${d.key}`,
      runId,
      stageKey: d.key,
      label: d.label,
      role: d.role ?? null,
      status: skipped ? 'skipped' : 'pending',
      costUsd: 0,
      usedFallback: false,
      output: null,
      createdAt: new Date(),
    });
  }

  const started = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await new ResearchOrchestrator(fake as any).processRun(runId);
  const durationSec = Math.round((Date.now() - started) / 1000);

  const run = fake._runs.get(runId)!;
  console.log('\n--- RESULT ---');
  console.log('Status:', run.status, '| Verdict:', run.verdict, '| Score:', run.overallScore);
  console.log(
    'Duration:',
    durationSec + 's',
    '| Accrued cost: $' + Number(run.accruedCostUsd || 0).toFixed(4)
  );
  console.log('Error:', run.error || '—');
  console.log('\nStages:');
  for (const s of fake._stages) {
    const out = s.output as { requestId?: string } | null;
    console.log(
      `  ${String(s.stageKey).padEnd(14)} ${String(s.status).padEnd(10)} ${String(s.provider || '').padEnd(11)} ` +
        `src=${s.sourcesFound ?? '-'} cost=$${Number(s.costUsd || 0).toFixed(4)} req=${short(out?.requestId)} ` +
        `${s.usedFallback ? '(fallback)' : ''} ${s.error ? '! ' + String(s.error).slice(0, 90) : ''}`
    );
  }

  const report = fake._reports.at(-1);
  if (report) {
    const valid = structuredReportSchema.safeParse(report.structured).success;
    const sources = (report.sources as unknown[]) || [];
    const evidence = (report.evidence as unknown[]) || [];
    console.log(
      '\nReport: version',
      report.version,
      '| synthesis',
      report.synthesisProvider,
      report.synthesisModel
    );
    console.log(
      'Schema valid:',
      valid,
      '| sources:',
      sources.length,
      '| evidence claims:',
      evidence.length,
      '| verification:',
      report.verification ? 'present' : 'none'
    );
    const struct = report.structured as { executiveVerdict?: { oneSentenceConclusion?: string } };
    console.log('Conclusion:', struct.executiveVerdict?.oneSentenceConclusion);
  } else {
    console.log('\nNo report (a required stage failed — expected only on failure).');
  }

  process.exit(run.status === 'completed' ? 0 : 1);
}

main().catch(e => {
  console.error('Live test crashed:', e);
  process.exit(1);
});
