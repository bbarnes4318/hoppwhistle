/**
 * The final expense quote engine, as an API.
 *
 *   GET  /api/v1/fex/catalog          products and conditions, no rate or rule data
 *   GET  /api/v1/fex/drugs?q=         medication typeahead
 *   GET  /api/v1/fex/drugs/:id        one medication across every carrier's Rx list
 *   POST /api/v1/fex/quote            compute a quote; writes nothing
 *   POST /api/v1/fex/quotes           save a quote (re-quoted here, never trusted)
 *   GET  /api/v1/fex/quotes           saved quotes, summary columns only
 *   GET  /api/v1/fex/quotes/:id       one saved quote, decrypted
 *   GET  /api/v1/fex/insights         the agency's quoting, for its principal
 *   GET  /api/v1/fex/settings         the agency's quoter settings and mine
 *   PUT  /api/v1/fex/settings         the agency's, principal only
 *   PUT  /api/v1/fex/settings/me      my own "open on connect" choice
 *
 * ── The data stays here ──────────────────────────────────────────────────────
 *
 * The engine runs in this process against the bundle `services/fex/bundle.ts`
 * loads. No response carries a rate table, a rule record or an Rx list: the
 * catalog is names and counts, a quote is results, and the drug lookup is the
 * one medication asked about. See `services/fex/present.ts` for what is
 * removed from results for anyone who is not NetEnroll staff.
 *
 * ── Whose quotes ─────────────────────────────────────────────────────────────
 *
 * `lib/agent-scope.ts`: an agent sees the quotes they saved, an agency
 * principal sees the agency's, staff inside an agency see that agency's.
 * `createdById` and `tenantId` come from the token, never from a body.
 *
 * ── Health data ──────────────────────────────────────────────────────────────
 *
 * A saved quote's applicant and results are encrypted at rest
 * (`services/fex/payload.ts`); only non-health summary columns are in the
 * clear, and no audit row carries a condition or a medication.
 */

import {
  formatMonths,
  outcomeLabel,
  quoteAll,
  resultTier,
  type ProductResult,
  type RuleWindow,
} from '@hopwhistle/fex-engine';
import { Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { agentScopeFor, isAgencyPrincipal, mayReachOwnedRow } from '../lib/agent-scope.js';
import { clientIp } from '../lib/client-ip.js';
import { resolveStateAuthority } from '../lib/licensed-states.js';
import { requireAgencyPrincipal } from '../lib/platform-context.js';
import { getPrismaClient } from '../lib/prisma.js';
import { getActingUserId, resolveTenant } from '../lib/tenant-context.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog, auditRead } from '../services/audit.js';
import { getFexEngine, type FexEngine } from '../services/fex/bundle.js';
import { openJson, sealJson } from '../services/fex/payload.js';
import {
  applicationFor,
  DEFAULT_FEX_SETTINGS,
  isAppointed,
  presentResults,
  ratesStatusOf,
  round2,
  uwStatusOf,
  type FexSettingsShape,
  type PresentedResult,
} from '../services/fex/present.js';
import {
  parseApplicant,
  PAYMENT_MODE_VALUES,
  QUOTE_SOURCES,
  summaryAge,
} from '../services/fex/schema.js';
import {
  isPeriodKey,
  PeriodError,
  resolvePeriod,
  type LeaderboardPeriodKey,
} from '../services/leaderboard/period.js';

interface StaffPrincipal {
  isPlatformAdmin?: boolean;
  userId?: string;
}

function isStaff(request: FastifyRequest): boolean {
  return (request.user as StaffPrincipal | undefined)?.isPlatformAdmin === true;
}

function validationError(reply: FastifyReply, message: string) {
  return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message } });
}

function notFound(reply: FastifyReply, message = 'Quote not found') {
  return reply.code(404).send({ error: { code: 'NOT_FOUND', message } });
}

/**
 * The quote routes fire on every edit -- a debounced re-quote per keystroke
 * burst, a typeahead per search -- so they get their own allowance, keyed on
 * the PERSON. The global limiter is 100/minute per IP, and a whole call floor
 * behind one office IP would share it.
 */
