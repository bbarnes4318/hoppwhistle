import { PrismaClient, Prisma } from '@prisma/client';
import {
  RESEARCH_MODES,
  STAGE_DEFINITIONS,
  buildProviderRegistry,
  buildResearchPlan,
  canonicalizeUrl,
  computeActualCost,
  computeStageCost,
  estimateRunCost,
  geminiAdjudicatorModel,
  geminiPrimaryConfig,
  isValidHttpUrl,
  perplexityResearchConfig,
  perplexityVerifierModel,
  preflightRun,
  roleFallbacks,
  xaiVerifierModel,
  type AdjudicationResult,
  type AdversarialVerification,
  type AsyncJobRef,
  type CanonicalBrief,
  type Claim,
  type EvidenceSource,
  type FactualVerification,
  type ProgressEvent,
  type ProviderAssignments,
  type ProviderId,
  type ProviderReport,
  type ProviderRole,
  type ResearchMode,
  type StageKey,
  type StructuredReport,
} from '@hopwhistle/shared';

import { logger } from '../../lib/logger.js';

import { ProviderError, RealAdapter, renderMarkdown, type RoleRunOptions } from './providers.js';

const PROGRESS_CAP = 200;
const POLL_INTERVAL_MS = 15_000;

/** Sentinel to unwind the phased pipeline for cancellation / budget stops. */
class PhaseSignal extends Error {
  constructor(public readonly kind: 'canceled' | 'budget_exceeded') {
    super(kind);
  }
}

export class ResearchOrchestrator {
  constructor(private prisma: PrismaClient) {}

  async processRun(runId: string): Promise<void> {
    const run = await this.prisma.researchRun.findUnique({
      where: { id: runId },
      include: { stages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) return logger.warn({ msg: 'Research run not found', runId });
    if (run.status === 'canceled') return logger.info({ msg: 'Run canceled; skipping', runId });

    const brief = run.brief as unknown as CanonicalBrief;
    const assignments = run.providerAssignments as unknown as ProviderAssignments;
    const mode = brief.mode;
    const estimate = estimateRunCost(mode, assignments);
    const roleEstimate = new Map<ProviderRole, number>();
    for (const line of estimate.byLine) roleEstimate.set(line.role, line.estimatedUsd);

    const pf = preflightRun(process.env, brief);
    if (!pf.ok) {
      await this.failRun(
        runId,
        `Missing provider configuration: ${pf.errors.map(e => `${e.role}→${e.provider} (${e.reason})`).join('; ')}`
      );
      return;
    }

    await this.prisma.researchRun.update({
      where: { id: runId },
      data: { status: 'running', startedAt: run.startedAt ?? new Date() },
    });

    // Run a single stage only if it is still pending (resume-safe), after a
    // cancellation + hard-budget check. Throws sentinel errors to unwind phases.
    const runStageIfPending = async (key: StageKey): Promise<void> => {
      const st = await this.prisma.researchStage.findFirst({
        where: { runId, stageKey: key },
        select: { id: true, status: true },
      });
      if (!st || st.status === 'completed' || st.status === 'skipped') return;

      const fresh = await this.prisma.researchRun.findUnique({
        where: { id: runId },
        select: { status: true, accruedCostUsd: true },
      });
      if (fresh?.status === 'canceled') throw new PhaseSignal('canceled');

      const def = STAGE_DEFINITIONS.find(d => d.key === key)!;
      const role = def.role as ProviderRole | undefined;
      if (role && run.maxBudgetUsd > 0) {
        const projected = roleEstimate.get(role) ?? 0;
        if ((fresh?.accruedCostUsd ?? 0) + projected > run.maxBudgetUsd) {
          await this.markStage(st.id, {
            status: 'failed',
            error: `Hard budget cap reached ($${(fresh?.accruedCostUsd ?? 0).toFixed(2)}/$${run.maxBudgetUsd})`,
            finishedAt: new Date(),
          });
          throw new PhaseSignal('budget_exceeded');
        }
      }
      await this.runStage(runId, key, brief, assignments, roleEstimate, mode);
    };

    try {
      // Phase 1 — normalize + plan (fast, deterministic, sequential)
      for (const key of ['normalize', 'plan'] as StageKey[]) await runStageIfPending(key);

      // Phase 2 — RESEARCH FAN-OUT: Gemini + Perplexity + xAI concurrently.
      await this.runConcurrent(['primary', 'independent', 'social'], runStageIfPending);

      // Phase 3 — evidence fan-in (deterministic, sequential)
      for (const key of ['evidence', 'validation', 'contradictions'] as StageKey[])
        await runStageIfPending(key);

      // Phase 4 — synthesis
      await runStageIfPending('synthesis');

      // Phase 5 — VERIFIER FAN-OUT: Perplexity factual + xAI adversarial concurrently
      // (neither sees the other's result before both finish — independence preserved).
      await this.runConcurrent(['verify_factual', 'verify_adversarial'], runStageIfPending);

      // Phase 6 — conditional Gemini adjudication (runStage decides if it is needed)
      await runStageIfPending('adjudicate');

      // Phase 7 — deterministic validation + publish/repair/reject
      await this.publish(runId, brief, assignments, roleEstimate, mode);
    } catch (err) {
      if (err instanceof PhaseSignal) {
        if (err.kind === 'canceled') return logger.info({ msg: 'Run canceled mid-pipeline', runId });
        await this.prisma.researchRun.update({
          where: { id: runId },
          data: { status: 'budget_exceeded', finishedAt: new Date() },
        });
        return;
      }
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ msg: 'Research run failed', runId, error: message });
      await this.prisma.researchRun.update({
        where: { id: runId },
        data: { status: 'failed', error: message, finishedAt: new Date() },
      });
    }
  }

