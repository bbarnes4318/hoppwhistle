import { randomUUID } from 'crypto';

import {
  CAPABILITY_CATEGORIES,
  FRESH_PROVENANCE,
  PRICING_AS_OF,
  PROVIDER_ROLE_LABELS,
  RESEARCH_MODES,
  STAGE_DEFINITIONS,
  buildProviderRegistry,
  estimateRunCost,
  normalizeBrief,
  preflightRun,
  researchBriefInputSchema,
  resolveAssignments,
  type ProviderRole,
  type ResearchRunSummary,
  type RunProvenance,
  type StageInfo,
} from '@hopwhistle/shared';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getPrismaClient } from '../lib/prisma.js';
import { getRedisClient } from '../services/redis.js';

const prisma = getPrismaClient();

const RESEARCH_CHANNEL = 'industry_research.*';
const RUN_REQUESTED_EVENT = 'industry_research.run.requested';

interface AuthCtx {
  tenantId: string;
  userId: string;
}

function featureEnabled(): boolean {
  // Additive admin tool; enabled by default but live provider spend is a
  // separate switch (INDUSTRY_RESEARCH_LIVE_PROVIDERS, off by default).
  return process.env.INDUSTRY_RESEARCH_ENABLED !== 'false';
}

/** Require an authenticated Owner/Admin. Verifies roles against the DB (the
 *  session token does not always embed roles), returns null + error otherwise. */
async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<AuthCtx | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const user = (request as any).user as
    | { tenantId?: string; userId?: string; roles?: string[] }
    | undefined;
  const tenantId = user?.tenantId;
  const userId = user?.userId;
  if (!tenantId || !userId) {
    void reply.code(401);
    return null;
  }
  const hasAdmin = (roles: string[]) =>
    roles.map(r => r.toUpperCase()).some(r => r === 'OWNER' || r === 'ADMIN');

  if (hasAdmin(user?.roles ?? [])) return { tenantId, userId };

  // Token did not carry roles — authoritatively check the database.
  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { roles: { include: { role: true } } },
    });
    const dbRoles = (dbUser?.roles ?? []).map(ur => ur.role.name);
    if (hasAdmin(dbRoles)) return { tenantId, userId };
  } catch {
    /* fall through to 403 */
  }
  void reply.code(403);
  return null;
}

