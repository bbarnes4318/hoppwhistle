/**
 * Sample Feedback & Roadmap data, for a demo or a screenshot. Never real
 * requests, and never on a real agency.
 *
 *   pnpm --filter @hopwhistle/api db:seed:feedback-demo -- --tenant <slug>
 *
 * ── What it refuses ──────────────────────────────────────────────────────────
 *
 * It writes only into a tenant marked `isNonProduction` (a demo, a fixture, a
 * workspace -- see `Tenant.isNonProduction`). A real agency is refused by
 * name, whatever its brand: these are invented requests, and on a production
 * portal they would read as things that agency's agents actually asked for.
 *
 * ── How it is labelled ───────────────────────────────────────────────────────
 *
 * Every request it writes carries `clientContext.sample = "product-feedback-demo-seed"`,
 * which the product team's console shows as "Sample data", and which is how a
 * re-run finds and replaces what the last run wrote. Interest on the public
 * items comes from a separate non-production tenant of sample voters, so the
 * demo agency's own roster is left as it was.
 */

import { PrismaClient, type ProductFeedbackStatus } from '@prisma/client';

const prisma = new PrismaClient();
const SAMPLE_TAG = 'product-feedback-demo-seed';
const VOTER_TENANT_SLUG = 'feedback-demo-voters';
const DAY = 86_400_000;

function arg(name: string): string | null {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 ? (process.argv[at + 1] ?? null) : null;
}

function daysAgo(days: number, hour = 15): Date {
  const d = new Date(Date.now() - days * DAY);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}

interface SampleItem {
  title: string;
  publicTitle?: string;
  description: string;
  publicSummary?: string;
  category: 'IDEA' | 'IMPROVEMENT' | 'PROBLEM' | 'WORKFLOW' | 'COMPLAINT' | 'OTHER';
  productArea: string;
  visibility: 'PRIVATE' | 'TENANT' | 'PUBLIC';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  /** Statuses reached, oldest first, with how many days ago. */
  path: Array<[ProductFeedbackStatus, number]>;
  target?: { kind: 'WEEK' | 'MONTH' | 'QUARTER' | 'DATE'; date: Date };
  /** Which tenant user submitted it: an index into the tenant's agents. */
  submitter: number;
  voters: number;
  updates?: Array<{
    kind: 'PUBLIC_UPDATE' | 'QUESTION' | 'INTERNAL_NOTE';
    daysAgo: number;
    headline?: string;
    body: string;
  }>;
  replies?: Array<{ daysAgo: number; body: string }>;
}

