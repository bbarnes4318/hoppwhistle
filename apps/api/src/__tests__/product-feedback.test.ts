/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-explicit-any -- assertions run over parsed JSON responses, which are dynamically typed */
import { RoleName } from '@prisma/client';
import Fastify, { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { grantPlatformAdmin } from '../lib/platform-admin.js';
import { getPrismaClient } from '../lib/prisma.js';
import { registerApiV1Auth } from '../middleware/api-v1-auth.js';
import { registerReadOnlyPreview } from '../middleware/read-only-preview.js';
import { registerStaffOnly } from '../middleware/staff-only.js';

import { announceSkip, databaseGate } from './helpers/live-services.js';

/**
 * Feedback & Roadmap.
 *
 *   /api/v1/feedback...                 an agency's agents, managers and admins
 *   /api/v1/admin/product-feedback...   the product team (platform admins)
 *
 * Seeds Life Leads Plus (white-label) with its owner, two agents, a manager
 * and a publisher login; a second, unrelated agency with an owner and an
 * agent; and a platform operator. The isolation tests are the point: another
 * agency's private request is a 404, internal notes are never in an agency
 * response, and nothing on the agency side changes a staff field.
 */

const sendMail = vi.fn<[message: any], Promise<{ accepted: string[] }>>();
vi.mock('nodemailer', () => ({
  createTransport: () => ({ sendMail }),
  default: { createTransport: () => ({ sendMail }) },
}));

const gate = databaseGate();
announceSkip('Product feedback', gate);

const TEST_JWT_SECRET = 'product-feedback-suite-secret-not-used-anywhere-else';
process.env.JWT_SECRET ??= TEST_JWT_SECRET;

describe('Product feedback suite wiring', () => {
  it('runs against a real database when running in CI', () => {
    if (!process.env.CI) return;
    expect(gate.available, `product feedback suite cannot run: ${gate.reason}`).toBe(true);
  });
});

type Who = { userId: string; tenantId: string | null };

describe.skipIf(!gate.available)('Feedback & Roadmap', () => {
  let prisma: ReturnType<typeof getPrismaClient>;
  let app: FastifyInstance;
  let llp: {
    id: string;
    owner: Who;
    agentA: Who;
    agentB: Who;
    manager: Who;
    publisher: Who;
    agentAEmail: string;
  };
  let other: { id: string; owner: Who; agent: Who };
  let staff: Who;

  const SMTP_KEYS = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM', 'APP_URL'] as const;
  const savedEnv: Record<string, string | undefined> = {};

  async function buildApp(): Promise<FastifyInstance> {
    const instance = Fastify();
    await instance.register(import('@fastify/jwt'), { secret: TEST_JWT_SECRET });
    await instance.register(import('@fastify/cookie'), { secret: TEST_JWT_SECRET });
    registerApiV1Auth(instance);
    registerReadOnlyPreview(instance);
    registerStaffOnly(instance);
    const { registerProductFeedbackRoutes } = await import('../routes/product-feedback.js');
    await instance.register(registerProductFeedbackRoutes);
    await instance.ready();
    return instance;
  }

  const send = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    who: Who,
    payload?: Record<string, unknown>
  ) =>
    app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${app.jwt.sign({ userId: who.userId, tenantId: who.tenantId, email: `${who.userId}@t.local` })}`,
      },
      payload,
    });

  const submit = async (who: Who, overrides: Record<string, unknown> = {}) => {
    const res = await send('POST', '/api/v1/feedback', who, {
      category: 'IMPROVEMENT',
      title: 'Medication entry takes too many clicks',
      description: 'Every medication has to be searched and confirmed one at a time.',
      productArea: '/quote',
      ...overrides,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json().data;
  };

  const triage = (id: string, body: Record<string, unknown>) =>
    send('PATCH', `/api/v1/admin/product-feedback/${id}`, staff, body);

  beforeAll(async () => {
    for (const key of SMTP_KEYS) savedEnv[key] = process.env[key];
    process.env.SMTP_HOST = 'smtp.example.test';
    process.env.SMTP_USER = 'mailer';
    process.env.SMTP_PASSWORD = 'secret';
    process.env.SMTP_FROM = 'noreply@netenroll.com';
    process.env.APP_URL = 'https://agents.netenroll.com';
    app = await buildApp();
  });

  afterAll(async () => {
    for (const key of SMTP_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    await app?.close();
  });

  beforeEach(async () => {
    sendMail.mockReset().mockResolvedValue({ accepted: ['x'] });
    prisma = getPrismaClient();
    for (const table of ['audit_logs', 'roles', 'tenants', 'platform_admins', 'product_feedback']) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`).catch(() => {});
    }
    const roles: Record<string, string> = {};
    for (const name of [
      RoleName.OWNER,
      RoleName.ADMIN,
      RoleName.MANAGER,
      RoleName.AGENT,
      RoleName.PUBLISHER,
    ]) {
      roles[name] = (
        await prisma.role.create({ data: { name, description: name, permissions: [] } })
      ).id;
    }
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const user = async (tenantId: string, role: string, tag: string, firstName = 'Pat') =>
      prisma.user.create({
        data: {
          tenantId,
          email: `${tag}-${stamp}@t.test`,
          firstName,
          lastName: tag,
          status: 'ACTIVE',
          roles: { create: { roleId: roles[role] } },
        },
      });
    const who = (u: { id: string; tenantId: string | null }): Who => ({
      userId: u.id,
      tenantId: u.tenantId,
    });

    const llpId = (
      await prisma.tenant.create({
        data: {
          name: 'Life Leads Plus LLC',
          slug: `llp-${stamp}`,
          status: 'ACTIVE',
          whiteLabel: true,
          brandTheme: 'life-leads-plus',
          brandName: 'Life Leads Plus',
        },
      })
    ).id;
    const agentA = await user(llpId, 'AGENT', 'agent-a', 'Alex');
    llp = {
      id: llpId,
      owner: who(await user(llpId, 'OWNER', 'llp-owner')),
      agentA: who(agentA),
      agentAEmail: agentA.email,
      agentB: who(await user(llpId, 'AGENT', 'agent-b', 'Blake')),
      manager: who(await user(llpId, 'MANAGER', 'llp-manager')),
      publisher: who(await user(llpId, 'PUBLISHER', 'llp-publisher')),
    };

    const otherId = (
      await prisma.tenant.create({
        data: { name: 'Other Agency', slug: `other-${stamp}`, status: 'ACTIVE' },
      })
    ).id;
    other = {
      id: otherId,
      owner: who(await user(otherId, 'OWNER', 'other-owner')),
      agent: who(await user(otherId, 'AGENT', 'other-agent')),
    };

    const op = await prisma.user.create({
      data: { email: `operator-${stamp}@netenroll.test`, status: 'ACTIVE', tenantId: null },
    });
    await grantPlatformAdmin(op.id, { note: 'product feedback suite' });
    staff = { userId: op.id, tenantId: null };
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  describe('authorization', () => {
    it('lets a Life Leads Plus agent submit, scoped to their agency from the session', async () => {
      const res = await send('POST', '/api/v1/feedback', llp.agentA, {
        category: 'IDEA',
        title: 'Automatic follow-up reminders',
        description: 'Remind me to call back a prospect at the time they asked for.',
        productArea: '/insurance-leads',
        urgency: 'MEDIUM',
        sourceRoute: '/insurance-leads',
        clientContext: { viewport: '1440x900', timezone: 'America/New_York', secret: 'dropped' },
        // Never read: the agency is the session's.
        tenantId: other.id,
      });
      expect(res.statusCode, res.body).toBe(201);
      const data = res.json().data;
      expect(data).toMatchObject({
        status: 'NEW',
        visibility: 'PRIVATE',
        isMine: true,
        submittedBy: 'You',
        interestCount: 1,
        viewerInterested: true,
        canReply: true,
      });
      expect(data.timeline.map((t: any) => t.status)).toEqual(['NEW']);

      const row = await prisma.productFeedback.findUniqueOrThrow({ where: { id: data.id } });
      expect(row.tenantId).toBe(llp.id);
      expect(row.submittedByUserId).toBe(llp.agentA.userId);
      expect(row.submittedByRole).toBe('AGENT');
      expect(row.clientContext).toEqual({ viewport: '1440x900', timezone: 'America/New_York' });

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'product_feedback.submitted', entityId: data.id },
      });
      expect(audit?.tenantId).toBe(llp.id);
    });

    it('refuses a publisher login and an anonymous caller', async () => {
      expect((await send('GET', '/api/v1/feedback/roadmap', llp.publisher)).statusCode).toBe(403);
      const post = await send('POST', '/api/v1/feedback', llp.publisher, {
        category: 'IDEA',
        title: 'Anything at all',
        description: 'A publisher should not be able to send this.',
      });
      expect(post.statusCode).toBe(403);
      expect((await app.inject({ method: 'GET', url: '/api/v1/feedback' })).statusCode).toBe(401);
    });

    it("keeps an agent's private request from the other agents, and shows it to their owner", async () => {
      const item = await submit(llp.agentA);

      expect((await send('GET', `/api/v1/feedback/${item.id}`, llp.agentB)).statusCode).toBe(404);
      const list = await send('GET', '/api/v1/feedback', llp.agentB);
      expect(list.json().data.map((i: any) => i.id)).not.toContain(item.id);

      const asOwner = await send('GET', `/api/v1/feedback/${item.id}`, llp.owner);
      expect(asOwner.statusCode).toBe(200);
      expect(asOwner.json().data.submittedBy).toBe('Alex agent-a');
      const org = await send('GET', '/api/v1/feedback?view=organization', llp.owner);
      expect(org.json().data.map((i: any) => i.id)).toContain(item.id);
    });

    it('gives the organization view to owners and admins only', async () => {
      expect((await send('GET', '/api/v1/feedback?view=organization', llp.agentA)).statusCode).toBe(
        403
      );
      expect(
        (await send('GET', '/api/v1/feedback?view=organization', llp.manager)).statusCode
      ).toBe(403);
    });

    it("never shows one agency another agency's private feedback, whatever the id", async () => {
      const item = await submit(llp.agentA);
      for (const who of [other.owner, other.agent]) {
        expect((await send('GET', `/api/v1/feedback/${item.id}`, who)).statusCode).toBe(404);
        expect((await send('POST', `/api/v1/feedback/${item.id}/vote`, who)).statusCode).toBe(404);
        expect(
          (await send('POST', `/api/v1/feedback/${item.id}/replies`, who, { body: 'hi' }))
            .statusCode
        ).toBe(404);
        const list = await send('GET', '/api/v1/feedback', who);
        expect(list.json().data).toEqual([]);
        const search = await send('GET', '/api/v1/feedback?q=medication', who);
        expect(search.json().data).toEqual([]);
        const similar = await send('GET', '/api/v1/feedback/similar?q=medication entry', who);
        expect(similar.json().data).toEqual([]);
      }
    });

    it("shows another agency a public roadmap item's public words only", async () => {
      const item = await submit(llp.agentA, {
        description: 'Our agency loses Mrs. Jones every time the medication list reloads.',
      });
      await triage(item.id, {
        visibility: 'PUBLIC',
        status: 'PLANNED',
        publicTitle: 'Faster medication entry',
        publicSummary: 'Enter several medications at once.',
      });

      const res = await send('GET', `/api/v1/feedback/${item.id}`, other.agent);
      expect(res.statusCode).toBe(200);
      // Publishing needs a roadmap title, so the submitter's own never travels.
      const untitled = await submit(llp.agentB, { title: 'My own words about the dialer' });
      const refused = await triage(untitled.id, { visibility: 'PUBLIC' });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error.message).toContain('roadmap title');
      const data = res.json().data;
      expect(data.title).toBe('Faster medication entry');
      expect(data.description).toBe('Enter several medications at once.');
      expect(data.originalTitle).toBeNull();
      expect(data.submittedBy).toBeNull();
      expect(res.body).not.toContain('Mrs. Jones');
      expect(res.body).not.toContain('too many clicks');

      // The submitter still sees their own words.
      const mine = (await send('GET', `/api/v1/feedback/${item.id}`, llp.agentA)).json().data;
      expect(mine.originalTitle).toBe('Medication entry takes too many clicks');
      expect(mine.description).toContain('Mrs. Jones');
    });

    it('never serves an internal note to the agency', async () => {
      const item = await submit(llp.agentA);
      await send('POST', `/api/v1/admin/product-feedback/${item.id}/comments`, staff, {
        kind: 'INTERNAL_NOTE',
        body: 'SECRET: carrier API is rate limited, blocked until Q1',
      });
      await send('POST', `/api/v1/admin/product-feedback/${item.id}/comments`, staff, {
        kind: 'PUBLIC_UPDATE',
        headline: 'Development update',
        body: 'We have started on the redesigned medication search.',
      });

      for (const who of [llp.agentA, llp.owner]) {
        const res = await send('GET', `/api/v1/feedback/${item.id}`, who);
        expect(res.body).not.toContain('SECRET');
        expect(res.json().data.thread.map((t: any) => t.kind)).toEqual(['PUBLIC_UPDATE']);
        expect(res.json().data.thread[0].author).toBe('Product Team');
        const list = await send('GET', '/api/v1/feedback?view=mine', who);
        expect(list.body).not.toContain('SECRET');
      }
      // The product team reads both.
      const asStaff = await send('GET', `/api/v1/admin/product-feedback/${item.id}`, staff);
      expect(asStaff.json().data.thread.map((t: any) => t.kind)).toEqual([
        'INTERNAL_NOTE',
        'PUBLIC_UPDATE',
      ]);
    });

    it('refuses every staff route to an agent and to a white-label owner', async () => {
      const item = await submit(llp.agentA);
      for (const who of [llp.agentA, llp.owner]) {
        expect((await send('GET', '/api/v1/admin/product-feedback', who)).statusCode).toBe(403);
        expect(
          (await send('GET', `/api/v1/admin/product-feedback/${item.id}`, who)).statusCode
        ).toBe(403);
        expect(
          (
            await send('PATCH', `/api/v1/admin/product-feedback/${item.id}`, who, {
              status: 'SHIPPED',
              priority: 'CRITICAL',
            })
          ).statusCode
        ).toBe(403);
        expect(
          (
            await send('POST', `/api/v1/admin/product-feedback/${item.id}/comments`, who, {
              kind: 'PUBLIC_UPDATE',
              body: 'We shipped it',
            })
          ).statusCode
        ).toBe(403);
      }
      const row = await prisma.productFeedback.findUniqueOrThrow({ where: { id: item.id } });
      expect(row.status).toBe('NEW');
      expect(row.priority).toBe('NORMAL');
      // There is no agency-side route that writes a staff field at all.
      expect(
        (await send('PATCH', `/api/v1/feedback/${item.id}`, llp.owner, { status: 'SHIPPED' }))
          .statusCode
      ).toBe(404);
      // And no staff-only field reaches the agency response.
      const res = await send('GET', `/api/v1/feedback/${item.id}`, llp.owner);
      for (const field of ['priority', 'assignedTo', 'clientContext', 'sourceRoute']) {
        expect(res.json().data).not.toHaveProperty(field);
      }
    });

    it('lets platform staff see and filter every agency’s feedback', async () => {
      await submit(llp.agentA);
      await submit(other.agent, { title: 'Call disposition takes too long', category: 'WORKFLOW' });

      const all = await send('GET', '/api/v1/admin/product-feedback', staff);
      expect(all.statusCode).toBe(200);
      expect(all.json().meta.total).toBe(2);
      const llpOnly = await send('GET', `/api/v1/admin/product-feedback?tenantId=${llp.id}`, staff);
      expect(llpOnly.json().data.map((r: any) => r.tenant.name)).toEqual(['Life Leads Plus LLC']);
      expect(llpOnly.json().data[0].submittedBy.name).toBe('Alex agent-a');

      const summary = await send('GET', '/api/v1/admin/product-feedback/summary', staff);
      expect(summary.json().data.counts.new).toBe(2);
      expect(summary.json().data.tenants.map((t: any) => t.name)).toContain('Life Leads Plus');
    });
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  describe('lifecycle', () => {
    it('records every status reached, with who changed it, and audits it', async () => {
      const item = await submit(llp.agentA);
      expect((await triage(item.id, { status: 'UNDER_REVIEW' })).statusCode).toBe(200);
      const planned = await triage(item.id, {
        status: 'PLANNED',
        priority: 'HIGH',
        target: { kind: 'QUARTER', date: '2026-11-15' },
      });
      expect(planned.statusCode, planned.body).toBe(200);
      const staffView = planned.json().data;
      expect(staffView.timeline.map((t: any) => [t.from, t.status])).toEqual([
        [null, 'NEW'],
        ['NEW', 'UNDER_REVIEW'],
        ['UNDER_REVIEW', 'PLANNED'],
      ]);
      expect(staffView.target).toMatchObject({
        kind: 'QUARTER',
        date: '2026-10-01',
        label: 'Q4 2026',
      });

      const audit = await prisma.auditLog.findFirst({
        where: { action: 'product_feedback.status_changed', entityId: item.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit?.userId).toBe(staff.userId);
      expect(audit?.changes).toMatchObject({
        before: { status: 'UNDER_REVIEW', priority: 'NORMAL' },
        after: { status: 'PLANNED', priority: 'HIGH' },
      });

      // The agency reads the timeline and target, never the priority.
      const agent = (await send('GET', `/api/v1/feedback/${item.id}`, llp.agentA)).json().data;
      expect(agent.timeline.map((t: any) => t.status)).toEqual(['NEW', 'UNDER_REVIEW', 'PLANNED']);
      expect(agent.target.label).toBe('Q4 2026');
      expect(agent.unread).toBe(true);
    });

    it('emails the submitter, in their agency’s brand, when it is planned', async () => {
      const item = await submit(llp.agentA);
      await triage(item.id, { status: 'PLANNED' });
      expect(sendMail).toHaveBeenCalledTimes(1);
      const message = sendMail.mock.calls[0][0];
      expect(message.to).toBe(llp.agentAEmail);
      expect(message.from).toContain('Life Leads Plus');
      expect(message.subject).toContain('Planned');
      expect(message.text).not.toContain('NetEnroll');
    });

    it('asks for more information, takes the answer, and shows staff it is awaiting them', async () => {
      const item = await submit(llp.agentA);
      await triage(item.id, { visibility: 'TENANT' });

      const noQuestion = await triage(item.id, { status: 'NEEDS_INFO' });
      expect(noQuestion.statusCode).toBe(400);
      const asked = await triage(item.id, {
        status: 'NEEDS_INFO',
        message: { body: 'Are you entering the medication manually or picking it from search?' },
      });
      expect(asked.statusCode, asked.body).toBe(200);

      const before = (await send('GET', `/api/v1/feedback/${item.id}`, llp.agentA)).json().data;
      expect(before.needsReply).toBe(true);
      expect(before.thread.map((t: any) => t.kind)).toEqual(['QUESTION']);
      // Another agent can see the request (TENANT), but not the conversation.
      const colleague = await send('GET', `/api/v1/feedback/${item.id}`, llp.agentB);
      expect(colleague.statusCode).toBe(200);
      expect(colleague.json().data.thread).toEqual([]);
      expect(
        (await send('POST', `/api/v1/feedback/${item.id}/replies`, llp.agentB, { body: 'Me?' }))
          .statusCode
      ).toBe(403);

      const replied = await send('POST', `/api/v1/feedback/${item.id}/replies`, llp.agentA, {
        body: 'From search, every time.',
      });
      expect(replied.statusCode, replied.body).toBe(201);
      expect(replied.json().data.thread.map((t: any) => [t.kind, t.author])).toEqual([
        ['QUESTION', 'Product Team'],
        ['USER_REPLY', 'You'],
      ]);
      expect(replied.json().data.needsReply).toBe(false);

      const summary = (await send('GET', '/api/v1/admin/product-feedback/summary', staff)).json()
        .data;
      expect(summary.counts.awaitingResponse).toBe(1);
      const awaiting = await send('GET', '/api/v1/admin/product-feedback?awaiting=1', staff);
      expect(awaiting.json().data.map((r: any) => r.id)).toEqual([item.id]);

      await triage(item.id, {
        status: 'UNDER_REVIEW',
        message: { body: 'Thanks, that is what we needed.' },
      });
      expect(
        (await send('GET', '/api/v1/admin/product-feedback/summary', staff)).json().data.counts
          .awaitingResponse
      ).toBe(0);
    });

    it('takes one vote per person, and lets it be withdrawn', async () => {
      const item = await submit(llp.agentA);
      await triage(item.id, { visibility: 'TENANT' });

      const first = await send('POST', `/api/v1/feedback/${item.id}/vote`, llp.agentB);
      expect(first.statusCode).toBe(201);
      expect(first.json().data.interestCount).toBe(2);
      const again = await send('POST', `/api/v1/feedback/${item.id}/vote`, llp.agentB);
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe('ALREADY_INTERESTED');
      expect(await prisma.productFeedbackVote.count({ where: { feedbackId: item.id } })).toBe(2);

      const undo = await send('DELETE', `/api/v1/feedback/${item.id}/vote`, llp.agentB);
      expect(undo.statusCode).toBe(200);
      expect(undo.json().data.interestCount).toBe(1);
      expect(
        (await send('DELETE', `/api/v1/feedback/${item.id}/vote`, llp.agentB)).statusCode
      ).toBe(404);
      // The submitter is always following their own.
      expect(
        (await send('DELETE', `/api/v1/feedback/${item.id}/vote`, llp.agentA)).statusCode
      ).toBe(409);
    });

    it('filters My Feedback to what the viewer sent', async () => {
      const mine = await submit(llp.agentA);
      const theirs = await submit(llp.agentB, { title: 'Quote comparison is hard to scan' });
      await triage(theirs.id, { visibility: 'TENANT' });

      const all = (await send('GET', '/api/v1/feedback', llp.agentA)).json().data;
      expect(all.map((i: any) => i.id).sort()).toEqual([mine.id, theirs.id].sort());
      const onlyMine = (await send('GET', '/api/v1/feedback?view=mine', llp.agentA)).json();
      expect(onlyMine.data.map((i: any) => i.id)).toEqual([mine.id]);
      expect(onlyMine.meta.total).toBe(1);
      const roadmap = (await send('GET', '/api/v1/feedback/roadmap', llp.agentA)).json().data;
      expect(roadmap.mine.items.map((i: any) => i.id)).toEqual([mine.id]);
      expect(roadmap.sections.underReview.count).toBe(2);
    });

    it('marks a request shipped, tells everyone who wanted it, and closes it to votes', async () => {
      const item = await submit(llp.agentA);
      await triage(item.id, {
        visibility: 'PUBLIC',
        status: 'IN_PROGRESS',
        publicTitle: 'Faster medication entry',
      });
      await send('POST', `/api/v1/feedback/${item.id}/vote`, other.agent);
      sendMail.mockClear();

      const shipped = await triage(item.id, {
        status: 'SHIPPED',
        message: { body: 'Medications can now be added in one step.' },
      });
      expect(shipped.statusCode).toBe(200);
      expect(shipped.json().data.shippedAt).not.toBeNull();
      expect(sendMail).toHaveBeenCalledTimes(2);

      const roadmap = (await send('GET', '/api/v1/feedback/roadmap', other.agent)).json().data;
      expect(roadmap.sections.recentlyShipped.items.map((i: any) => i.id)).toEqual([item.id]);
      const shippedCard = roadmap.sections.recentlyShipped.items[0];
      expect(shippedCard.interestCount).toBe(2);
      expect(shippedCard.unread).toBe(true);
      expect(shippedCard.latestUpdate.headline).toBe('Released');
      expect(roadmap.unreadCount).toBe(1);

      await send('POST', `/api/v1/feedback/${item.id}/read`, other.agent);
      expect(
        (await send('GET', '/api/v1/feedback/roadmap', other.agent)).json().data.unreadCount
      ).toBe(0);
      expect((await send('POST', `/api/v1/feedback/${item.id}/vote`, llp.agentB)).statusCode).toBe(
        409
      );
    });

    it('explains a decision not to build something instead of deleting it', async () => {
      const item = await submit(llp.agentA);
      const res = await triage(item.id, {
        status: 'NOT_PLANNED',
        message: { body: 'It would conflict with carrier-specific underwriting requirements.' },
      });
      expect(res.statusCode).toBe(200);
      const agent = (await send('GET', `/api/v1/feedback/${item.id}`, llp.agentA)).json().data;
      expect(agent.status).toBe('NOT_PLANNED');
      expect(agent.thread[0]).toMatchObject({
        kind: 'PUBLIC_UPDATE',
        headline: "Why this isn't planned",
      });
    });

    it('merges a duplicate, moving its interest to the request it joins', async () => {
      const target = await submit(llp.agentB, { title: 'Faster medication entry' });
      await triage(target.id, {
        visibility: 'PUBLIC',
        status: 'PLANNED',
        publicTitle: 'Faster medication entry',
      });
      const dup = await submit(other.agent, { title: 'Medication search is slow' });

      const merged = await send('POST', `/api/v1/admin/product-feedback/${dup.id}/merge`, staff, {
        targetId: target.id,
      });
      expect(merged.statusCode, merged.body).toBe(200);
      expect(merged.json().data.status).toBe('MERGED');
      expect(await prisma.productFeedbackVote.count({ where: { feedbackId: target.id } })).toBe(2);

      const mine = (await send('GET', '/api/v1/feedback?view=mine', other.agent)).json().data;
      expect(mine[0]).toMatchObject({ status: 'MERGED', mergedInto: { id: target.id } });
      const all = (await send('GET', '/api/v1/feedback', other.agent)).json().data;
      expect(all.map((i: any) => i.id)).toEqual([target.id]);
      expect(all[0].viewerInterested).toBe(true);
    });

    it("refuses to merge into a request the duplicate's agency cannot see", async () => {
      const privateTarget = await submit(llp.agentA);
      const dup = await submit(other.agent);
      const res = await send('POST', `/api/v1/admin/product-feedback/${dup.id}/merge`, staff, {
        targetId: privateTarget.id,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().error.code).toBe('TARGET_NOT_VISIBLE');
    });

    it('finds similar requests from the words of a draft title', async () => {
      const item = await submit(llp.agentA, {
        title: 'Automatic follow-up reminders for callbacks',
      });
      await triage(item.id, { visibility: 'TENANT' });
      const res = await send('GET', '/api/v1/feedback/similar?q=Callback reminders', llp.agentB);
      expect(res.json().data.map((i: any) => i.id)).toEqual([item.id]);
      const none = await send('GET', '/api/v1/feedback/similar?q=the and for', llp.agentB);
      expect(none.json().data).toEqual([]);
    });

    it('validates what is sent', async () => {
      const res = await send('POST', '/api/v1/feedback', llp.agentA, {
        category: 'RANT',
        title: 'x',
        description: 'short',
        productArea: 'javascript:alert(1)',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.problems.length).toBeGreaterThanOrEqual(3);
      const item = await submit(llp.agentA);
      expect((await triage(item.id, { status: 'MERGED' })).statusCode).toBe(400);
      expect((await triage(item.id, { assignedToUserId: llp.agentA.userId })).statusCode).toBe(400);
      expect((await triage(item.id, { assignedToUserId: staff.userId })).statusCode).toBe(200);
    });

    it('puts a product-team item on the roadmap for every agency', async () => {
      const res = await send('POST', '/api/v1/admin/product-feedback', staff, {
        title: 'Carrier-specific medication questions',
        description: 'Ask the medication questions each carrier actually underwrites on.',
        category: 'IMPROVEMENT',
        status: 'IN_PROGRESS',
        target: { kind: 'MONTH', date: '2026-11-03' },
      });
      expect(res.statusCode, res.body).toBe(201);
      for (const who of [llp.agentA, other.agent]) {
        const roadmap = (await send('GET', '/api/v1/feedback/roadmap', who)).json().data;
        expect(roadmap.sections.inProgress.items[0]).toMatchObject({
          fromProductTeam: true,
          submittedBy: null,
        });
      }
      const privateStaffItem = await send('POST', '/api/v1/admin/product-feedback', staff, {
        title: 'Nobody could see this',
        description: 'A private item that belongs to no agency.',
        category: 'IDEA',
        visibility: 'PRIVATE',
      });
      expect(privateStaffItem.statusCode).toBe(400);
    });
  });
});
