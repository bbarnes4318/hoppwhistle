import 'dotenv-flow/config';

import { PrismaClient } from '@prisma/client';
import {
  RESEARCH_MODES,
  STAGE_DEFINITIONS,
  estimateRunCost,
  normalizeBrief,
  preflightRun,
  resolveAssignments,
  type ProviderRole,
  type ResearchBriefInput,
} from '@hopwhistle/shared';

import { ResearchOrchestrator } from '../services/industry-research/orchestrator.js';

// Controlled REAL end-to-end test. Drives the actual multi-provider pipeline
// against the configured real provider APIs (no mock). Uses rapid_scan by
// default to keep cost low; pass FULL=1 for full due diligence.
//
//   pnpm --filter @hopwhistle/worker exec tsx src/scripts/industry-research-live-test.ts
//
// Requires: DATABASE_URL reachable, the migration applied, and real provider
// keys present in the environment (.env / .env.local).

const prisma = new PrismaClient();

function short(s?: string | null): string {
  if (!s) return '—';
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

async function main() {
  const mode = process.env.FULL === '1' ? 'full_due_diligence' : 'rapid_scan';
  const input: ResearchBriefInput = {
    industry: process.env.TEST_INDUSTRY || 'Commercial HVAC maintenance services',
    geography: 'United States',
    customer: 'Small and mid-sized commercial property operators',
    businessModel: 'Open to any model',
    timeToFirstRevenue: '30 days',
    capabilities: ['ai-development-and-integration', 'cold-calling', 'saas-development'],
    mode: mode as ResearchBriefInput['mode'],
    maxBudgetUsd: Number(process.env.TEST_BUDGET || 25),
  };

  console.log(`\n=== Industry Research LIVE test (${mode}) ===`);
  const pf = preflightRun(process.env, input);
  console.log('Preflight OK:', pf.ok);
  console.log('Assignments:', JSON.stringify(pf.assignments));
  if (!pf.ok) {
    console.error('Preflight errors:', pf.errors);
    process.exit(2);
  }

  const brief = normalizeBrief(input, { researchBriefId: crypto.randomUUID(), now: new Date() });
  const assignments = resolveAssignments(process.env, input);
  const estimate = estimateRunCost(input.mode, assignments);

  const activeRoles = new Set<ProviderRole>(RESEARCH_MODES[input.mode].roles);
  const run = await prisma.researchRun.create({
    data: {
      tenantId: 'live-test',
      userId: 'live-test',
      researchBriefId: brief.researchBriefId,
      industry: brief.industry,
      geography: brief.geography || 'United States',
      mode: brief.mode,
      status: 'queued',
      brief: brief as unknown as object,
      providerAssignments: assignments as unknown as object,
      costEstimate: estimate as unknown as object,
      maxBudgetUsd: input.maxBudgetUsd,
      estimatedCostUsd: (estimate.lowUsd + estimate.highUsd) / 2,
      progress: [],
      stages: {
        create: STAGE_DEFINITIONS.map(d => {
          const skipped = Boolean(d.role) && !activeRoles.has(d.role as ProviderRole);
          return {
            stageKey: d.key,
            label: d.label,
            role: d.role ?? null,
            status: skipped ? 'skipped' : 'pending',
          };
        }),
      },
    },
    select: { id: true },
  });

  console.log('Run id:', run.id);
  const started = Date.now();
  await new ResearchOrchestrator(prisma).processRun(run.id);
  const durationSec = Math.round((Date.now() - started) / 1000);

  const final = await prisma.researchRun.findUnique({
    where: { id: run.id },
    include: {
      stages: { orderBy: { createdAt: 'asc' } },
      reports: { orderBy: { version: 'desc' } },
    },
  });
  if (!final) {
    console.error('Run vanished');
    process.exit(1);
  }

  console.log('\n--- RESULT ---');
  console.log('Status:', final.status);
  console.log('Verdict:', final.verdict, 'Score:', final.overallScore);
  console.log(
    'Duration:',
    durationSec + 's',
    '| Accrued cost: $' + final.accruedCostUsd.toFixed(4)
  );
  console.log('Error:', final.error || '—');
  console.log('\nStages:');
  for (const s of final.stages) {
    const out = s.output as { requestId?: string } | null;
    console.log(
      `  ${s.stageKey.padEnd(14)} ${String(s.status).padEnd(10)} ${(s.provider || '').padEnd(11)} ` +
        `src=${s.sourcesFound ?? '-'} cost=$${(s.costUsd ?? 0).toFixed(4)} req=${short(out?.requestId)} ` +
        `${s.usedFallback ? '(fallback)' : ''} ${s.error ? '! ' + s.error.slice(0, 80) : ''}`
    );
  }

  const report = final.reports[0];
  if (report) {
    const sources = (report.sources as unknown[]) || [];
    const evidence = (report.evidence as unknown[]) || [];
    console.log('\nReport version:', report.version);
    console.log('Synthesis:', report.synthesisProvider, report.synthesisModel);
    console.log('Sources:', sources.length, '| Evidence claims:', evidence.length);
    console.log('Verification:', report.verification ? 'present' : 'none');
  } else {
    console.log('\nNo report published (expected only if a required stage failed).');
  }

  await prisma.$disconnect();
  process.exit(final.status === 'completed' ? 0 : 1);
}

main().catch(async e => {
  console.error('Live test crashed:', e);
  await prisma.$disconnect();
  process.exit(1);
});