function samples(): SampleItem[] {
  const now = new Date();
  const nextWeek = new Date(mondayOf(now).getTime() + 7 * DAY);
  const thisWeek = mondayOf(now);
  const quarter = new Date(
    Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1)
  );
  const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return [
    {
      title: 'Medication entry takes too many clicks',
      publicTitle: 'Faster medication entry in the quoter',
      description:
        'Every medication has to be searched, picked and confirmed one at a time. On a client with eight prescriptions that is most of the call.',
      publicSummary:
        'Add several medications at once, with search that understands brand and generic names.',
      category: 'IMPROVEMENT',
      productArea: '/quote',
      visibility: 'PUBLIC',
      priority: 'HIGH',
      path: [
        ['NEW', 24],
        ['UNDER_REVIEW', 23],
        ['PLANNED', 20],
        ['IN_PROGRESS', 6],
      ],
      target: { kind: 'WEEK', date: nextWeek },
      submitter: 1,
      voters: 13,
      updates: [
        {
          kind: 'PUBLIC_UPDATE',
          daysAgo: 20,
          headline: 'Planning update',
          body: 'This is planned for the next quoter release. We are combining it with the carrier-specific medication questions so both ship together.',
        },
        {
          kind: 'INTERNAL_NOTE',
          daysAgo: 9,
          body: 'Carrier medication lists need refreshing first; owner checking the import.',
        },
        {
          kind: 'PUBLIC_UPDATE',
          daysAgo: 2,
          headline: 'Development update',
          body: 'We have completed the redesigned medication search and are now testing carrier-specific medication questions.',
        },
      ],
    },
    {
      title: 'Automatic follow-up reminders',
      description:
        'When a prospect asks me to call back on Thursday at 4, I want the CRM to remind me then instead of relying on a sticky note.',
      publicSummary:
        'Schedule a callback from a call or a CRM record and get reminded at the right time.',
      category: 'IDEA',
      productArea: '/insurance-leads',
      visibility: 'PUBLIC',
      path: [
        ['NEW', 30],
        ['UNDER_REVIEW', 28],
        ['PLANNED', 12],
      ],
      target: { kind: 'QUARTER', date: quarter },
      submitter: 2,
      voters: 8,
      updates: [
        {
          kind: 'PUBLIC_UPDATE',
          daysAgo: 12,
          headline: 'Planning update',
          body: 'We are combining this request with the upcoming CRM follow-up workflow.',
        },
      ],
    },
    {
      title: 'Call disposition takes too long after every call',
      publicTitle: 'One-step call disposition',
      description:
        'After each call I click through three screens to disposition it. Most of my calls end the same two ways.',
      publicSummary: 'Disposition the common outcomes in one click from the softphone.',
      category: 'WORKFLOW',
      productArea: '/calls',
      visibility: 'PUBLIC',
      path: [
        ['NEW', 19],
        ['UNDER_REVIEW', 18],
        ['PLANNED', 15],
        ['IN_PROGRESS', 9],
        ['TESTING', 1],
      ],
      target: { kind: 'WEEK', date: thisWeek },
      submitter: 2,
      voters: 5,
      updates: [
        {
          kind: 'PUBLIC_UPDATE',
          daysAgo: 1,
          headline: 'Testing',
          body: 'The one-click outcomes are with a small group of agents for testing this week.',
        },
      ],
    },
    {
      title: 'Quote comparison layout is difficult to scan',
      description:
        'With six carriers on screen the monthly premiums are hard to compare. I would like the cheapest plan highlighted and the columns lined up.',
      category: 'IMPROVEMENT',
      productArea: '/quote',
      visibility: 'TENANT',
      path: [
        ['NEW', 1],
        ['UNDER_REVIEW', 0],
      ],
      submitter: 0,
      voters: 2,
    },
    {
      title: 'Callback reminders do not show which lead they are for',
      description: 'The reminder pops up but it does not say who I am meant to call back.',
      category: 'PROBLEM',
      productArea: '/insurance-leads',
      visibility: 'PRIVATE',
      path: [
        ['NEW', 4],
        ['UNDER_REVIEW', 3],
        ['NEEDS_INFO', 3],
      ],
      submitter: 0,
      voters: 0,
      updates: [
        {
          kind: 'QUESTION',
          daysAgo: 3,
          headline: 'Question from the product team',
          body: 'When this happens, are you opening the reminder from the bell or from the lead list?',
        },
      ],
    },
    {
      title: 'Show carrier underwriting notes beside each quote',
      description: 'Knowing why a carrier declined would save a call to underwriting.',
      publicSummary: 'Show each carrier’s underwriting reason next to its quote.',
      category: 'IDEA',
      productArea: '/quote',
      visibility: 'PUBLIC',
      path: [
        ['NEW', 11],
        ['UNDER_REVIEW', 10],
        ['CONSIDERING', 8],
      ],
      submitter: 1,
      voters: 3,
    },
    {
      title: 'Improved Final Expense quote workflow',
      description:
        'Medication questions jump below the screen while I am typing, so I lose my place on the call.',
      publicSummary:
        'Medication questions now stay visible in context and no longer appear unexpectedly below the viewport.',
      category: 'PROBLEM',
      productArea: '/quote',
      visibility: 'PUBLIC',
      path: [
        ['NEW', 40],
        ['UNDER_REVIEW', 39],
        ['PLANNED', 35],
        ['IN_PROGRESS', 25],
        ['TESTING', 14],
        ['SHIPPED', 8],
      ],
      submitter: 2,
      voters: 17,
      updates: [
        {
          kind: 'PUBLIC_UPDATE',
          daysAgo: 8,
          headline: 'Released',
          body: 'Medication questions now remain visible in context and no longer appear unexpectedly below the viewport.',
        },
      ],
    },
    {
      title: 'Lead list loads slowly first thing in the morning',
      publicTitle: 'Faster lead list at the start of the day',
      description: 'Between 8 and 9 the CRM lead list takes ten seconds or more to load.',
      publicSummary: 'The lead list now loads in under a second, even at the morning peak.',
      category: 'PROBLEM',
      productArea: '/insurance-leads',
      visibility: 'PUBLIC',
      path: [
        ['NEW', 33],
        ['UNDER_REVIEW', 33],
        ['IN_PROGRESS', 30],
        ['SHIPPED', 21],
      ],
      submitter: 1,
      voters: 6,
      updates: [
        {
          kind: 'PUBLIC_UPDATE',
          daysAgo: 21,
          headline: 'Released',
          body: 'The lead list now loads in under a second at the morning peak.',
        },
      ],
    },
    {
      title: 'Let agents edit an application after it is submitted',
      description: 'Sometimes I notice a typo right after I submit.',
      category: 'IDEA',
      productArea: '/applications',
      visibility: 'TENANT',
      path: [
        ['NEW', 16],
        ['UNDER_REVIEW', 15],
        ['NOT_PLANNED', 10],
      ],
      submitter: 2,
      voters: 1,
      updates: [
        {
          kind: 'PUBLIC_UPDATE',
          daysAgo: 10,
          headline: "Why this isn't planned",
          body: 'Carriers require a submitted application to stay exactly as it was signed. We are exploring a "request a correction" flow that goes to the carrier instead.',
        },
      ],
    },
    {
      title: 'Bulk-assign leads from the CRM',
      description: 'I want to hand fifty leads to a new agent without opening each one.',
      category: 'WORKFLOW',
      productArea: '/insurance-leads',
      visibility: 'PRIVATE',
      path: [['NEW', 0]],
      target: undefined,
      submitter: 1,
      voters: 0,
    },
    {
      title: 'Monthly production summary emailed to each agent',
      description: 'Agents ask for a summary of their month.',
      category: 'IDEA',
      productArea: '/dashboard',
      visibility: 'PUBLIC',
      path: [
        ['NEW', 6],
        ['UNDER_REVIEW', 5],
        ['PLANNED', 4],
      ],
      target: { kind: 'MONTH', date: nextMonth },
      submitter: 1,
      voters: 4,
    },
  ];
}

