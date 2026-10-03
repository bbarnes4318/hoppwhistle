/**
 * The pieces the CPA and CPL Agreements share word for word: the parties
 * table, the delivery terms and the payment terms tables.
 */

import {
  esc,
  formatDeliveryDays,
  formatDeliveryHours,
  formatFirstDeliveryDay,
  formatIsoDate,
} from '../format.js';
import { agencyCell, hasPrincipal, kvTable } from '../layout.js';
import type { FrozenTerms } from '../terms.js';

export function partiesTable(terms: FrozenTerms): string {
  const a = terms.agency;
  return kvTable([
    ['NETENROLL ENTITY', 'PVN LLC d/b/a NetEnroll, a Florida limited liability company'],
    ['AGENCY LEGAL NAME', agencyCell(a, x => esc(x.legalName))],
    ['STATE / ENTITY TYPE', agencyCell(a, x => esc(x.stateEntityType))],
    ...(hasPrincipal(a)
      ? [
          [
            'PRINCIPAL NAME & TITLE',
            agencyCell(a, x => `${esc(x.principalName)}, ${esc(x.principalTitle)}`),
          ] as [string, string],
        ]
      : []),
    [
      'BILLING EMAIL & PHONE',
      agencyCell(a, x => `${esc(x.billingEmail)} · ${esc(x.billingPhone)}`),
    ],
    ['MSA EFFECTIVE DATE', esc(formatIsoDate(terms.msaEffectiveDate))],
  ]);
}

export function deliveryTable(schedule: {
  deliveryDays: string[];
  deliveryStart: string;
  deliveryEnd: string;
  firstDeliveryDay: string | null;
}): string {
  return kvTable([
    ['DELIVERY DAYS', esc(formatDeliveryDays(schedule.deliveryDays))],
    ['DELIVERY HOURS', esc(formatDeliveryHours(schedule.deliveryStart, schedule.deliveryEnd))],
    ['FIRST DELIVERY DAY', esc(formatFirstDeliveryDay(schedule.firstDeliveryDay))],
    [
      'OVERRUN',
      'None. Delivery pauses for the day once the Daily Block is reached and stops when the prepaid balance is used.',
    ],
  ]);
}

export function paymentTable(): string {
  return kvTable([
    ['PAYMENT METHOD', 'Prepaid invoice through Melio · card or bank payment'],
    ['BILLING BASIS', 'Paid in full upfront. No daily debits and no overrun charges.'],
  ]);
}

export const DASH = '—';
