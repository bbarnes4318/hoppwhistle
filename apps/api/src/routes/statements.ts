/**
 * Monthly statements.
 *
 *   GET /api/v1/statements?partyType=&partyId=
 *       The months there is a statement for, newest first, "Month to date" on top.
 *   GET /api/v1/statements/<YYYY-MM|current>.pdf?partyType=&partyId=
 *   GET /api/v1/statements/<YYYY-MM|current>.csv?partyType=&partyId=
 *
 * ── Whose ────────────────────────────────────────────────────────────────────
 *
 * The party names its own tenant: a buyer's and a publisher's is theirs, an
 * agency's is itself, and a child agency's statement is its parent's to issue.
 * Who may read it:
 *
 *   BUYER          that buyer's own portal users; the OWNER or ADMIN of its agency
 *   PUBLISHER      that publisher's own portal users; the OWNER or ADMIN of its agency
 *   AGENCY         the agency's OWNER or ADMIN
 *   CHILD_AGENCY   the parent white-label's OWNER or ADMIN; the child's own OWNER
 *
 * and a platform admin, for all of them. Anything else is a 404, the same
 * answer as a party that does not exist, so a guessed id learns nothing.
 *
 * Omitting the party means "mine": a buyer's own buyer, a publisher's own
 * publisher, otherwise the acting agency.
 */

import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { logger } from '../lib/logger.js';
import { getPrismaClient } from '../lib/prisma.js';
import { authenticate, type AuthenticatedUser } from '../middleware/auth.js';
import {
  isPartyType,
  StatementPartyNotFoundError,
  StatementReconciliationError,
  type PartyType,
  type StatementParty,
} from '../services/statements/statement-data.js';
import {
  getStatementDocument,
  listStatementMonths,
  statementCsv,
  statementFileName,
  statementPdf,
} from '../services/statements/statements.js';

interface PartyQuery {
  partyType?: string;
  partyId?: string;
}

const NOT_FOUND = { error: { code: 'NOT_FOUND', message: 'Statement not found' } };

function principalOf(request: FastifyRequest): AuthenticatedUser | null {
  return ((request as FastifyRequest & { user?: AuthenticatedUser }).user ??
    null) as AuthenticatedUser | null;
}

function hasRole(user: AuthenticatedUser, ...roles: string[]): boolean {
  return (user.roles ?? []).some(role => roles.includes(role));
}

/**
 * The party a request names, with its tenant, if the caller may read it.
 * Null when it does not exist or the caller may not see it.
 */
export async function authorizedParty(
  prisma: Pick<PrismaClient, 'buyer' | 'publisher' | 'tenant'>,
  user: AuthenticatedUser | null,
  query: PartyQuery
): Promise<StatementParty | null> {
  if (!user) return null;
  const platformAdmin = user.isPlatformAdmin === true;
  const acting = user.tenantId ?? null;
  const principal = hasRole(user, 'OWNER', 'ADMIN');

  let partyType: PartyType;
  if (query.partyType === undefined || query.partyType === '') {
    if (hasRole(user, 'BUYER') && !principal && user.buyerId) partyType = 'BUYER';
    else if (hasRole(user, 'PUBLISHER') && !principal && user.publisherId) partyType = 'PUBLISHER';
    else partyType = 'AGENCY';
  } else if (isPartyType(query.partyType)) {
    partyType = query.partyType;
  } else {
    return null;
  }

  const partyId =
    query.partyId ||
    (partyType === 'BUYER'
      ? user.buyerId
      : partyType === 'PUBLISHER'
        ? user.publisherId
        : acting) ||
    null;
  if (!partyId) return null;

  switch (partyType) {
    case 'BUYER': {
      const buyer = await prisma.buyer.findUnique({
        where: { id: partyId },
        select: { tenantId: true },
      });
      if (!buyer) return null;
      const own = hasRole(user, 'BUYER') && user.buyerId === partyId;
      const agency = principal && acting === buyer.tenantId;
      return own || agency || platformAdmin
        ? { tenantId: buyer.tenantId, partyType, partyId }
        : null;
    }
    case 'PUBLISHER': {
      const publisher = await prisma.publisher.findUnique({
        where: { id: partyId },
        select: { tenantId: true },
      });
      if (!publisher) return null;
      const own = hasRole(user, 'PUBLISHER') && user.publisherId === partyId;
      const agency = principal && acting === publisher.tenantId;
      return own || agency || platformAdmin
        ? { tenantId: publisher.tenantId, partyType, partyId }
        : null;
    }
    case 'AGENCY': {
      const tenant = await prisma.tenant.findUnique({
        where: { id: partyId },
        select: { id: true },
      });
      if (!tenant) return null;
      const agency = principal && acting === tenant.id;
      return agency || platformAdmin ? { tenantId: tenant.id, partyType, partyId } : null;
    }
    case 'CHILD_AGENCY': {
      const child = await prisma.tenant.findUnique({
        where: { id: partyId },
        select: { id: true, parentTenantId: true },
      });
      if (!child?.parentTenantId) return null;
      const parent = principal && acting === child.parentTenantId;
      const self = hasRole(user, 'OWNER') && acting === child.id;
      return parent || self || platformAdmin
        ? { tenantId: child.parentTenantId, partyType, partyId }
        : null;
    }
  }
}

