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
 *   GET  /api/v1/insurance-leads/:id/quotes   one CRM customer's quotes, summary only
 *   GET  /api/v1/fex/insights         the agency's quoting, for its principal
 *   GET  /api/v1/fex/settings         the agency's quoter settings and mine
 *   PUT  /api/v1/fex/settings         the agency's, principal only
 *   PUT  /api/v1/fex/settings/me      my own choices: "open on connect", my carriers
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
 * A quote run for a CRM customer is ALSO reachable through that customer: an
 * agent who may open Jane Smith (`lib/lead-access.ts` -- hers, and in a state
 * they are licensed for) sees every quote run for her, including one a
 * colleague ran before she was reassigned. That is a widening by customer,
 * never by guessing: the customer gate runs first, and the quotes are then
 * filtered by `insuranceLeadId` in the query.
 *
 * ── Health data ──────────────────────────────────────────────────────────────
 *
 * A saved quote's applicant and results are encrypted at rest
 * (`services/fex/payload.ts`); only non-health summary columns are in the
 * clear, and no audit row carries a condition or a medication.
 *
 * ── My carriers ──────────────────────────────────────────────────────────────
 *
 * An agent may pick the carriers they quote (Account → Quote Carriers). The
 * pick is a list of carrier families, kept on the user (`fexCarriers` in their
 * metadata), and a quote or a save run by that person carries only those
 * carriers' plans. No pick -- or one that no longer names any carrier the
 * engine quotes -- is every carrier. It narrows on top of the agency's
 * settings, never widens them.
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
import { findReachableLead, leadName, type ReachableLead } from '../lib/lead-access.js';
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
  type QuoteSource,
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

/** A customer this request may not act on: 404 when not theirs, 403 when unlicensed. */
function customerRefusal(reply: FastifyReply, reason: 'not_found' | 'unlicensed') {
  return reason === 'not_found'
    ? reply.code(404).send({ error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' } })
    : reply.code(403).send({
        error: {
          code: 'STATE_NOT_LICENSED',
          message: "You are not licensed in this customer's state.",
        },
      });
}

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
});
const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});
const MODE_SHORT: Record<string, string> = {
  monthly: 'mo',
  quarterly: 'qtr',
  semiannual: '6 mo',
  annual: 'yr',
};

/**
 * The customer timeline's line for a saved quote. No health data, ever: what
 * was offered, at what price -- the same fields the audit row carries.
 *
 *   "Mutual of Omaha Living Promise · Level · $10,000 · $54.27/mo"
 *   "7 plans qualified · lowest $41.18/mo · $10,000 requested"
 */
