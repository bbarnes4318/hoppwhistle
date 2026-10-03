/**
 * The agreement form, as the platform admin fills it and as it is frozen onto
 * the envelope (`AgreementEnvelope.terms`).
 *
 * Validated once, on create and preview. After that the JSON is never updated
 * -- a database trigger refuses it -- so what is rendered from it at send, and
 * what the signer agreed to, can always be reproduced from the row.
 */

import { z } from 'zod';

export const VERTICALS = ['FE', 'MEDICARE', 'ACA'] as const;
export type Vertical = (typeof VERTICALS)[number];

export const VERTICAL_NAMES: Record<Vertical, string> = {
  FE: 'Final Expense',
  MEDICARE: 'Medicare',
  ACA: 'ACA (Health)',
};

export const DAY_KEYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export type DayKey = (typeof DAY_KEYS)[number];

const DATE = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine(value => {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Not a real date');

const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

/** Two decimal places at most, as money is written on the agreement. */
const RATE = z
  .number()
  .finite()
  .refine(value => Math.abs(Math.round(value * 100) - value * 100) < 1e-6, 'At most two decimals');

const cpaVertical = z.object({
  selected: z.boolean(),
  rate: RATE.refine(value => value >= 0, 'Rate cannot be negative'),
  dailyBlock: z.number().int().nullable().optional(),
});

const cplVertical = z.object({
  selected: z.boolean(),
  rate: RATE.nullable().optional(),
  bufferSeconds: z.number().int().nullable().optional(),
  dailyBlock: z.number().int().nullable().optional(),
});

const schedule = {
  deliveryDays: z
    .array(z.enum(DAY_KEYS))
    .min(1, 'Choose at least one delivery day')
    .transform(days => DAY_KEYS.filter(day => days.includes(day))),
  deliveryStart: TIME,
  deliveryEnd: TIME,
  firstDeliveryDay: DATE.nullable(),
};

const PHONE = z.string().trim().min(10).max(20);

/**
 * The agency's details as printed in the Parties tables. Filled in by the
 * agency itself when it signs (see `partyDetailsSchema` and `agencyFromParty`);
 * envelopes sent before that existed carry them here, entered by NetEnroll.
 * An individual licensed agent has no principal, so those are optional.
 */
const agencySchema = z.object({
  kind: z.enum(['BUSINESS', 'INDIVIDUAL']).optional(),
  legalName: z.string().trim().min(1).max(200),
  stateEntityType: z.string().trim().min(1).max(160),
  noticeAddress: z.string().trim().min(1).max(300),
  principalName: z.string().trim().min(1).max(200).optional(),
  principalTitle: z.string().trim().min(1).max(120).optional(),
  noticeEmail: z.string().trim().email(),
  noticePhone: PHONE,
  billingEmail: z.string().trim().email(),
  billingPhone: PHONE,
});
export type AgencyDetails = z.infer<typeof agencySchema>;

export const termsSchema = z
  .object({
    agency: agencySchema.optional(),
    effectiveDate: DATE,
    msaEffectiveDate: DATE,
    cpa: z
      .object({
        verticals: z.object({ FE: cpaVertical, MEDICARE: cpaVertical, ACA: cpaVertical }),
        ...schedule,
      })
      .optional(),
    cpl: z
      .object({
        verticals: z.object({ FE: cplVertical, MEDICARE: cplVertical, ACA: cplVertical }),
        ...schedule,
      })
      .optional(),
    netenroll: z.object({ noticeAddress: z.string(), noticeEmail: z.string() }).optional(),
  })
  .superRefine((terms, ctx) => {
    for (const kind of ['cpa', 'cpl'] as const) {
      const campaign = terms[kind];
      if (!campaign) continue;
      const label = kind.toUpperCase();
      const selected = VERTICALS.filter(v => campaign.verticals[v].selected);
      if (selected.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: [kind, 'verticals'],
          message: `Select at least one vertical for the ${label} Agreement.`,
        });
      }
      for (const v of selected) {
        const row = campaign.verticals[v] as {
          rate?: number | null;
          dailyBlock?: number | null;
          bufferSeconds?: number | null;
        };
        if (!(typeof row.rate === 'number' && row.rate > 0)) {
          ctx.addIssue({
            code: 'custom',
            path: [kind, 'verticals', v, 'rate'],
            message: `${label} ${VERTICAL_NAMES[v]}: the rate must be more than zero.`,
          });
        }
        if (!(typeof row.dailyBlock === 'number' && row.dailyBlock >= 1)) {
          ctx.addIssue({
            code: 'custom',
            path: [kind, 'verticals', v, 'dailyBlock'],
            message: `${label} ${VERTICAL_NAMES[v]}: the Daily Block must be a whole number of at least 1.`,
          });
        }
        if (
          kind === 'cpl' &&
          !(
            typeof row.bufferSeconds === 'number' &&
            row.bufferSeconds >= 1 &&
            row.bufferSeconds <= 3600
          )
        ) {
          ctx.addIssue({
            code: 'custom',
            path: [kind, 'verticals', v, 'bufferSeconds'],
            message: `CPL ${VERTICAL_NAMES[v]}: the Buffer Duration must be a whole number of seconds from 1 to 3600.`,
          });
        }
      }
      if (campaign.deliveryEnd <= campaign.deliveryStart) {
        ctx.addIssue({
          code: 'custom',
          path: [kind, 'deliveryEnd'],
          message: `${label}: the delivery hours must end after they start.`,
        });
      }
    }
  });