/** `2026-08.pdf` → { month: '2026-08', format: 'pdf' }. */
function parseFile(file: string): { month: string; format: 'pdf' | 'csv' } | null {
  const match = /^(current|\d{4}-(?:0[1-9]|1[0-2]))\.(pdf|csv)$/.exec(file);
  return match ? { month: match[1], format: match[2] as 'pdf' | 'csv' } : null;
}

// eslint-disable-next-line @typescript-eslint/require-await -- plugin signature
export async function registerStatementRoutes(fastify: FastifyInstance): Promise<void> {
  const prisma = getPrismaClient();

  async function partyFor(
    request: FastifyRequest<{ Querystring: PartyQuery }>,
    reply: FastifyReply
  ): Promise<StatementParty | null> {
    const party = await authorizedParty(prisma, principalOf(request), request.query);
    if (!party) void reply.code(404).send(NOT_FOUND);
    return party;
  }

  fastify.get<{ Querystring: PartyQuery }>(
    '/api/v1/statements',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const party = await partyFor(request, reply);
      if (!party) return reply;
      const months = await listStatementMonths(prisma, party);
      return reply.send({ data: { party, months } });
    }
  );

  fastify.get<{ Params: { file: string }; Querystring: PartyQuery }>(
    '/api/v1/statements/:file',
    { preHandler: [authenticate] },
    async (request, reply) => {
      const file = parseFile(request.params.file);
      if (!file) return reply.code(404).send(NOT_FOUND);

      const party = await partyFor(request, reply);
      if (!party) return reply;

      let document;
      try {
        document = await getStatementDocument(prisma, party, file.month);
      } catch (error) {
        if (error instanceof StatementPartyNotFoundError) return reply.code(404).send(NOT_FOUND);
        if (error instanceof StatementReconciliationError) {
          logger.error({
            msg: 'statement: wallet does not reconcile',
            party,
            error: error.message,
          });
          return reply.code(409).send({
            error: {
              code: 'STATEMENT_DOES_NOT_RECONCILE',
              message: error.message,
              figures: error.figures,
            },
          });
        }
        throw error;
      }
      if (!document) return reply.code(404).send(NOT_FOUND);

      const name = statementFileName(document, file.format);
      void reply.header('Content-Disposition', `attachment; filename="${name}"`);
      void reply.header('Cache-Control', 'private, no-store');

      if (file.format === 'csv') {
        return reply.type('text/csv; charset=utf-8').send(statementCsv(document));
      }
      let pdf: Buffer;
      try {
        pdf = await statementPdf(document.html);
      } catch (error) {
        // No Chrome, or it would not start: say so, rather than a bare 500.
        logger.error({ msg: 'statement: PDF could not be printed', party, error: String(error) });
        void reply.removeHeader('Content-Disposition');
        return reply.code(503).send({
          error: {
            code: 'PDF_UNAVAILABLE',
            message: 'The PDF could not be produced right now. The CSV is available.',
          },
        });
      }
      return reply.type('application/pdf').send(pdf);
    }
  );
}