export function quoteActivityText(row: {
  eligibleCount: number;
  lowestPremium: number | null;
  faceAmount: number | null;
  budget: number | null;
  paymentMode: string;
  selectedCarrier: string | null;
  selectedProduct: string | null;
  selectedClass: string | null;
  selectedFace: number | null;
  selectedPremium: number | null;
}): { title: string; description: string } {
  const mode = MODE_SHORT[row.paymentMode] ?? row.paymentMode;
  if (row.selectedCarrier) {
    return {
      title: 'Quote selected',
      description: [
        `${row.selectedCarrier} ${row.selectedProduct ?? ''}`.trim(),
        row.selectedClass,
        row.selectedFace != null ? usd0.format(row.selectedFace) : null,
        row.selectedPremium != null ? `${usd.format(row.selectedPremium)}/${mode}` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    };
  }
  const asked =
    row.faceAmount != null
      ? `${usd0.format(row.faceAmount)} requested`
      : row.budget != null
        ? `${usd.format(row.budget)}/${mode} budget`
        : null;
  return {
    title: 'Quote saved',
    description: [
      `${row.eligibleCount} plan${row.eligibleCount === 1 ? '' : 's'} qualified`,
      row.lowestPremium != null ? `lowest ${usd.format(row.lowestPremium)}/${mode}` : null,
      asked,
    ]
      .filter(Boolean)
      .join(' · '),
  };
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
  const money = (d: Prisma.Decimal | null) => (d == null ? null : Number(d));

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

  /**
   * Run the engine for a validated applicant and apply the agency's display
   * settings, then this person's own carriers when they picked some.
   */
  function runQuote(
    engine: FexEngine,
    applicant: Parameters<typeof quoteAll>[1],
    settings: FexSettingsShape,
    carriers: ReadonlySet<string> | null = null
  ): ProductResult[] {
    return quoteAll(
      engine.bundle,
      applicant,
      { includeUnquotable: false, agentText: true },
      engine.drugs
    ).filter(r => (settings.showPriceOnly || r.uwLoaded) && (!carriers || carriers.has(r.family)));
  }

  /** Every carrier family the engine quotes, A-Z: what an agent may pick from. */
  function quotableCarriers(engine: FexEngine): string[] {
    const families = new Set(engine.bundle.products.filter(p => p.quotable).map(p => p.family));
    return [...families].sort((x, y) => x.localeCompare(y));
  }

  /** This person's saved choices, straight from their user record. */
  async function myQuoteChoices(
    userId: string | null
  ): Promise<{ autoOpenOnCall: boolean | null; carriers: string[] | null }> {
    if (!userId) return { autoOpenOnCall: null, carriers: null };
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    const metadata = user?.metadata as {
      fexAutoOpenOnCall?: unknown;
      fexCarriers?: unknown;
    } | null;
    const auto = metadata?.fexAutoOpenOnCall;
    const carriers = metadata?.fexCarriers;
    return {
      autoOpenOnCall: typeof auto === 'boolean' ? auto : null,
      carriers: Array.isArray(carriers)
        ? carriers.filter((c): c is string => typeof c === 'string')
        : null,
    };
  }

  /**
   * The carriers this request quotes, or null for every one. A saved pick is
   * read against today's engine: a carrier that left the data drops out, and a
   * pick with none left is no pick at all -- never an empty quoter.
   */
  async function myCarrierFilter(
    request: FastifyRequest,
    engine: FexEngine
  ): Promise<Set<string> | null> {
    const { carriers } = await myQuoteChoices(getActingUserId(request));
    if (!carriers) return null;
    const quotable = new Set(quotableCarriers(engine));
    const kept = carriers.filter(c => quotable.has(c));
    return kept.length && kept.length < quotable.size ? new Set(kept) : null;
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
      if (!q) return reply.send({ data: [] });
      const requested = Number(query.limit);
      const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 20) : 10;

      const engine = getFexEngine();
      const data = engine.drugs
        .searchNames(q.slice(0, 80), limit)
        .map(({ ingredient: drug, matched }) => ({
          id: drug.id,
          matched,
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
      const carriers = await myCarrierFilter(request, engine);
      const results = runQuote(engine, parsed.applicant, settings, carriers);
      const authority = await resolveStateAuthority(request, tenantId);

      return reply.send({
        data: {
          results: present(request, engine, results, settings),
          summary: summarise(results),
          carriers: carriers
            ? { selected: carriers.size, total: quotableCarriers(engine).length }
            : null,
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
    // The quote as this person saw it: their carriers only.
    const results = runQuote(engine, applicant, settings, await myCarrierFilter(request, engine));

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
    /*
     * The customer. From the CRM (`source: CRM`) the customer IS the point of
     * the quote, so one the saver may not act on is refused outright and
     * nothing is saved -- the agent must know the quote did not land on the
     * record. From a call, the link is a convenience found by phone number,
     * and an unreachable one is dropped as it always was.
     */
    const source: QuoteSource = body.data.source;
    let customer: ReachableLead | null = null;
    if (source === 'CRM') {
      if (!body.data.insuranceLeadId) {
        return validationError(reply, 'insuranceLeadId: a customer quote needs its customer');
      }
      const access = await findReachableLead(request, tenantId, body.data.insuranceLeadId);
      if (!access.ok) return customerRefusal(reply, access.reason);
      customer = access.lead;
    } else if (body.data.insuranceLeadId) {
      const lead = await prisma.insuranceLead.findFirst({
        where: { id: body.data.insuranceLeadId, tenantId },
        select: {
          id: true,
          assignedToId: true,
          state: true,
          firstName: true,
          lastName: true,
          fullName: true,
        },
      });
      if (lead && mayReachOwnedRow(request, lead.assignedToId)) customer = lead;
    }
    const insuranceLeadId = customer?.id ?? null;
    // A customer's quote is filed under the customer's own name, not the browser's.
    const prospectName = (customer && leadName(customer)) || body.data.prospectName || null;

    const level = results
      .filter(r => r.eligible && resultTier(r) === 0 && r.best?.premium != null)
      .map(r => r.best!.premium!);
    const decimal = (n: number | null | undefined) =>
      n == null ? null : new Prisma.Decimal(round2(n).toFixed(2));

    const row = await prisma.fexQuote.create({
      data: {
        tenantId,
        createdById: userId,
        source,
        callId,
        insuranceLeadId,
        engineVersion: engine.version,
        bundleSha256: engine.bundleSha256,
        prospectName,
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

    // On the customer's timeline. Best effort: the quote itself is saved, and
    // a timeline line is not worth failing the save over.
    if (insuranceLeadId) {
      const line = quoteActivityText({
        eligibleCount: row.eligibleCount,
        lowestPremium: money(row.lowestPremium),
        faceAmount: row.faceAmount,
        budget: money(row.budget),
        paymentMode: row.paymentMode,
        selectedCarrier: row.selectedCarrier,
        selectedProduct: row.selectedProduct,
        selectedClass: row.selectedClass,
        selectedFace: row.selectedFace,
        selectedPremium: money(row.selectedPremium),
      });
      await prisma.insuranceActivity
        .create({
          data: {
            tenantId,
            insuranceLeadId,
            type: 'QUOTE',
            title: line.title,
            description: line.description,
            createdById: userId,
            metadata: {
              fexQuoteId: row.id,
              source: row.source,
              selectedProductId: row.selectedProductId,
            },
          },
        })
        .catch(err => request.log.error(err, 'Failed to record the quote on the customer'));
    }

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

  /**
   * The application each quote was written into, by quote id. A live one wins
   * over a voided one; between equals, the first written.
   */
  async function applicationsFor(tenantId: string, quoteIds: string[]) {
    const byQuote = new Map<string, string>();
    if (!quoteIds.length) return byQuote;
    const applications = await prisma.insuranceCarrierApplication.findMany({
      where: { tenantId, fexQuoteId: { in: quoteIds } },
      select: { id: true, fexQuoteId: true, voidedAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const live = applications.filter(a => !a.voidedAt);
    for (const app of [...live, ...applications]) {
      if (app.fexQuoteId && !byQuote.has(app.fexQuoteId)) byQuote.set(app.fexQuoteId, app.id);
    }
    return byQuote;
  }

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
    const appByQuote = await applicationsFor(
      tenantId,
      page.map(r => r.id)
    );

    return reply.send({
      data: page.map(row => summaryOf(row, appByQuote.get(row.id) ?? null)),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  });

  /*
   * One customer's quotes, newest first: summary columns only, so a customer
   * page opens without decrypting a single payload. The customer gate runs
   * first (`lib/lead-access.ts`), then the quotes are filtered by tenant AND
   * customer in the query -- never fetched wide and narrowed in the browser.
   */
  fastify.get(
    '/api/v1/insurance-leads/:id/quotes',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const tenantId = resolveTenant(request, reply);
      if (!tenantId) return;
      const { id } = request.params as { id: string };
      const access = await findReachableLead(request, tenantId, id);
      if (!access.ok) return customerRefusal(reply, access.reason);

      const query = request.query as Record<string, unknown>;
      const requestedLimit = Number(query.limit);
      const limit =
        Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : 50;
      const where: Prisma.FexQuoteWhereInput = { tenantId, insuranceLeadId: access.lead.id };

      const [rows, total] = await Promise.all([
        prisma.fexQuote.findMany({
          where,
          select: summarySelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          ...(typeof query.cursor === 'string' && query.cursor
            ? { cursor: { id: query.cursor }, skip: 1 }
            : {}),
        }),
        prisma.fexQuote.count({ where }),
      ]);
      const page = rows.slice(0, limit);
      const appByQuote = await applicationsFor(
        tenantId,
        page.map(r => r.id)
      );
      return reply.send({
        data: page.map(row => summaryOf(row, appByQuote.get(row.id) ?? null)),
        total,
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      });
    }
  );

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
    if (!row) return notFound(reply);
    // Their own quote, or one run for a customer they may open. Anything else
    // -- a colleague's quote for a customer that is not theirs -- reads exactly
    // like one that does not exist.
    const reachable =
      mayReachOwnedRow(request, row.createdById) ||
      (row.insuranceLeadId !== null &&
        (await findReachableLead(request, tenantId, row.insuranceLeadId)).ok);
    if (!reachable) return notFound(reply);

    const engine = getFexEngine();
    const settings = await loadSettings(tenantId);
    const applicationId = (await applicationsFor(tenantId, [row.id])).get(row.id) ?? null;
    const stored = openJson<ProductResult[]>(row.resultsEncrypted);

    /*
     * What the application form needs for the plan that was used, from the
     * results AS SAVED -- the historical line, not today's rates.
     */
    let selectedApplication: ReturnType<typeof applicationFor> | null = null;
    if (row.selectedProductId) {
      const result = stored.find(r => r.productId === row.selectedProductId);
      const line = result
        ? [result.best, ...result.others].find(l => l?.classLabel === row.selectedClass)
        : undefined;
      if (result && line) selectedApplication = applicationFor(result, line);
    }

    await auditRead(tenantId, 'FexQuote', row.id, request.url, {
      userId: getActingUserId(request) ?? undefined,
      ipAddress: clientIp(request) ?? undefined,
      userAgent: request.headers['user-agent'],
      requestId: request.id,
    });

    return reply.send({
      data: {
        ...summaryOf(row, applicationId),
        applicant: openJson(row.applicantEncrypted),
        results: present(request, engine, stored, settings),
        selectedApplication,
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

  /** My choices as the browser sees them: a carrier pick is read against today's engine. */
  async function presentMine(userId: string | null) {
    const engine = getFexEngine();
    const mine = await myQuoteChoices(userId);
    const quotable = new Set(quotableCarriers(engine));
    const kept = mine.carriers?.filter(c => quotable.has(c)) ?? [];
    return {
      autoOpenOnCall: mine.autoOpenOnCall,
      carriers: kept.length && kept.length < quotable.size ? kept : null,
    };
  }

  fastify.get('/api/v1/fex/settings', { preHandler: [authenticate] }, async (request, reply) => {
    const tenantId = resolveTenant(request, reply);
    if (!tenantId) return;
    const agency = await loadSettings(tenantId);
    return reply.send({
      data: {
        agency,
        me: await presentMine(getActingUserId(request)),
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

  /*
   * Either choice, or both. `carriers` is a list of carrier families, or null
   * for every carrier; a list naming every carrier is stored as null, so a
   * carrier added to the data later reaches this agent too.
   */
  const MySettingsSchema = z
    .object({
      autoOpenOnCall: z.boolean().nullable().optional(),
      carriers: z.array(z.string().min(1).max(120)).max(200).nullable().optional(),
    })
    .strict()
    .refine(body => body.autoOpenOnCall !== undefined || body.carriers !== undefined, {
      message: 'nothing to save',
    });

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
      const issue = parsed.error.issues[0];
      return validationError(reply, `${issue.path.join('.') || 'settings'}: ${issue.message}`);
    }
    const { autoOpenOnCall, carriers } = parsed.data;

    let nextCarriers: string[] | null | undefined = undefined;
    if (carriers !== undefined) {
      if (carriers === null) {
        nextCarriers = null;
      } else {
        const quotable = quotableCarriers(getFexEngine());
        const picked = [...new Set(carriers)];
        const bad = picked.find(c => !quotable.includes(c));
        if (bad)
          return validationError(reply, `carriers: "${bad}" is not a carrier the quoter quotes`);
        if (!picked.length) return validationError(reply, 'carriers: choose at least one carrier');
        nextCarriers =
          picked.length === quotable.length ? null : quotable.filter(c => picked.includes(c));
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { metadata: true },
    });
    if (!user) return notFound(reply, 'User not found');
    const before = (user.metadata as Record<string, unknown> | null) ?? {};
    const metadata = {
      ...before,
      ...(autoOpenOnCall !== undefined ? { fexAutoOpenOnCall: autoOpenOnCall } : {}),
      ...(nextCarriers !== undefined ? { fexCarriers: nextCarriers } : {}),
    };
    await prisma.user.update({
      where: { id: userId },
      data: { metadata: metadata as Prisma.InputJsonValue },
    });
    if (nextCarriers !== undefined) {
      await auditLog({
        tenantId,
        userId,
        action: 'fex.my_carriers.updated',
        entityType: 'User',
        entityId: userId,
        resource: request.url,
        method: request.method,
        changes: { from: before.fexCarriers ?? null, to: nextCarriers },
        ipAddress: clientIp(request) ?? undefined,
        userAgent: request.headers['user-agent'],
        requestId: request.id,
      });
    }
    return reply.send({ data: { me: await presentMine(userId) } });
  });
}