  /** Run several stages concurrently (fan-out). A stage failure fails the run. */
  private async runConcurrent(
    keys: StageKey[],
    runStageIfPending: (key: StageKey) => Promise<void>
  ): Promise<void> {
    const results = await Promise.allSettled(keys.map(k => runStageIfPending(k)));
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (rejected) throw rejected.reason;
  }

  // -----------------------------------------------------------------------

  private async runStage(
    runId: string,
    key: StageKey,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    roleEstimate: Map<ProviderRole, number>,
    mode: ResearchMode
  ): Promise<void> {
    const stage = await this.prisma.researchStage.findFirst({ where: { runId, stageKey: key } });
    if (!stage) return;
    const def = STAGE_DEFINITIONS.find(d => d.key === key)!;
    const role = def.role as ProviderRole | undefined;
    // Preserve any persisted async job on the stage before marking running (restart recovery).
    const persisted = stage.output as { job?: AsyncJobRef } | null;
    if (stage.status !== 'running')
      await this.markStage(stage.id, { status: 'running', startedAt: new Date() });

    try {
      switch (key) {
        case 'normalize':
          await this.markStage(stage.id, { status: 'completed', finishedAt: new Date() });
          break;
        case 'plan': {
          const plan = buildResearchPlan(brief);
          await this.prisma.researchRun.update({
            where: { id: runId },
            data: { plan: plan as unknown as Prisma.InputJsonValue },
          });
          await this.markStage(stage.id, {
            status: 'completed',
            finishedAt: new Date(),
            output: plan as unknown as Prisma.InputJsonValue,
          });
          break;
        }
        case 'primary':
        case 'independent':
        case 'social': {
          const { report, usedFallback } = await this.runResearchRole(
            runId,
            stage.id,
            role!,
            brief,
            assignments,
            mode,
            persisted?.job
          );
          // Quality gate for the social (xAI web+X) stage in full/forensic modes.
          if (key === 'social' && mode !== 'rapid_scan') {
            const tu = (
              report as ProviderReport & {
                toolUsage?: { webSearchCalls: number; xSearchCalls: number };
              }
            ).toolUsage;
            if (!tu || tu.webSearchCalls < 1 || tu.xSearchCalls < 1 || report.sources.length < 1) {
              throw new ProviderError(
                `Operator-intelligence quality gate failed (web=${tu?.webSearchCalls ?? 0}, x=${tu?.xSearchCalls ?? 0}, citations=${report.sources.length}). Web AND X search with citations are required.`,
                report.provider
              );
            }
          }
          const cost =
            computeStageCost(report.provider, report.usage, roleEstimate.get(role!) ?? 0).usd;
          await this.markStage(stage.id, {
            status: usedFallback ? 'fallback' : 'completed',
            finishedAt: new Date(),
            provider: report.provider,
            model: report.model,
            sourcesFound: report.sources.length,
            costUsd: cost,
            usedFallback,
            output: report as unknown as Prisma.InputJsonValue,
          });
          await this.addCost(runId, cost);
          break;
        }
        case 'evidence': {
          const { claims, sources } = await this.aggregateEvidence(runId);
          await this.markStage(stage.id, {
            status: 'completed',
            finishedAt: new Date(),
            sourcesFound: sources.length,
            output: { claims, sources } as unknown as Prisma.InputJsonValue,
          });
          break;
        }
        case 'validation': {
          const { sources } = await this.loadEvidence(runId);
          let flagged = 0;
          const validated = sources.map(s => {
            const ok = isValidHttpUrl(s.url);
            if (!ok) flagged += 1;
            return {
              ...s,
              validated: ok,
              validationNote: ok ? 'URL syntactically valid' : 'Invalid URL',
              accessedDate: new Date().toISOString(),
            } as EvidenceSource;
          });
          await this.markStage(stage.id, {
            status: 'completed',
            finishedAt: new Date(),
            sourcesFound: validated.length,
            output: {
              validatedCount: validated.length - flagged,
              flagged,
              sources: validated,
            } as unknown as Prisma.InputJsonValue,
          });
          break;
        }
        case 'contradictions': {
          const { sources } = await this.loadEvidence(runId);
          const reports = await this.loadProviderReports(runId);
          const note = `Prepared ${reports.length} provider report(s) and ${sources.length} deduped source(s) for adjudication.`;
          await this.markStage(stage.id, {
            status: 'completed',
            finishedAt: new Date(),
            output: { contradictionsNote: note } as unknown as Prisma.InputJsonValue,
          });
          break;
        }
        case 'synthesis':
          await this.runSynthesisStage(runId, stage.id, brief, assignments, roleEstimate, mode);
          break;
        case 'verify_factual':
          await this.runFactualStage(runId, stage.id, brief, assignments, roleEstimate, mode);
          break;
        case 'verify_adversarial':
          await this.runAdversarialStage(runId, stage.id, brief, assignments, roleEstimate);
          break;
        case 'adjudicate':
          await this.runAdjudicationStage(runId, stage.id, brief, assignments, roleEstimate, mode);
          break;
        case 'publish':
          break; // handled in publish()
        default:
          await this.markStage(stage.id, { status: 'completed', finishedAt: new Date() });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      logger.error({ msg: 'Stage failed', runId, stage: key, error: message });
      await this.markStage(stage.id, { status: 'failed', finishedAt: new Date(), error: message });
      await this.appendProgress(runId, key, `Stage failed: ${message.slice(0, 160)}`);
      throw err;
    }
  }

  // ----- Research roles (sync + async with restart recovery) -------------

  private async runResearchRole(
    runId: string,
    stageId: string,
    role: ProviderRole,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    mode: ResearchMode,
    persistedJob?: AsyncJobRef
  ): Promise<{ report: ProviderReport; usedFallback: boolean }> {
    const primary = assignments[role];

    // Restart recovery: resume an already-submitted async job instead of resubmitting.
    if (
      persistedJob?.jobId &&
      (persistedJob.status === 'submitted' || persistedJob.status === 'in_progress')
    ) {
      const { adapter } = this.makeAdapter(persistedJob.provider, role, mode);
      await this.appendProgress(
        runId,
        role as StageKey,
        `Resuming ${persistedJob.provider} job ${persistedJob.jobId.slice(0, 8)}… after restart`
      );
      const report = await this.pollToCompletion(runId, stageId, role, adapter, persistedJob);
      return { report, usedFallback: persistedJob.provider !== primary };
    }

    const chain: ProviderId[] = [primary, ...roleFallbacks(process.env, role, primary)];
    let lastErr: unknown;
    for (let i = 0; i < chain.length; i++) {
      const providerId = chain[i];
      try {
        const { adapter, opts, async: isAsync } = this.makeAdapter(providerId, role, mode);
        if (isAsync) {
          await this.appendProgress(
            runId,
            role as StageKey,
            `Submitting ${providerId} background job (${opts.agent ?? opts.model})`
          );
          const idempotencyKey = `${runId}:${role}`;
          const submit = await adapter.submitAsyncRole(role, brief, { ...opts, idempotencyKey });
          const job: AsyncJobRef = {
            provider: providerId,
            jobId: submit.jobId,
            agentOrModel: submit.agentOrModel,
            status: 'in_progress',
            submittedAt: new Date().toISOString(),
            idempotencyKey,
          };
          await this.markStage(stageId, {
            provider: providerId,
            model: opts.model,
            output: { job } as unknown as Prisma.InputJsonValue,
          });
          const report = await this.pollToCompletion(runId, stageId, role, adapter, job);
          return { report, usedFallback: i > 0 };
        }
        await this.appendProgress(
          runId,
          role as StageKey,
          `Provider request submitted (${providerId}/${opts.model})`
        );
        const report = await adapter.runSyncRole(role, brief, opts);
        await this.appendProgress(
          runId,
          role as StageKey,
          `Provider response received (${report.sources.length} sources)`
        );
        return { report, usedFallback: i > 0 };
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn({
          msg: 'Provider role attempt failed',
          role,
          provider: providerId,
          error: msg,
        });
        await this.appendProgress(
          runId,
          role as StageKey,
          `Provider ${providerId} failed: ${msg.slice(0, 140)}`
        );
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new ProviderError('All providers failed for role', primary);
  }

  private async pollToCompletion(
    runId: string,
    stageId: string,
    role: ProviderRole,
    adapter: RealAdapter,
    job: AsyncJobRef
  ): Promise<ProviderReport> {
    const deadline = Date.now() + 25 * 60 * 1000;
    for (;;) {
      const canceled = await this.prisma.researchRun.findUnique({
        where: { id: runId },
        select: { status: true },
      });
      if (canceled?.status === 'canceled')
        throw new ProviderError('Run canceled during polling', job.provider);
      const poll = await adapter.pollAsyncRole(job.jobId);
      job.lastPolledAt = new Date().toISOString();
      if (poll.status === 'completed' && poll.report) {
        job.status = 'completed';
        job.completedAt = new Date().toISOString();
        await this.markStage(stageId, {
          output: {
            job,
            ...(poll.report as unknown as Record<string, unknown>),
          } as unknown as Prisma.InputJsonValue,
        });
        await this.appendProgress(
          runId,
          role as StageKey,
          `${job.provider} job completed (${poll.report.sources.length} sources)`
        );
        return poll.report;
      }
      if (poll.status === 'failed' || poll.status === 'cancelled')
        throw new ProviderError(
          `${job.provider} job ${poll.status}: ${poll.error ?? ''}`,
          job.provider
        );
      if (Date.now() > deadline)
        throw new ProviderError(`${job.provider} job polling timed out`, job.provider);
      await this.markStage(stageId, { output: { job } as unknown as Prisma.InputJsonValue });
      await this.appendProgress(
        runId,
        role as StageKey,
        `Waiting for ${job.provider}… (${job.jobId.slice(0, 8)})`
      );
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // ----- Synthesis + verification stages ---------------------------------

  private async runSynthesisStage(
    runId: string,
    stageId: string,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    roleEstimate: Map<ProviderRole, number>,
    mode: ResearchMode
  ): Promise<void> {
    const evidence = await this.loadEvidence(runId);
    const plan = await this.stageOutput(runId, 'plan');
    const contra = (await this.stageOutput(runId, 'contradictions')) as {
      contradictionsNote?: string;
    } | null;
    const reports = await this.loadProviderReports(runId);
    if (reports.length === 0)
      throw new ProviderError(
        'No completed provider research to synthesize',
        assignments.synthesis
      );
    const { adapter, opts } = this.makeAdapter(assignments.synthesis, 'synthesis', mode);
    await this.appendProgress(
      runId,
      'synthesis',
      `Synthesis submitted (${adapter.id}/${opts.model})`
    );
    const result = await adapter.runSynthesis(
      {
        brief,
        runId,
        plan,
        reports,
        claims: evidence.claims,
        sources: evidence.sources,
        contradictionsNote: contra?.contradictionsNote ?? '',
      },
      opts
    );
    await this.appendProgress(runId, 'synthesis', 'Synthesis response received');
    const structured: StructuredReport = {
      ...result.structured,
      sources: mergeSources(evidence.sources, result.structured.sources),
    };
    const cost =
      computeStageCost(result.provider, result.usage, roleEstimate.get('synthesis') ?? 0).usd;
    await this.addCost(runId, cost);
    await this.markStage(stageId, {
      status: 'completed',
      finishedAt: new Date(),
      provider: result.provider,
      model: result.model,
      costUsd: cost,
      output: {
        structured,
        markdown: result.markdown,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
        requestId: result.requestId,
      } as unknown as Prisma.InputJsonValue,
    });
  }

  private async runFactualStage(
    runId: string,
    stageId: string,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    roleEstimate: Map<ProviderRole, number>,
    mode: ResearchMode
  ): Promise<void> {
    const structured = await this.currentDraft(runId);
    if (!structured)
      throw new ProviderError('No synthesized report to verify', assignments.factual_verifier);
    const { adapter, opts } = this.makeAdapter(
      assignments.factual_verifier,
      'factual_verifier',
      mode
    );
    await this.appendProgress(
      runId,
      'verify_factual',
      `Factual verification submitted (${adapter.id}/${opts.model})`
    );
    const v = await adapter.runFactualVerification(brief, structured, opts);
    const cost =
      computeStageCost(v.provider, v.usage, roleEstimate.get('factual_verifier') ?? 0).usd;
    await this.addCost(runId, cost);
    await this.markStage(stageId, {
      status: 'completed',
      finishedAt: new Date(),
      provider: v.provider,
      model: v.model,
      costUsd: cost,
      output: v.result as unknown as Prisma.InputJsonValue,
    });
    await this.appendProgress(
      runId,
      'verify_factual',
      `Factual verdict: ${v.result.verdict} (${v.result.claimsChecked} claims checked)`
    );
  }

  private async runAdversarialStage(
    runId: string,
    stageId: string,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    roleEstimate: Map<ProviderRole, number>
  ): Promise<void> {
    const structured = await this.currentDraft(runId);
    if (!structured)
      throw new ProviderError('No synthesized report to verify', assignments.adversarial_verifier);
    const { adapter, opts } = this.makeAdapter(
      assignments.adversarial_verifier,
      'adversarial_verifier',
      'full_due_diligence'
    );
    await this.appendProgress(
      runId,
      'verify_adversarial',
      `Adversarial verification submitted (${adapter.id}/${opts.model})`
    );
    const v = await adapter.runAdversarialVerification(brief, structured, opts);
    if (!v.result.webSearchUsed || !v.result.xSearchUsed) {
      throw new ProviderError(
        `Adversarial verification quality gate failed (web=${v.toolUsage.webSearchCalls}, x=${v.toolUsage.xSearchCalls}). Web AND X search required.`,
        v.provider
      );
    }
    const cost =
      computeStageCost(v.provider, v.usage, roleEstimate.get('adversarial_verifier') ?? 0).usd;
    await this.addCost(runId, cost);
    await this.markStage(stageId, {
      status: 'completed',
      finishedAt: new Date(),
      provider: v.provider,
      model: v.model,
      costUsd: cost,
      output: v.result as unknown as Prisma.InputJsonValue,
    });
    await this.appendProgress(
      runId,
      'verify_adversarial',
      `Adversarial verdict: ${v.result.verdict}`
    );
  }

  private async runAdjudicationStage(
    runId: string,
    stageId: string,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    roleEstimate: Map<ProviderRole, number>,
    mode: ResearchMode
  ): Promise<void> {
    const factual = (await this.stageOutput(runId, 'verify_factual')) as FactualVerification | null;
    const adversarial = (await this.stageOutput(
      runId,
      'verify_adversarial'
    )) as AdversarialVerification | null;
    const needed = adjudicationNeeded(factual, adversarial, mode);
    if (!needed) {
      await this.markStage(stageId, {
        status: 'skipped',
        finishedAt: new Date(),
        error: 'Not required (verifiers agree, no blocking defects)',
      });
      await this.appendProgress(runId, 'adjudicate', 'Adjudication not required');
      return;
    }
    const structured = await this.currentDraft(runId);
    const disputes = {
      factual: factual
        ? {
            verdict: factual.verdict,
            unsupportedClaims: factual.unsupportedClaims,
            blockingDefects: factual.blockingDefects,
            requiredRepairs: factual.requiredRepairs,
          }
        : null,
      adversarial: adversarial
        ? {
            verdict: adversarial.verdict,
            missingRisks: adversarial.missingRisks,
            blockingDefects: adversarial.blockingDefects,
            requiredRepairs: adversarial.requiredRepairs,
          }
        : null,
      verdict: structured?.executiveVerdict,
      sections: structured?.sections.map(s => ({
        title: s.title,
        markdown: s.markdown.slice(0, 800),
      })),
    };
    const { adapter, opts } = this.makeAdapter(assignments.adjudicator, 'adjudicator', mode);
    await this.appendProgress(
      runId,
      'adjudicate',
      `Adjudication submitted (${adapter.id}/${opts.model})`
    );
    const a = await adapter.runAdjudication(brief, disputes, opts);
    const cost = computeStageCost(a.provider, a.usage, roleEstimate.get('adjudicator') ?? 0).usd;
    await this.addCost(runId, cost);
    await this.markStage(stageId, {
      status: 'completed',
      finishedAt: new Date(),
      provider: a.provider,
      model: a.model,
      costUsd: cost,
      output: a.result as unknown as Prisma.InputJsonValue,
    });
    await this.appendProgress(runId, 'adjudicate', `Adjudication verdict: ${a.result.verdict}`);
  }

  // ----- Publish: deterministic validation + gating + bounded repair -----

  private async publish(
    runId: string,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    roleEstimate: Map<ProviderRole, number>,
    mode: ResearchMode
  ): Promise<void> {
    const publishStage = await this.prisma.researchStage.findFirst({
      where: { runId, stageKey: 'publish' },
    });
    if (publishStage)
      await this.markStage(publishStage.id, { status: 'running', startedAt: new Date() });

    let structured = await this.currentDraft(runId);
    if (!structured) throw new ProviderError('Cannot publish: no synthesized report', 'anthropic');

    let factual = (await this.stageOutput(runId, 'verify_factual')) as FactualVerification | null;
    let adversarial = (await this.stageOutput(
      runId,
      'verify_adversarial'
    )) as AdversarialVerification | null;
    const adjudication = (await this.stageOutput(runId, 'adjudicate')) as AdjudicationResult | null;

    let decision = gate(factual, adversarial, adjudication);

    // Bounded single repair cycle when repair is required (and not an outright reject).
    if (decision === 'repair_required') {
      await this.appendProgress(
        runId,
        'publish',
        'Repair required — running one bounded repair cycle'
      );
      const repairs = [
        ...(factual?.requiredRepairs ?? []),
        ...(adversarial?.requiredRepairs ?? []),
        ...(adjudication?.requiredRepairs ?? []),
      ];
      structured = await this.repairReport(
        runId,
        brief,
        assignments,
        structured,
        repairs,
        roleEstimate,
        mode
      );
      // Re-run both independent verifiers once against the repaired report.
      const fa = await this.reverify(runId, brief, assignments, structured, roleEstimate, mode);
      factual = fa.factual;
      adversarial = fa.adversarial;
      decision = gate(factual, adversarial, adjudication);
    }

    // Deterministic validation gate.
    const deterministic = deterministicValidation(structured, brief);
    if (!deterministic.ok) {
      await this.rejectRun(
        runId,
        `Deterministic validation failed: ${deterministic.errors.join('; ')}`
      );
      return;
    }
    if (decision === 'reject' || decision === 'repair_required') {
      await this.rejectRun(
        runId,
        `Verification ${decision}: factual=${factual?.verdict}, adversarial=${adversarial?.verdict}${adjudication ? `, adjudication=${adjudication.verdict}` : ''}`
      );
      return;
    }

    const synth = (await this.stageOutput(runId, 'synthesis')) as {
      markdown?: string;
      provider?: ProviderId;
      model?: string;
    } | null;
    const evidence = await this.loadEvidence(runId);
    const insufficient =
      structured.sources.length < Math.max(3, Math.floor(brief.sourceTargets.totalSources * 0.2));
    const tenantId = (await this.tenantId(runId)) ?? '';
    const version = await this.nextVersion(runId);

    await this.prisma.researchReport.create({
      data: {
        runId,
        tenantId,
        version,
        verdict: structured.executiveVerdict.verdict,
        overallScore: Math.round(structured.executiveVerdict.overallScore),
        markdown: synth?.markdown ?? renderMarkdown(structured),
        structured: structured as unknown as Prisma.InputJsonValue,
        evidence: structured.evidenceLedger as unknown as Prisma.InputJsonValue,
        sources: structured.sources as unknown as Prisma.InputJsonValue,
        verification: { factual, adversarial, adjudication } as unknown as Prisma.InputJsonValue,
        synthesisProvider: synth?.provider ?? 'anthropic',
        synthesisModel: synth?.model ?? null,
      },
    });
    if (publishStage)
      await this.markStage(publishStage.id, { status: 'completed', finishedAt: new Date() });
    await this.prisma.researchRun.update({
      where: { id: runId },
      data: {
        status: 'completed',
        finishedAt: new Date(),
        verdict: structured.executiveVerdict.verdict,
        overallScore: Math.round(structured.executiveVerdict.overallScore),
        insufficientEvidence: insufficient || evidence.sources.length === 0,
      },
    });
    await this.appendProgress(runId, 'publish', 'Report published after independent verification');
  }

  private async repairReport(
    runId: string,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    structured: StructuredReport,
    repairs: string[],
    roleEstimate: Map<ProviderRole, number>,
    mode: ResearchMode
  ): Promise<StructuredReport> {
    const evidence = await this.loadEvidence(runId);
    const reports = await this.loadProviderReports(runId);
    const { adapter, opts } = this.makeAdapter(assignments.synthesis, 'synthesis', mode);
    const note = `Independent verifiers required these repairs (fix ONLY these, keep everything else): ${repairs.slice(0, 20).join(' | ')}`;
    const result = await adapter.runSynthesis(
      {
        brief,
        runId,
        plan: null,
        reports,
        claims: evidence.claims,
        sources: evidence.sources,
        contradictionsNote: note,
      },
      opts
    );
    const cost =
      computeStageCost(result.provider, result.usage, roleEstimate.get('synthesis') ?? 0).usd;
    await this.addCost(runId, cost);
    const repaired = {
      ...result.structured,
      sources: mergeSources(evidence.sources, result.structured.sources),
    };
    // Persist the repaired draft as a new synthesis output revision.
    const synthStage = await this.prisma.researchStage.findFirst({
      where: { runId, stageKey: 'synthesis' },
    });
    if (synthStage)
      await this.markStage(synthStage.id, {
        output: {
          structured: repaired,
          markdown: renderMarkdown(repaired),
          provider: result.provider,
          model: result.model,
          usage: result.usage,
          repaired: true,
        } as unknown as Prisma.InputJsonValue,
      });
    return repaired;
  }

  private async reverify(
    runId: string,
    brief: CanonicalBrief,
    assignments: ProviderAssignments,
    structured: StructuredReport,
    roleEstimate: Map<ProviderRole, number>,
    mode: ResearchMode
  ): Promise<{ factual: FactualVerification; adversarial: AdversarialVerification }> {
    const f = this.makeAdapter(assignments.factual_verifier, 'factual_verifier', mode);
    const a = this.makeAdapter(
      assignments.adversarial_verifier,
      'adversarial_verifier',
      'full_due_diligence'
    );
    const fr = await f.adapter.runFactualVerification(brief, structured, f.opts);
    const ar = await a.adapter.runAdversarialVerification(brief, structured, a.opts);
    await this.addCost(
      runId,
      (computeActualCost(fr.provider, fr.usage) ?? 0) +
        (computeActualCost(ar.provider, ar.usage) ?? 0)
    );
    // Update the verifier stage outputs to reflect re-verification.
    const fs = await this.prisma.researchStage.findFirst({
      where: { runId, stageKey: 'verify_factual' },
    });
    const as = await this.prisma.researchStage.findFirst({
      where: { runId, stageKey: 'verify_adversarial' },
    });
    if (fs) await this.markStage(fs.id, { output: fr.result as unknown as Prisma.InputJsonValue });
    if (as) await this.markStage(as.id, { output: ar.result as unknown as Prisma.InputJsonValue });
    return { factual: fr.result, adversarial: ar.result };
  }

  private async rejectRun(runId: string, reason: string): Promise<void> {
    await this.prisma.researchRun.update({
      where: { id: runId },
      data: { status: 'failed', error: `VERIFICATION_REJECTED: ${reason}`, finishedAt: new Date() },
    });
    const publishStage = await this.prisma.researchStage.findFirst({
      where: { runId, stageKey: 'publish' },
    });
    if (publishStage)
      await this.markStage(publishStage.id, {
        status: 'failed',
        finishedAt: new Date(),
        error: reason,
      });
    await this.appendProgress(runId, 'publish', `Not published — ${reason.slice(0, 160)}`);
  }

  // ----- Adapter + model selection ---------------------------------------

  private makeAdapter(
    providerId: ProviderId,
    role: ProviderRole,
    mode: ResearchMode
  ): { adapter: RealAdapter; opts: RoleRunOptions; async: boolean } {
    const cfg = buildProviderRegistry(process.env).find(c => c.id === providerId);
    if (!cfg)
      throw new ProviderError(
        `Provider ${providerId} is not configured`,
        providerId,
        undefined,
        true
      );
    const key = process.env[cfg.apiKeyEnv];
    if (!key)
      throw new ProviderError(`${cfg.label} is missing its API key`, providerId, undefined, true);

    let model = cfg.model;
    let agent: string | undefined;
    let isAsync = false;

    if (role === 'primary' && providerId === 'google') {
      const g = geminiPrimaryConfig(process.env, mode);
      model = g.model;
      if (g.mode === 'deep_research') {
        isAsync = true;
        agent = g.model;
      }
    } else if (role === 'independent' && providerId === 'perplexity') {
      const p = perplexityResearchConfig(process.env, mode);
      model = p.model;
      isAsync = p.async;
    } else if (role === 'factual_verifier' && providerId === 'perplexity') {
      model = perplexityVerifierModel(process.env, mode);
    } else if (role === 'adversarial_verifier' && providerId === 'xai') {
      model = xaiVerifierModel(process.env);
    } else if (role === 'adjudicator' && providerId === 'google') {
      model = geminiAdjudicatorModel(process.env);
    }

    return {
      adapter: new RealAdapter(providerId, key),
      opts: { model, timeoutMs: cfg.timeoutMs, maxRetries: cfg.maxRetries, agent },
      async: isAsync,
    };
  }

  // ----- Evidence + small helpers ----------------------------------------

  private async currentDraft(runId: string): Promise<StructuredReport | null> {
    const synth = (await this.stageOutput(runId, 'synthesis')) as {
      structured?: StructuredReport;
    } | null;
    return synth?.structured ?? null;
  }

  private async aggregateEvidence(
    runId: string
  ): Promise<{ claims: Claim[]; sources: EvidenceSource[] }> {
    const reports = await this.loadProviderReports(runId);
    const byUrl = new Map<string, EvidenceSource>();
    const claims: Claim[] = [];
    for (const r of reports) {
      for (const s of r.sources) {
        const norm = s.normalizedUrl || canonicalizeUrl(s.url);
        if (!byUrl.has(norm)) byUrl.set(norm, { ...s, normalizedUrl: norm });
      }
      for (const c of r.claims) claims.push(c);
    }
    return { claims, sources: Array.from(byUrl.values()) };
  }

  private async loadEvidence(
    runId: string
  ): Promise<{ claims: Claim[]; sources: EvidenceSource[] }> {
    const validation = (await this.stageOutput(runId, 'validation')) as {
      sources?: EvidenceSource[];
    } | null;
    const evidence = (await this.stageOutput(runId, 'evidence')) as {
      claims?: Claim[];
      sources?: EvidenceSource[];
    } | null;
    if (evidence?.claims)
      return { claims: evidence.claims, sources: validation?.sources ?? evidence.sources ?? [] };
    return this.aggregateEvidence(runId);
  }

  private async loadProviderReports(runId: string): Promise<ProviderReport[]> {
    const stages = await this.prisma.researchStage.findMany({
      where: { runId, stageKey: { in: ['primary', 'independent', 'social'] } },
    });
    const out: ProviderReport[] = [];
    for (const s of stages) {
      if (s.output && (s.status === 'completed' || s.status === 'fallback')) {
        const o = s.output as { markdown?: string; sources?: unknown[] } & Record<string, unknown>;
        if (o.markdown) out.push(o as unknown as ProviderReport);
      }
    }
    return out;
  }

  private async stageOutput(runId: string, key: StageKey): Promise<unknown | null> {
    const s = await this.prisma.researchStage.findFirst({ where: { runId, stageKey: key } });
    return s?.output ?? null;
  }

  private async failRun(runId: string, message: string): Promise<void> {
    await this.prisma.researchRun.update({
      where: { id: runId },
      data: { status: 'failed', error: message, finishedAt: new Date() },
    });
    await this.appendProgress(runId, 'normalize', `Run failed: ${message.slice(0, 160)}`);
  }

  private async markStage(id: string, data: Record<string, unknown>): Promise<void> {
    await this.prisma.researchStage.update({
      where: { id },
      data: data as Prisma.ResearchStageUpdateInput,
    });
  }

  private async addCost(runId: string, amount: number): Promise<void> {
    if (!amount) return;
    await this.prisma.researchRun.update({
      where: { id: runId },
      data: { accruedCostUsd: { increment: amount } },
    });
  }

  private async appendProgress(runId: string, stage: StageKey, message: string): Promise<void> {
    const run = await this.prisma.researchRun.findUnique({
      where: { id: runId },
      select: { progress: true },
    });
    const existing = (run?.progress as unknown as ProgressEvent[] | null) ?? [];
    const next = [...existing, { ts: new Date().toISOString(), stage, message }].slice(
      -PROGRESS_CAP
    );
    await this.prisma.researchRun.update({
      where: { id: runId },
      data: { progress: next as unknown as Prisma.InputJsonValue },
    });
  }

  private async tenantId(runId: string): Promise<string | null> {
    const r = await this.prisma.researchRun.findUnique({
      where: { id: runId },
      select: { tenantId: true },
    });
    return r?.tenantId ?? null;
  }

  private async nextVersion(runId: string): Promise<number> {
    const last = await this.prisma.researchReport.findFirst({
      where: { runId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (last?.version ?? 0) + 1;
  }
}

// ----- Pure gating helpers -------------------------------------------------

type GateDecision = 'pass' | 'pass_with_caveats' | 'repair_required' | 'reject';

const isPublishable = (v?: string): boolean => v === 'pass' || v === 'pass_with_caveats';

/** Decide the run outcome. `pass_with_caveats` is publishable (caveats attached);
 *  only `repair_required` triggers repair and only `reject` blocks publication. */
function gate(
  f: FactualVerification | null,
  a: AdversarialVerification | null,
  adj: AdjudicationResult | null
): GateDecision {
  const verdicts = [f?.verdict, a?.verdict, adj?.verdict].filter(Boolean) as string[];
  if (!verdicts.length) return 'reject'; // no verifier ran → cannot publish
  if (verdicts.includes('reject')) {
    if (adj && adj.verdict !== 'reject') return adj.verdict as GateDecision; // adjudication can overturn
    return 'reject';
  }
  if (verdicts.includes('repair_required')) return 'repair_required';
  return verdicts.includes('pass_with_caveats') ? 'pass_with_caveats' : 'pass';
}

/** Adjudicate only on a MATERIAL conflict — not merely because a verifier listed risks. */
function adjudicationNeeded(
  f: FactualVerification | null,
  a: AdversarialVerification | null,
  mode: ResearchMode
): boolean {
  if (!f || !a) return false;
  if (mode === 'forensic_max') return true; // mandatory when both verifiers ran
  if (f.verdict === 'reject' || a.verdict === 'reject') return true;
  // They disagree on whether the report is publishable (one publishable, one repair_required).
  if (isPublishable(f.verdict) !== isPublishable(a.verdict)) return true;
  return false;
}

function deterministicValidation(
  r: StructuredReport,
  brief: CanonicalBrief
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const v = r.executiveVerdict;
  if (!['GO', 'CONDITIONAL_GO', 'DO_NOT_ENTER'].includes(v.verdict))
    errors.push('missing/invalid verdict');
  if (!(v.overallScore >= 0 && v.overallScore <= 100)) errors.push('overallScore out of range');
  if (!r.sections.length) errors.push('no report sections');
  if (r.sources.length === 0) errors.push('no sources');
  for (const c of r.evidenceLedger) {
    for (const sid of c.supportingSourceIds) {
      if (sid && !r.sources.some(s => s.sourceId === sid))
        errors.push(`claim ${c.claimId} cites unknown source ${sid}`);
    }
  }
  void brief;
  return { ok: errors.length === 0, errors: errors.slice(0, 10) };
}

function mergeSources(a: EvidenceSource[], b: EvidenceSource[]): EvidenceSource[] {
  const seen = new Map<string, EvidenceSource>();
  for (const s of [...a, ...b]) {
    const key = s.normalizedUrl || canonicalizeUrl(s.url);
    if (!seen.has(key)) seen.set(key, s);
  }
  return Array.from(seen.values());
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export { renderMarkdown };