export type AgreementTerms = z.infer<typeof termsSchema>;
export type CpaTerms = NonNullable<AgreementTerms['cpa']>;
export type CplTerms = NonNullable<AgreementTerms['cpl']>;

/** The terms as frozen at send: NetEnroll's notice details are always present. */
export type FrozenTerms = AgreementTerms & {
  netenroll: { noticeAddress: string; noticeEmail: string };
};

// ── The agency's own details, entered when it signs ─────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(v => (v ? v : null));

/** What a business enters. Its authorized signer may or may not be its principal. */
const businessParty = z.object({
  kind: z.literal('BUSINESS'),
  legalName: text(200),
  dbaName: optionalText(200),
  stateOfFormation: text(60),
  entityType: text(80),
  noticeAddress: text(300),
  principalName: text(200),
  principalTitle: text(120),
  noticeEmail: z.string().trim().email().max(254),
  noticePhone: PHONE,
  billingEmail: z.string().trim().email().max(254),
  billingPhone: PHONE,
  signerName: z.string().trim().min(2).max(100),
  signerTitle: text(120),
});

/** What an individual licensed agent enters: no entity, no principal. They sign for themselves. */
const individualParty = z.object({
  kind: z.literal('INDIVIDUAL'),
  legalName: z.string().trim().min(2).max(100),
  dbaName: optionalText(200),
  stateOfResidence: text(60),
  noticeAddress: text(300),
  noticeEmail: z.string().trim().email().max(254),
  noticePhone: PHONE,
  billingEmail: z.string().trim().email().max(254),
  billingPhone: PHONE,
});

export const partyDetailsSchema = z.discriminatedUnion('kind', [businessParty, individualParty]);
export type PartyDetails = z.infer<typeof partyDetailsSchema>;

/** How an individual signs on their own behalf. */
export const INDIVIDUAL_SIGNER_TITLE = 'Individually';

/** The agency as the documents print it. */
export function agencyFromParty(party: PartyDetails): AgencyDetails {
  const name = party.dbaName ? `${party.legalName} d/b/a ${party.dbaName}` : party.legalName;
  const common = {
    legalName: name,
    noticeAddress: party.noticeAddress,
    noticeEmail: party.noticeEmail,
    noticePhone: party.noticePhone,
    billingEmail: party.billingEmail,
    billingPhone: party.billingPhone,
  };
  return party.kind === 'BUSINESS'
    ? {
        kind: 'BUSINESS',
        ...common,
        stateEntityType: `${party.stateOfFormation} / ${party.entityType}`,
        principalName: party.principalName,
        principalTitle: party.principalTitle,
      }
    : {
        kind: 'INDIVIDUAL',
        ...common,
        stateEntityType: `${party.stateOfResidence} / Individual (sole proprietor)`,
      };
}

/** Who signs, from the agency's own details. */
export function signerFromParty(party: PartyDetails): { name: string; title: string } {
  return party.kind === 'BUSINESS'
    ? { name: party.signerName, title: party.signerTitle }
    : { name: party.legalName, title: INDIVIDUAL_SIGNER_TITLE };
}

/** The first message of a zod failure, for a 422 a person can act on. */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  return issue.code === 'custom' || !path ? issue.message : `${path}: ${issue.message}`;
}
