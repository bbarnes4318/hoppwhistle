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

export const termsSchema = z
  .object({
    agency: z.object({
      legalName: z.string().trim().min(1).max(200),
      stateEntityType: z.string().trim().min(1).max(120),
      noticeAddress: z.string().trim().min(1).max(300),
      principalName: z.string().trim().min(1).max(200),
      principalTitle: z.string().trim().min(1).max(120),
      noticeEmail: z.string().trim().email(),
      noticePhone: PHONE,
      billingEmail: z.string().trim().email(),
      billingPhone: PHONE,
    }),
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
    netenroll: z
      .object({ noticeAddress: z.string(), noticeEmail: z.string() })
      .optional(),
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

/** The first message of a zod failure, for a 422 a person can act on. */
export function firstIssueMessage(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request';
  const path = issue.path.join('.');
  return issue.code === 'custom' || !path ? issue.message : `${path}: ${issue.message}`;
}