const liveLimit = {
  rateLimit: {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (r: FastifyRequest) =>
      (r.user as StaffPrincipal | undefined)?.userId ?? clientIp(r) ?? 'unknown',
  },
};

const windowLabel = (window: RuleWindow | null | undefined): string | null => {
  if (!window) return null;
  switch (window.kind) {
    case 'within':
      return `Within ${formatMonths(window.months)}`;
    case 'beyond':
      return `More than ${formatMonths(window.months)}`;
    case 'current':
      return 'Currently taking';
    case 'ever':
      return 'Ever';
    default:
      return null;
  }
};

/** A ProductResult with the carrier's legal name replaced by its family for non-staff. */
function scrubCarrier(result: PresentedResult, staff: boolean): PresentedResult {
  return staff ? result : { ...result, carrier: result.family };
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerFexRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  async function loadSettings(tenantId: string): Promise<FexSettingsShape> {
    const row = await prisma.fexTenantSettings.findUnique({ where: { tenantId } });
    if (!row) return { ...DEFAULT_FEX_SETTINGS };
    return {
      appointedOnly: row.appointedOnly,
      appointedProductIds: row.appointedProductIds,
      defaultFace: row.defaultFace,
      defaultMode: row.defaultMode,
      showPriceOnly: row.showPriceOnly,
      autoOpenOnCall: row.autoOpenOnCall,
    };
  }

  /** Run the engine for a validated applicant and apply the agency's display settings. */
  function runQuote(
    engine: FexEngine,
    applicant: Parameters<typeof quoteAll>[1],
    settings: FexSettingsShape
  ): ProductResult[] {
    return quoteAll(
      engine.bundle,
      applicant,
      { includeUnquotable: false, agentText: true },
      engine.drugs
    ).filter(r => settings.showPriceOnly || r.uwLoaded);
  }

  function present(
    request: FastifyRequest,
    engine: FexEngine,
    results: ProductResult[],
    settings: FexSettingsShape
  ): PresentedResult[] {
    const staff = isStaff(request);
    return presentResults(results, {
      settings,
      isStaff: staff,
      productsById: engine.productsById,
    }).map(r => scrubCarrier(r, staff));
  }

  function summarise(results: ProductResult[]) {
    const eligible = results.filter(r => r.eligible);
    const level = eligible
      .filter(r => resultTier(r) === 0 && r.best?.benefit === 'LEVEL' && r.best.premium != null)
      .map(r => r.best!.premium!);
    const drugIds = new Set(results.flatMap(r => r.needsIndication.map(n => n.drugId)));
    return {
      eligible: eligible.filter(r => r.uwLoaded).length,
      declined: results.length - eligible.length,
      priceOnly: eligible.filter(r => !r.uwLoaded).length,
      lowestLevelPremium: level.length ? Math.min(...level) : null,
      needsIndication: drugIds.size,
    };
  }

  // ── Catalog ────────────────────────────────────────────────────────────────

  fastify.get('/api/v1/fex/catalog', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const engine = getFexEngine();
    const settings = await loadSettings(tenantId);
    return reply.send({
      data: {
        engineVersion: engine.version,
        bundleSha256: engine.bundleSha256.slice(0, 12),
        conditions: engine.bundle.conditions.map(c => ({
          code: c.code,
          label: c.label,
          category: c.category,
        })),
        products: engine.bundle.products.map(p => {
          const rs = ratesStatusOf(p.ratesStatus);
          return {
            id: p.id,
            family: p.family,
            product: p.product,
            quotable: p.quotable,
            appointed: p.quotable && isAppointed(settings, p.id),
            ratesStatus: { code: p.ratesStatus, label: rs.label, tone: rs.tone },
            uwStatus: { code: p.uwStatus, label: uwStatusOf(p.uwStatus) },
            uwLoaded: p.uwLoaded,
            sourceDate: p.source?.effective_or_doc_date ?? null,
            classes: p.classes.map(c => ({ code: c.code, label: c.label, benefit: c.benefit })),
            stateUnavailable: [...p.stateUnavailable],
            counts: {
              rules: p.uw.rules.length,
              rx: Object.values(p.uw.rx).reduce((n, entries) => n + entries.length, 0),
              build: p.uw.build?.rows.length ?? 0,
            },
            alerts: [...p.alerts],
          };
        }),
      },
    });
  });

  // ── Medications ────────────────────────────────────────────────────────────

  fastify.get(
    '/api/v1/fex/drugs',
    { preHandler: [authenticate], config: liveLimit },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;
      const query = request.query as { q?: unknown; limit?: unknown };
      const q = typeof query.q === 'string' ? query.q.trim() : '';
      if (q.length < 2) return reply.send({ data: [] });
      const requested = Number(query.limit);
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 20) : 10;

      const engine = getFexEngine();
      const data = engine.drugs.search(q.slice(0, 80), limit).map(drug => ({
        id: drug.id,
        generic: drug.generic,
        brands: (drug.brands ?? []).slice(0, 3),
        drugClass: drug.drug_class,
        multiUse: engine.drugs.multiUse(drug.id),
        indications: engine.drugs.indicationOptions(drug.id).map(code => ({
          code,
          label: engine.conditionsByCode.get(code)?.label ?? code,
        })),
      }));
      return reply.send({ data });
    }
  );

  fastify.get('/api/v1/fex/drugs/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const engine = getFexEngine();
    const drug = engine.drugs.byId.get(id);
    if (!drug) return notFound(reply, 'Medication not found');

    const staff = isStaff(request);
    const label = (code: string) => engine.conditionsByCode.get(code)?.label ?? code;
    const related = engine.drugs.related(id);
    const rules = [];
    for (const product of engine.bundle.products) {
      if (!product.quotable) continue;
      for (const relatedId of related) {
        for (const entry of product.uw.rx[relatedId] ?? []) {
          rules.push({
            productId: product.id,
            family: product.family,
            product: product.product,
            printedAs: entry.drug,
            use: entry.indText ?? (entry.ind.length ? entry.ind.map(label).join(', ') : 'Any use'),
            dependsOnUse: entry.dep,
            outcome: entry.outcome,
            outcomeLabel:
              entry.outcome === 'DECLINE' ? 'Decline' : outcomeLabel(product, entry.outcome),
            window: windowLabel(entry.window),
            page: entry.page,
            ...(staff ? { note: entry.note } : {}),
          });
        }
      }
    }
    return reply.send({
      data: {
        id: drug.id,
        generic: drug.generic,
        brands: drug.brands ?? [],
        drugClass: drug.drug_class,
        rules,
      },
    });
  });

  // ── Quote (compute only) ───────────────────────────────────────────────────

  fastify.post(
    '/api/v1/fex/quote',
    { preHandler: [authenticate], config: liveLimit },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;
      const engine = getFexEngine();
      const body = (request.body ?? {}) as { applicant?: unknown };
      const parsed = parseApplicant(body.applicant, engine);
      if (!parsed.ok) return validationError(reply, parsed.message);

      const settings = await loadSettings(tenantId);
      const results = runQuote(engine, parsed.applicant, settings);
      const authority = await resolveStateAuthority(request, tenantId);

      return reply.send({
        data: {
          results: present(request, engine, results, settings),
          summary: summarise(results),
          licensed: authority.restricted ? authority.licensed.has(parsed.applicant.state) : null,
          engineVersion: engine.version,
          quotedAt: new Date().toISOString(),
          quoteDate: parsed.applicant.quoteDate,
        },
      });
    }
  );

  // ── Save ───────────────────────────────────────────────────────────────────

  const SaveSchema = z.object({
    applicant: z.unknown(),
    source: z.enum(QUOTE_SOURCES),
    callId: z.string().min(1).max(120).optional().nullable(),
    insuranceLeadId: z.string().min(1).max(120).optional().nullable(),
    prospectName: z.string().trim().max(120).optional().nullable(),
    selectedProductId: z.string().min(1).max(120).optional().nullable(),
    selectedClassCode: z.string().min(1).max(120).optional().nullable(),
  });

  fastify.post('/api/v1/fex/quotes', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const userId = getActingUserId(request);
    if (!userId) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Saving a quote requires a signed-in person' },
      });
    }

    const body = SaveSchema.safeParse(request.body ?? {});
    if (!body.success) {
      const issue = body.error.issues[0];
      return validationError(reply, `${issue.path.join('.') || 'body'}: ${issue.message}`);
    }
    const engine = getFexEngine();
    const parsed = parseApplicant(body.data.applicant, engine);
    if (!parsed.ok) return validationError(reply, parsed.message);
    const applicant = parsed.applicant;

    const settings = await loadSettings(tenantId);
    const results = runQuote(engine, applicant, settings);

    // The selection, from THIS run of the engine -- never from the client's results.
    let selected: { result: ProductResult; line: NonNullable<ProductResult['best']> } | null = null;
    if (body.data.selectedProductId) {
      const result = results.find(r => r.productId === body.data.selectedProductId);
      const code = body.data.selectedClassCode;
      const line =
        result?.eligible && result.best
          ? !code || result.best.classCode === code
            ? result.best
            : result.others.find(o => o.classCode === code)
          : undefined;
      if (!result || !line) {
        return reply.code(422).send({
          error: {
            code: 'NOT_ELIGIBLE',
            message: 'That plan does not qualify for this applicant. Re-quote and choose again.',
          },
        });
      }
      selected = { result, line };
    }

    // Links are kept only when they are this agency's and this person may reach them.
    let callId: string | null = null;
    if (body.data.callId) {
      const call = await prisma.call.findFirst({
        where: { id: body.data.callId, tenantId },
        select: { id: true, answeredByUserId: true },
      });
      if (call && mayReachOwnedRow(request, call.answeredByUserId)) callId = call.id;
    }
    let insuranceLeadId: string | null = null;
    if (body.data.insuranceLeadId) {
      const lead = await prisma.insuranceLead.findFirst({
        where: { id: body.data.insuranceLeadId, tenantId },
        select: { id: true, assignedToId: true },
      });
      if (lead && mayReachOwnedRow(request, lead.assignedToId)) insuranceLeadId = lead.id;
    }

    const level = results
      .filter(r => r.eligible && resultTier(r) === 0 && r.best?.premium != null)
      .map(r => r.best!.premium!);
    const decimal = (n: number | null | undefined) =>
      n == null ? null : new Prisma.Decimal(round2(n).toFixed(2));

    const row = await prisma.fexQuote.create({
      data: {
        tenantId,
        createdById: userId,
        source: body.data.source,
        callId,
        insuranceLeadId,
        engineVersion: engine.version,
        bundleSha256: engine.bundleSha256,
        prospectName: body.data.prospectName || null,
        state: applicant.state,
        age: summaryAge(applicant),
        sex: applicant.sex,
        tobacco: applicant.tobacco,
        faceAmount: applicant.face ?? null,
        budget: decimal(applicant.budget),
        paymentMode: applicant.mode ?? 'monthly',
        eligibleCount: results.filter(r => r.eligible && r.uwLoaded).length,
        lowestPremium: decimal(level.length ? Math.min(...level) : null),
        selectedProductId: selected?.result.productId ?? null,
        selectedCarrier: selected?.result.family ?? null,
        selectedProduct: selected?.result.product ?? null,
        selectedClass: selected?.line.classLabel ?? null,
        selectedBenefit: selected?.line.benefit ?? null,
        selectedFace: selected?.line.face ?? null,
        selectedPremium: decimal(selected?.line.premium),
        applicantEncrypted: sealJson(applicant),
        resultsEncrypted: sealJson(results),
      },
    });

    await auditLog({
      tenantId,
      userId,
      action: 'fex.quote.saved',
      entityType: 'FexQuote',
      entityId: row.id,
      resource: request.url,
      method: request.method,
      // No health data: what was chosen, at what price, and for which state.
      changes: {
        source: row.source,
        state: row.state,
        engineVersion: row.engineVersion,
        selectedProductId: row.selectedProductId,
        selectedFace: row.selectedFace,
        selectedPremium: row.selectedPremium?.toString() ?? null,
        callId,
        insuranceLeadId,
      },
      ipAddress: clientIp(request) ?? undefined,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    });

    return reply.code(201).send({
      data: {
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        selected: selected
          ? {
              productId: selected.result.productId,
              carrier: selected.result.family,
              product: selected.result.product,
              classCode: selected.line.classCode,
              classLabel: selected.line.classLabel,
              benefit: selected.line.benefit,
              face: selected.line.face,
              premium: selected.line.premium,
              mode: selected.line.mode,
              application: applicationFor(selected.result, selected.line),
            }
          : null,
      },
    });
  });

  // ── Saved quotes ───────────────────────────────────────────────────────────

  const summarySelect = {
    id: true,
    source: true,
    callId: true,
    insuranceLeadId: true,
    engineVersion: true,
    prospectName: true,
    state: true,
    age: true,
    sex: true,
    tobacco: true,
    faceAmount: true,
    budget: true,
    paymentMode: true,
    eligibleCount: true,
    lowestPremium: true,
    selectedProductId: true,
    selectedCarrier: true,
    selectedProduct: true,
    selectedClass: true,
    selectedBenefit: true,
    selectedFace: true,
    selectedPremium: true,
    createdAt: true,
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
  } satisfies Prisma.FexQuoteSelect;

  type SummaryRow = Prisma.FexQuoteGetPayload<{ select: typeof summarySelect }>;

  const nameOf = (u: { firstName: string | null; lastName: string | null; email: string }) =>
    [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email;

  const money = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

  function summaryOf(row: SummaryRow, applicationId: string | null = null) {
    return {
      id: row.id,
      source: row.source,
      callId: row.callId,
      insuranceLeadId: row.insuranceLeadId,
      engineVersion: row.engineVersion,
      prospectName: row.prospectName,
      state: row.state,
      age: row.age,
      sex: row.sex,
      tobacco: row.tobacco,
      faceAmount: row.faceAmount,
      budget: money(row.budget),
      paymentMode: row.paymentMode,
      eligibleCount: row.eligibleCount,
      lowestPremium: money(row.lowestPremium),
      selectedProductId: row.selectedProductId,
      selectedCarrier: row.selectedCarrier,
      selectedProduct: row.selectedProduct,
      selectedClass: row.selectedClass,
      selectedBenefit: row.selectedBenefit,
      selectedFace: row.selectedFace,
      selectedPremium: money(row.selectedPremium),
      createdAt: row.createdAt.toISOString(),
      createdBy: { id: row.createdBy.id, name: nameOf(row.createdBy) },
      applicationId,
    };
  }

  /** `?period=` (the Leaderboard's names) or `?from=&to=` (calendar days); null = no range. */
  function rangeOf(
    query: { period?: unknown; from?: unknown; to?: unknown },
    fallback: LeaderboardPeriodKey | null
  ): { start: Date; endExclusive: Date; from: string; to: string } | null | 'invalid' {
    const key =
      query.period !== undefined
        ? query.period
        : query.from !== undefined || query.to !== undefined
          ? 'CUSTOM'
          : fallback;
    if (key === null) return null;
    if (!isPeriodKey(key)) return 'invalid';
    try {
      const period = resolvePeriod(key, {
        from: typeof query.from === 'string' ? query.from : undefined,
        to: typeof query.to === 'string' ? query.to : (query.from as string | undefined),
      });
      return {
        start: period.start,
        endExclusive: period.endExclusive,
        from: period.from,
        to: period.to,
      };
    } catch (error) {
      if (error instanceof PeriodError) return 'invalid';
      throw error;
    }
  }

  fastify.get('/api/v1/fex/quotes', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const query = request.query as Record<string, unknown>;
    const range = rangeOf(query, null);
    if (range === 'invalid') return validationError(reply, 'period: not a valid date range');

    // Overwrite, never check: an agent's own id, whatever the query said.
    const ownerId = agentScopeFor(request);
    const agentFilter =
      ownerId ?? (typeof query.agentId === 'string' && query.agentId ? query.agentId : null);
    const requestedLimit = Number(query.limit);
    const limit =
      Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 200) : 50;

    const where: Prisma.FexQuoteWhereInput = {
      tenantId,
      ...(agentFilter ? { createdById: agentFilter } : {}),
      ...(typeof query.productId === 'string' && query.productId
        ? { selectedProductId: query.productId }
        : {}),
      ...(range ? { createdAt: { gte: range.start, lt: range.endExclusive } } : {}),
    };

    const rows = await prisma.fexQuote.findMany({
      where,
      select: summarySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(typeof query.cursor === 'string' && query.cursor
        ? { cursor: { id: query.cursor }, skip: 1 }
        : {}),
    });
    const page = rows.slice(0, limit);
    const applications = page.length
      ? await prisma.insuranceCarrierApplication.findMany({
          where: { tenantId, fexQuoteId: { in: page.map(r => r.id) } },
          select: { id: true, fexQuoteId: true },
          orderBy: { createdAt: 'asc' },
        })
      : [];
    const appByQuote = new Map<string, string>();
    for (const app of applications) {
      if (app.fexQuoteId && !appByQuote.has(app.fexQuoteId)) appByQuote.set(app.fexQuoteId, app.id);
    }

    return reply.send({
      data: page.map(row => summaryOf(row, appByQuote.get(row.id) ?? null)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  });

  fastify.get('/api/v1/fex/quotes/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const row = await prisma.fexQuote.findFirst({
      where: { id, tenantId },
      select: {
        ...summarySelect,
        createdById: true,
        applicantEncrypted: true,
        resultsEncrypted: true,
      },
    });
    // A colleague's quote reads exactly like one that does not exist.
    if (!row || !mayReachOwnedRow(request, row.createdById)) return notFound(reply);

    const engine = getFexEngine();
    const settings = await loadSettings(tenantId);
    const application = await prisma.insuranceCarrierApplication.findFirst({
      where: { tenantId, fexQuoteId: row.id },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });

    await auditRead(tenantId, 'FexQuote', row.id, request.url, {
      userId: getActingUserId(request) ?? undefined,
      ipAddress: clientIp(request) ?? undefined,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    });

    return reply.send({
      data: {
        ...summaryOf(row, application?.id ?? null),
        applicant: openJson(row.applicantEncrypted),
        results: present(
          request,
          engine,
          openJson<ProductResult[]>(row.resultsEncrypted),
          settings
        ),
      },
    });
  });

  // ── Insights ───────────────────────────────────────────────────────────────

  fastify.get(
    '/api/v1/fex/insights',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;
      const range = rangeOf(request.query as Record<string, unknown>, 'THIS_MONTH');
      if (range === 'invalid' || range === null) {
        return validationError(reply, 'period: not a valid date range');
      }
      const inRange = { gte: range.start, lt: range.endExclusive };

      const [quotes, applications] = await Promise.all([
        prisma.fexQuote.findMany({
          where: { tenantId, createdAt: inRange },
          select: {
            createdById: true,
            selectedProductId: true,
            selectedPremium: true,
            paymentMode: true,
          },
        }),
        prisma.insuranceCarrierApplication.findMany({
          where: {
            tenantId,
            fexQuoteId: { not: null },
            voidedAt: null,
            createdAt: inRange,
          },
          select: { createdById: true },
        }),
      ]);

      const byAgent = new Map<string, { quotes: number; used: number; applications: number }>();
      const bump = (id: string) => {
        let entry = byAgent.get(id);
        if (!entry) byAgent.set(id, (entry = { quotes: 0, used: 0, applications: 0 }));
        return entry;
      };
      for (const q of quotes) {
        const entry = bump(q.createdById);
        entry.quotes += 1;
        if (q.selectedProductId) entry.used += 1;
      }
      for (const a of applications) if (a.createdById) bump(a.createdById).applications += 1;

      const users = byAgent.size
        ? await prisma.user.findMany({
            where: { id: { in: [...byAgent.keys()] }, tenantId },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : [];
      const names = new Map(users.map(u => [u.id, nameOf(u)]));

      const engine = getFexEngine();
      const byProduct = new Map<string, { count: number; premiums: number[] }>();
      for (const q of quotes) {
        if (!q.selectedProductId) continue;
        let entry = byProduct.get(q.selectedProductId);
        if (!entry) byProduct.set(q.selectedProductId, (entry = { count: 0, premiums: [] }));
        entry.count += 1;
        if (q.selectedPremium != null) entry.premiums.push(Number(q.selectedPremium));
      }

      return reply.send({
        data: {
          period: { from: range.from, to: range.to },
          quotes: quotes.length,
          used: quotes.filter(q => q.selectedProductId).length,
          savedBy: [...byAgent.entries()]
            .map(([agentId, v]) => ({ agentId, name: names.get(agentId) ?? 'Former user', ...v }))
            .sort((a, b) => b.quotes - a.quotes || a.name.localeCompare(b.name)),
          topSelected: [...byProduct.entries()]
            .map(([productId, v]) => {
              const product = engine.productsById.get(productId);
              return {
                productId,
                carrier: product?.family ?? productId,
                product: product?.product ?? '',
                count: v.count,
                avgPremium: v.premiums.length
                  ? round2(v.premiums.reduce((s, n) => s + n, 0) / v.premiums.length)
                  : null,
              };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 10),
          conversion: {
            quotes: quotes.length,
            applications: applications.length,
            rate: quotes.length ? round2(applications.length / quotes.length) : null,
          },
        },
      });
    }
  );

  // ── Settings ───────────────────────────────────────────────────────────────

  async function myAutoOpen(userId: string | null): Promise<boolean | null> {
    if (!userId) return null;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    const value = (user?.metadata as { fexAutoOpenOnCall?: unknown } | null)?.fexAutoOpenOnCall;
    return typeof value === 'boolean' ? value : null;
  }

  fastify.get('/api/v1/fex/settings', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const agency = await loadSettings(tenantId);
    return reply.send({
      data: {
        agency,
        me: { autoOpenOnCall: await myAutoOpen(getActingUserId(request)) },
        canEdit: isAgencyPrincipal(request),
      },
    });
  });

  const SettingsSchema = z
    .object({
      appointedOnly: z.boolean(),
      appointedProductIds: z.array(z.string().min(1).max(120)).max(200),
      defaultFace: z.number().int().min(1000).max(500000),
      defaultMode: z.enum(PAYMENT_MODE_VALUES),
      showPriceOnly: z.boolean(),
      autoOpenOnCall: z.boolean(),
    })
    .strict();

  fastify.put(
    '/api/v1/fex/settings',
    { preHandler: [authenticate, requireAgencyPrincipal] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;
      const parsed = SettingsSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return validationError(reply, `${issue.path.join('.') || 'settings'}: ${issue.message}`);
      }
      const engine = getFexEngine();
      const ids = [...new Set(parsed.data.appointedProductIds)];
      const bad = ids.find(id => !engine.productsById.get(id)?.quotable);
      if (bad) return validationError(reply, `appointedProductIds: "${bad}" is not a quoted plan`);

      const before = await loadSettings(tenantId);
      const userId = getActingUserId(request);
      const next = { ...parsed.data, appointedProductIds: ids, updatedById: userId };
      await prisma.fexTenantSettings.upsert({
        where: { tenantId },
        create: { tenantId, ...next },
        update: next,
      });
      const after = await loadSettings(tenantId);

      await auditLog({
        tenantId,
        userId: userId ?? undefined,
        action: 'fex.settings.updated',
        entityType: 'FexTenantSettings',
        entityId: tenantId,
        resource: request.url,
        method: request.method,
        changes: { from: before, to: after },
        ipAddress: clientIp(request) ?? undefined,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
      });
      return reply.send({ data: { agency: after } });
    }
  );

  const MySettingsSchema = z.object({ autoOpenOnCall: z.boolean().nullable() }).strict();

  fastify.put('/api/v1/fex/settings/me', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const userId = getActingUserId(request);
    if (!userId) {
      return reply.code(401).send({
        error: { code: 'UNAUTHORIZED', message: 'This setting belongs to a signed-in person' },
      });
    }
    const parsed = MySettingsSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return validationError(reply, 'autoOpenOnCall: must be true, false or null');
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    if (!user) return notFound(reply, 'User not found');
    const metadata = {
      ...((user.metadata as Record<string, unknown> | null) ?? {}),
      fexAutoOpenOnCall: parsed.data.autoOpenOnCall,
    };
    await prisma.user.update({
      where: { id: userId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });
    return reply.send({ data: { me: { autoOpenOnCall: parsed.data.autoOpenOnCall } } });
  });
}