function planStages(mode: keyof typeof RESEARCH_MODES): Array<{
  stageKey: string;
  label: string;
  role: string | null;
  status: string;
}> {
  const activeRoleSet = new Set<ProviderRole>(RESEARCH_MODES[mode].roles);
  return STAGE_DEFINITIONS.map(def => {
    const isRoleStage = Boolean(def.role);
    const skipped = isRoleStage && !activeRoleSet.has(def.role as ProviderRole);
    return {
      stageKey: def.key,
      label: def.label,
      role: def.role ?? null,
      status: skipped ? 'skipped' : 'pending',
    };
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function provenanceOf(run: any): RunProvenance {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (run?.brief as any)?.provenance as Partial<RunProvenance> | undefined;
  if (p && p.executionType) {
    return {
      executionType: p.executionType,
      reusedFromRunId: p.reusedFromRunId,
      reusedResearch: p.reusedResearch ?? false,
      reusedSourceCount: p.reusedSourceCount ?? 0,
      avoidedProviderCalls: p.avoidedProviderCalls ?? 0,
      avoidedEstimatedCost: p.avoidedEstimatedCost ?? 0,
    };
  }
  return { ...FRESH_PROVENANCE };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runToSummary(run: any): ResearchRunSummary {
  return {
    id: run.id,
    industry: run.industry,
    geography: run.geography,
    mode: run.mode,
    status: run.status,
    createdAt: run.createdAt?.toISOString?.() ?? String(run.createdAt),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    estimatedCostUsd: run.estimatedCostUsd ?? 0,
    accruedCostUsd: run.accruedCostUsd ?? 0,
    maxBudgetUsd: run.maxBudgetUsd ?? 0,
    verdict: run.verdict ?? null,
    overallScore: run.overallScore ?? null,
    hasReport: Array.isArray(run.reports) ? run.reports.length > 0 : false,
    provenance: provenanceOf(run),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stageToInfo(s: any): StageInfo {
  return {
    key: s.stageKey,
    label: s.label,
    status: s.status,
    role: s.role ?? undefined,
    provider: s.provider ?? undefined,
    model: s.model ?? undefined,
    startedAt: s.startedAt ? s.startedAt.toISOString() : undefined,
    finishedAt: s.finishedAt ? s.finishedAt.toISOString() : undefined,
    durationMs:
      s.startedAt && s.finishedAt
        ? new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()
        : undefined,
    sourcesFound: s.sourcesFound ?? undefined,
    searches: s.searches ?? undefined,
    costUsd: s.costUsd ?? 0,
    usedFallback: s.usedFallback ?? false,
    error: s.error ?? null,
  };
}

async function emitRunRequested(tenantId: string, runId: string): Promise<void> {
  const redis = getRedisClient();
  await redis.xadd(
    'events:stream',
    '*',
    'channel',
    RESEARCH_CHANNEL,
    'payload',
    JSON.stringify({ event: RUN_REQUESTED_EVENT, tenantId, data: { runId } })
  );
}

export async function registerIndustryResearchRoutes(fastify: FastifyInstance) {
  await Promise.resolve();

  // --- Config: registry (no secrets), modes, capabilities, pricing date ---
  fastify.get('/api/v1/industry-research/config', async (request, reply) => {
    if (!featureEnabled()) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
    }
    const ctx = await requireAdmin(request, reply);
    if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

    const registry = buildProviderRegistry(process.env).map(c => ({
      id: c.id,
      label: c.label,
      enabled: c.enabled,
      hasKey: c.hasKey,
      model: c.model,
      fallbackModel: c.fallbackModel,
      roles: c.roles,
      apiKeyEnv: c.apiKeyEnv,
    }));

    return {
      data: {
        pricingAsOf: PRICING_AS_OF,
        providers: registry,
        roleLabels: PROVIDER_ROLE_LABELS,
        modes: Object.values(RESEARCH_MODES),
        capabilities: CAPABILITY_CATEGORIES,
      },
    };
  });

  // --- Cost estimate ---
  fastify.post<{ Body: { mode?: string; providerOverrides?: Record<string, string> } }>(
    '/api/v1/industry-research/estimate',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const mode = (request.body?.mode ?? 'full_due_diligence') as keyof typeof RESEARCH_MODES;
      if (!RESEARCH_MODES[mode]) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Invalid mode' } };
      }
      const assignments = resolveAssignments(process.env, {
        mode,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerOverrides: request.body?.providerOverrides as any,
      });
      const estimate = estimateRunCost(mode, assignments);
      return { data: { estimate, assignments, mode } };
    }
  );

  // --- Create a run (brief) ---
  fastify.post('/api/v1/industry-research/runs', async (request, reply) => {
    if (!featureEnabled()) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
    }
    const ctx = await requireAdmin(request, reply);
    if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

    const parsed = researchBriefInputSchema.safeParse(request.body);
    if (!parsed.success) {
      void reply.code(400);
      return {
        error: {
          code: 'VALIDATION_ERROR',
          message: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; '),
        },
      };
    }

    const input = parsed.data;

    // Real providers only: refuse to create a run unless every required role
    // for the selected mode has a real, configured, key-bearing provider.
    const pf = preflightRun(process.env, input);
    if (!pf.ok) {
      void reply.code(422);
      return {
        error: {
          code: 'PROVIDER_CONFIG_MISSING',
          message: `Required providers are not configured: ${pf.errors
            .map(e => `${e.role} → ${e.provider} (${e.reason})`)
            .join('; ')}`,
          details: pf.errors,
        },
      };
    }

    const researchBriefId = randomUUID();
    const brief = normalizeBrief(input, { researchBriefId, now: new Date() });
    // Fresh end-to-end run — mark provenance so its stats are never conflated
    // with replay/reuse benchmarks.
    brief.provenance = { ...FRESH_PROVENANCE };
    const assignments = resolveAssignments(process.env, input);
    const estimate = estimateRunCost(input.mode, assignments);
    const estimatedCostUsd = (estimate.lowUsd + estimate.highUsd) / 2;

    const run = await prisma.researchRun.create({
      data: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        researchBriefId,
        industry: brief.industry,
        geography: brief.geography || 'United States',
        mode: brief.mode,
        status: 'queued',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        brief: brief as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerAssignments: assignments as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        costEstimate: estimate as any,
        maxBudgetUsd: input.maxBudgetUsd,
        estimatedCostUsd,
        accruedCostUsd: 0,
        progress: [],
        stages: {
          create: planStages(input.mode).map(s => ({
            stageKey: s.stageKey,
            label: s.label,
            role: s.role,
            status: s.status,
          })),
        },
      },
      select: { id: true, createdAt: true },
    });

    await emitRunRequested(ctx.tenantId, run.id);

    return {
      data: {
        id: run.id,
        estimate,
        assignments,
        budgetWarning: estimate.highUsd > input.maxBudgetUsd,
      },
    };
  });

  // --- List runs ---
  fastify.get<{ Querystring: { limit?: string; status?: string } }>(
    '/api/v1/industry-research/runs',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const limit = Math.min(Number(request.query.limit) || 50, 200);
      const status = request.query.status;
      const runs = await prisma.researchRun.findMany({
        where: { tenantId: ctx.tenantId, ...(status ? { status } : {}) },
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: { reports: { select: { id: true } } },
      });
      return { data: runs.map(runToSummary) };
    }
  );

  // --- Run detail ---
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/industry-research/runs/:id',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const run = await prisma.researchRun.findFirst({
        where: { id: request.params.id, tenantId: ctx.tenantId },
        include: {
          stages: { orderBy: { createdAt: 'asc' } },
          reports: { select: { id: true }, orderBy: { version: 'desc' } },
        },
      });
      if (!run) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Run not found' } };
      }

      return {
        data: {
          ...runToSummary(run),
          brief: run.brief,
          providerAssignments: run.providerAssignments,
          costEstimate: run.costEstimate,
          plan: run.plan ?? null,
          progress: run.progress ?? [],
          insufficientEvidence: run.insufficientEvidence,
          stages: run.stages.map(s => ({ ...stageToInfo(s), output: s.output ?? null })),
        },
      };
    }
  );

  // --- Latest report (json/markdown) ---
  fastify.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/api/v1/industry-research/runs/:id/report',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const run = await prisma.researchRun.findFirst({
        where: { id: request.params.id, tenantId: ctx.tenantId },
        select: { id: true, brief: true },
      });
      if (!run) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Run not found' } };
      }

      const report = await prisma.researchReport.findFirst({
        where: { runId: request.params.id, tenantId: ctx.tenantId },
        orderBy: { version: 'desc' },
      });
      if (!report) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'No report yet' } };
      }

      const format = request.query.format;
      if (format === 'markdown') {
        return reply
          .header('Content-Type', 'text/markdown; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="research-${request.params.id}.md"`)
          .send(report.markdown);
      }
      if (format === 'json') {
        return reply
          .header('Content-Type', 'application/json; charset=utf-8')
          .header(
            'Content-Disposition',
            `attachment; filename="research-${request.params.id}.json"`
          )
          .send(JSON.stringify(report.structured, null, 2));
      }

      return {
        data: {
          version: report.version,
          verdict: report.verdict,
          overallScore: report.overallScore,
          markdown: report.markdown,
          structured: report.structured,
          evidence: report.evidence ?? [],
          sources: report.sources ?? [],
          verification: report.verification ?? null,
          synthesisProvider: report.synthesisProvider,
          synthesisModel: report.synthesisModel,
          provenance: provenanceOf(run),
          createdAt: report.createdAt.toISOString(),
        },
      };
    }
  );

  // --- Cancel ---
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/industry-research/runs/:id/cancel',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const run = await prisma.researchRun.findFirst({
        where: { id: request.params.id, tenantId: ctx.tenantId },
        select: { id: true, status: true },
      });
      if (!run) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Run not found' } };
      }
      if (['completed', 'failed', 'canceled'].includes(run.status)) {
        return { data: { status: run.status } };
      }
      await prisma.researchRun.update({
        where: { id: run.id },
        data: { status: 'canceled', finishedAt: new Date() },
      });
      await prisma.researchStage.updateMany({
        where: { runId: run.id, status: { in: ['pending', 'running'] } },
        data: { status: 'canceled' },
      });
      return { data: { status: 'canceled' } };
    }
  );

  // --- Rerun a failed stage (and everything downstream) ---
  fastify.post<{ Params: { id: string }; Body: { stageKey?: string } }>(
    '/api/v1/industry-research/runs/:id/rerun-stage',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const stageKey = request.body?.stageKey;
      if (!stageKey) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'stageKey is required' } };
      }
      const run = await prisma.researchRun.findFirst({
        where: { id: request.params.id, tenantId: ctx.tenantId },
        select: { id: true },
      });
      if (!run) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Run not found' } };
      }

      const order = STAGE_DEFINITIONS.map(d => d.key);
      const fromIdx = order.indexOf(stageKey as (typeof order)[number]);
      if (fromIdx < 0) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'Unknown stageKey' } };
      }
      const downstream = order.slice(fromIdx);
      // Only reset stages that are not skipped.
      await prisma.researchStage.updateMany({
        where: {
          runId: run.id,
          stageKey: { in: downstream },
          status: { not: 'skipped' },
        },
        data: { status: 'pending', error: null, startedAt: null, finishedAt: null },
      });
      await prisma.researchRun.update({
        where: { id: run.id },
        data: { status: 'queued', error: null, finishedAt: null },
      });
      await emitRunRequested(ctx.tenantId, run.id);
      return { data: { status: 'queued', rerunFrom: stageKey } };
    }
  );

  // --- Approve a higher budget cap (and resume a budget_exceeded run) ---
  fastify.post<{ Params: { id: string }; Body: { maxBudgetUsd?: number } }>(
    '/api/v1/industry-research/runs/:id/budget',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const next = Number(request.body?.maxBudgetUsd);
      if (!Number.isFinite(next) || next <= 0) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'maxBudgetUsd must be positive' } };
      }
      const run = await prisma.researchRun.findFirst({
        where: { id: request.params.id, tenantId: ctx.tenantId },
        select: { id: true, status: true, accruedCostUsd: true, maxBudgetUsd: true },
      });
      if (!run) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Run not found' } };
      }
      if (next <= run.accruedCostUsd) {
        void reply.code(400);
        return {
          error: {
            code: 'VALIDATION_ERROR',
            message: `New budget $${next.toFixed(2)} must exceed the $${run.accruedCostUsd.toFixed(2)} already spent`,
          },
        };
      }
      await prisma.researchRun.update({
        where: { id: run.id },
        data: { maxBudgetUsd: next },
      });
      // If the run stopped for budget, resume it from the publish stage so it can
      // finish the repair + publish under the newly-approved cap.
      let resumed = false;
      if (run.status === 'budget_exceeded') {
        await prisma.researchStage.updateMany({
          where: { runId: run.id, stageKey: 'publish' },
          data: { status: 'pending', error: null, startedAt: null, finishedAt: null },
        });
        await prisma.researchRun.update({
          where: { id: run.id },
          data: { status: 'queued', error: null, finishedAt: null },
        });
        await emitRunRequested(ctx.tenantId, run.id);
        resumed = true;
      }
      return { data: { maxBudgetUsd: next, resumed } };
    }
  );

  // --- Cost audit: honest breakdown by cost basis ---
  fastify.get<{ Params: { id: string } }>(
    '/api/v1/industry-research/runs/:id/costs',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const run = await prisma.researchRun.findFirst({
        where: { id: request.params.id, tenantId: ctx.tenantId },
        select: { id: true, maxBudgetUsd: true, accruedCostUsd: true, brief: true },
      });
      if (!run) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Run not found' } };
      }
      const stages = await prisma.researchStage.findMany({
        where: { runId: request.params.id },
        orderBy: { createdAt: 'asc' },
      });
      const r2 = (n: number) => Math.round(n * 100) / 100;
      const lines = stages
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map(s => ({ s, cd: (s.output as any)?.costDetails }))
        .filter(x => x.cd)
        .map(({ s, cd }) => ({
          stage: s.stageKey,
          provider: s.provider,
          model: s.model,
          costUsd: s.costUsd,
          costBasis: cd.basis as string,
          providerReportedCostUsd: cd.providerReportedCostUsd ?? null,
          calculatedCostUsd: cd.calculatedCostUsd ?? null,
          estimatedCostUsd: cd.estimatedCostUsd ?? null,
          costLowUsd: cd.costLowUsd,
          costHighUsd: cd.costHighUsd,
          pricingAsOf: cd.pricingAsOf,
          components: cd.components ?? null,
          cache: cd.cache ?? null,
        }));
      let confirmed = 0,
        calculated = 0,
        estLow = 0,
        estHigh = 0,
        low = 0,
        high = 0,
        reusedCount = 0,
        cacheSavingsUsd = 0;
      for (const c of lines) {
        if (c.costBasis === 'reused') {
          reusedCount += 1;
          continue; // reused stages contribute $0 new spend
        }
        if (c.costBasis === 'provider_reported') confirmed += c.costUsd;
        else if (String(c.costBasis).startsWith('calculated')) calculated += c.costUsd;
        else {
          estLow += c.costLowUsd;
          estHigh += c.costHighUsd;
        }
        low += c.costLowUsd;
        high += c.costHighUsd;
        if (c.cache?.cacheSavingsUsd) cacheSavingsUsd += c.cache.cacheSavingsUsd;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repairOutcome =
        (stages.find(s => s.stageKey === 'publish')?.output as any)?.repairOutcome ?? null;
      return {
        data: {
          runId: run.id,
          provenance: provenanceOf(run),
          confirmedCostUsd: r2(confirmed),
          calculatedCostUsd: r2(calculated),
          estimatedCostLowUsd: r2(estLow),
          estimatedCostHighUsd: r2(estHigh),
          totalLowUsd: r2(low),
          totalHighUsd: r2(high),
          reusedStageCount: reusedCount,
          cacheSavingsUsd: r2(cacheSavingsUsd),
          maxBudgetUsd: run.maxBudgetUsd,
          budgetRemainingUsd: r2(run.maxBudgetUsd - high),
          repairOutcome,
          stages: lines,
        },
      };
    }
  );

  // --- Replay: reuse completed research artifacts from a source run (no new
  //     research spend) to benchmark synthesis → verify → publish. ---
  fastify.post<{ Params: { id: string } }>(
    '/api/v1/industry-research/runs/:id/replay',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };

      const src = await prisma.researchRun.findFirst({
        where: { id: request.params.id, tenantId: ctx.tenantId },
        include: { stages: true },
      });
      if (!src) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Source run not found' } };
      }
      const reuseKeys = [
        'primary',
        'independent',
        'social',
        'evidence',
        'validation',
        'contradictions',
      ];
      const reused = src.stages.filter(
        s => reuseKeys.includes(s.stageKey) && (s.status === 'completed' || s.status === 'fallback')
      );
      const reusedSources = reused
        .filter(s => s.stageKey === 'evidence')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .reduce((n, s) => n + ((s.output as any)?.sources?.length ?? 0), 0);
      const researchStageKeys = ['primary', 'independent', 'social'];
      const avoidedProviderCalls = reused.filter(s =>
        researchStageKeys.includes(s.stageKey)
      ).length;
      // Reported/calculated research spend we did NOT incur by reusing artifacts.
      const avoidedEstimatedCost =
        Math.round(
          reused
            .filter(s => researchStageKeys.includes(s.stageKey))
            .reduce((sum, s) => sum + (s.costUsd ?? 0), 0) * 100
        ) / 100;

      const provenance: RunProvenance = {
        executionType: 'replay',
        reusedFromRunId: src.id,
        reusedResearch: true,
        reusedSourceCount: reusedSources,
        avoidedProviderCalls,
        avoidedEstimatedCost,
      };
      const replayBrief = {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(src.brief as any),
        provenance,
        // Legacy flat fields kept for backward compatibility.
        reusedFromRunId: src.id,
        reusedResearchStages: true,
        reusedSourceCount: reusedSources,
      };

      const newRun = await prisma.researchRun.create({
        data: {
          tenantId: ctx.tenantId,
          userId: ctx.userId,
          researchBriefId: src.researchBriefId,
          industry: src.industry,
          geography: src.geography,
          mode: src.mode,
          status: 'queued',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          brief: replayBrief as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          providerAssignments: src.providerAssignments as any,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          costEstimate: src.costEstimate as any,
          maxBudgetUsd: src.maxBudgetUsd,
          estimatedCostUsd: 0,
          accruedCostUsd: 0,
          progress: [],
          stages: {
            create: planStages(src.mode as keyof typeof RESEARCH_MODES).map(s => ({
              stageKey: s.stageKey,
              label: s.label,
              role: s.role,
              status: s.status,
            })),
          },
        },
        select: { id: true },
      });

      // Copy the completed research outputs into the replay run at $0 (reused).
      for (const s of reused) {
        // Overwrite the reused stage's costDetails with a $0 "reused" basis so the
        // replay's cost audit honestly attributes zero new spend to research (the
        // original paid cost lives on the source run, not this benchmark).
        const reusedOutput =
          s.output && typeof s.output === 'object'
            ? {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ...(s.output as any),
                costDetails: {
                  usd: 0,
                  basis: 'reused',
                  costLowUsd: 0,
                  costHighUsd: 0,
                  pricingAsOf: PRICING_AS_OF,
                },
              }
            : s.output;
        await prisma.researchStage.updateMany({
          where: { runId: newRun.id, stageKey: s.stageKey },
          data: {
            // Force 'completed' so the worker unconditionally skips it (it only
            // skips completed/skipped, not 'fallback') — guaranteeing the paid
            // research is never re-run. Provenance is kept in usedFallback.
            status: 'completed',
            provider: s.provider,
            model: s.model,
            sourcesFound: s.sourcesFound,
            costUsd: 0,
            usedFallback: s.usedFallback,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            output: (reusedOutput ?? undefined) as any,
            finishedAt: new Date(),
          },
        });
      }

      await emitRunRequested(ctx.tenantId, newRun.id);
      return {
        data: {
          id: newRun.id,
          executionType: 'replay',
          reusedFromRunId: src.id,
          reusedResearchStages: reused.map(s => s.stageKey),
          reusedSourceCount: reusedSources,
          avoidedProviderCalls,
          avoidedEstimatedCost,
        },
      };
    }
  );

  // --- Team profiles ---
  fastify.get('/api/v1/industry-research/team-profiles', async (request, reply) => {
    if (!featureEnabled()) {
      void reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
    }
    const ctx = await requireAdmin(request, reply);
    if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };
    const profiles = await prisma.researchTeamProfile.findMany({
      where: { tenantId: ctx.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return {
      data: profiles.map(p => ({
        id: p.id,
        name: p.name,
        capabilities: p.capabilities,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  });

  fastify.post<{ Body: { name?: string; capabilities?: string[] } }>(
    '/api/v1/industry-research/team-profiles',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };
      const name = (request.body?.name ?? '').trim();
      const capabilities = Array.isArray(request.body?.capabilities)
        ? request.body!.capabilities
        : [];
      if (!name) {
        void reply.code(400);
        return { error: { code: 'VALIDATION_ERROR', message: 'name is required' } };
      }
      const p = await prisma.researchTeamProfile.create({
        data: { tenantId: ctx.tenantId, userId: ctx.userId, name, capabilities },
        select: { id: true, name: true, capabilities: true, createdAt: true },
      });
      return { data: { ...p, createdAt: p.createdAt.toISOString() } };
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/api/v1/industry-research/team-profiles/:id',
    async (request, reply) => {
      if (!featureEnabled()) {
        void reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Feature not enabled' } };
      }
      const ctx = await requireAdmin(request, reply);
      if (!ctx) return { error: { code: 'FORBIDDEN', message: 'Admin access required' } };
      await prisma.researchTeamProfile.deleteMany({
        where: { id: request.params.id, tenantId: ctx.tenantId },
      });
      return { data: { deleted: true } };
    }
  );
}