async function main() {
  const slug = arg('tenant');
  if (!slug) {
    console.error('Usage: db:seed:feedback-demo -- --tenant <slug of a non-production tenant>');
    process.exit(1);
  }
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    console.error(`No tenant with slug "${slug}".`);
    process.exit(1);
  }
  if (!tenant.isNonProduction) {
    console.error(
      `REFUSED: "${tenant.name}" is a production agency. Sample feedback would read as real requests from its agents. Mark a demo tenant isNonProduction and seed that.`
    );
    process.exit(1);
  }

  const people = await prisma.user.findMany({
    where: { tenantId: tenant.id, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    include: { roles: { include: { role: true } } },
  });
  const agents = people.filter(p => p.roles.some(r => r.role.name === 'AGENT'));
  if (agents.length === 0) {
    console.error(`"${tenant.name}" has no active agents to attribute sample feedback to.`);
    process.exit(1);
  }
  const submitter = (index: number) => agents[index % agents.length];

  // Sample voters for the public items: a non-production tenant of their own.
  let voterTenant = await prisma.tenant.findUnique({ where: { slug: VOTER_TENANT_SLUG } });
  if (!voterTenant) {
    voterTenant = await prisma.tenant.create({
      data: {
        name: 'Feedback demo voters',
        slug: VOTER_TENANT_SLUG,
        status: 'ACTIVE',
        isNonProduction: true,
      },
    });
  }
  const voters = [];
  for (let i = 0; i < 18; i++) {
    const email = `feedback-demo-voter-${i + 1}@example.invalid`;
    voters.push(
      (await prisma.user.findFirst({ where: { email, tenantId: voterTenant.id } })) ??
        (await prisma.user.create({
          data: {
            email,
            tenantId: voterTenant.id,
            firstName: 'Sample',
            lastName: `Voter ${i + 1}`,
            status: 'INACTIVE',
          },
        }))
    );
  }

  // Replace whatever the last run wrote.
  const removed = await prisma.productFeedback.deleteMany({
    where: { tenantId: tenant.id, clientContext: { path: ['sample'], equals: SAMPLE_TAG } },
  });

  const staff = await prisma.platformAdmin.findFirst({ select: { userId: true } });
  for (const sample of samples()) {
    const [firstStatus, firstDays] = sample.path[0];
    const [lastStatus, lastDays] = sample.path[sample.path.length - 1];
    const author = submitter(sample.submitter);
    const created = daysAgo(firstDays, 14);
    const lastPublic = Math.min(
      lastDays,
      ...(sample.updates ?? []).filter(u => u.kind !== 'INTERNAL_NOTE').map(u => u.daysAgo)
    );
    const item = await prisma.productFeedback.create({
      data: {
        tenantId: tenant.id,
        submittedByUserId: author.id,
        submittedByRole: 'AGENT',
        title: sample.title,
        // A public item always has a roadmap title (the API requires one).
        publicTitle: sample.publicTitle ?? (sample.visibility === 'PUBLIC' ? sample.title : null),
        description: sample.description,
        publicSummary: sample.publicSummary ?? null,
        category: sample.category,
        productArea: sample.productArea,
        status: lastStatus,
        priority: sample.priority ?? 'NORMAL',
        visibility: sample.visibility,
        targetKind: sample.target?.kind ?? 'NONE',
        targetDate: sample.target?.date ?? null,
        shippedAt: lastStatus === 'SHIPPED' ? daysAgo(lastDays, 16) : null,
        clientContext: { sample: SAMPLE_TAG },
        createdAt: created,
        lastPublicActivityAt: daysAgo(lastPublic, 16),
        lastStaffReplyAt: sample.updates?.length
          ? daysAgo(Math.min(...sample.updates.map(u => u.daysAgo)), 16)
          : null,
        assignedToUserId: staff?.userId ?? null,
      },
    });
    let previous: ProductFeedbackStatus | null = null;
    for (const [status, days] of sample.path) {
      await prisma.productFeedbackStatusEvent.create({
        data: {
          feedbackId: item.id,
          fromStatus: previous,
          toStatus: status,
          actorUserId:
            status === firstStatus && previous === null ? author.id : (staff?.userId ?? null),
          createdAt: daysAgo(days, status === firstStatus ? 14 : 16),
        },
      });
      previous = status;
    }
    for (const update of sample.updates ?? []) {
      await prisma.productFeedbackComment.create({
        data: {
          feedbackId: item.id,
          kind: update.kind,
          authorUserId: staff?.userId ?? null,
          headline: update.headline ?? null,
          body: update.body,
          createdAt: daysAgo(update.daysAgo, 16),
        },
      });
    }
    await prisma.productFeedbackVote.create({
      data: { feedbackId: item.id, userId: author.id, tenantId: tenant.id, createdAt: created },
    });
    await prisma.productFeedbackRead.create({
      data: { feedbackId: item.id, userId: author.id, lastReadAt: daysAgo(firstDays, 14) },
    });
    // Interest: the agency's other agents first, then sample voters on the
    // public roadmap only.
    const others = agents.filter(a => a.id !== author.id).slice(0, sample.voters);
    const fromVoters =
      sample.visibility === 'PUBLIC'
        ? voters.slice(0, Math.max(0, sample.voters - others.length))
        : [];
    await prisma.productFeedbackVote.createMany({
      data: [
        ...others.map(a => ({ feedbackId: item.id, userId: a.id, tenantId: tenant.id })),
        ...fromVoters.map(v => ({ feedbackId: item.id, userId: v.id, tenantId: voterTenant.id })),
      ],
      skipDuplicates: true,
    });
    // Each agent last opened it three days ago, so only what the product team
    // posted since then reads as a new update -- as it would for a real agent.
    await prisma.productFeedbackRead.createMany({
      data: others.map(a => ({
        feedbackId: item.id,
        userId: a.id,
        lastReadAt: daysAgo(Math.min(3, firstDays), 9),
      })),
      skipDuplicates: true,
    });
  }

  console.log(
    `Sample Feedback & Roadmap data written to "${tenant.name}" (replaced ${removed.count} earlier sample requests).`
  );
}

main()
  .catch(error => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
