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
import { kvTable } from '../layout.js';
import type { FrozenTerms } from '../terms.js';

export function partiesTable(terms: FrozenTerms): string {
  const a = terms.agency;
  return kvTable([
    ['NETENROLL ENTITY', 'PVN LLC d/b/a NetEnroll, a Florida limited liability company'],
    ['AGENCY LEGAL NAME', esc(a.legalName)],
    ['STATE / ENTITY TYPE', esc(a.stateEntityType)],
    ['PRINCIPAL NAME & TITLE', `${esc(a.principalName)}, ${esc(a.principalTitle)}`],
    ['BILLING EMAIL & PHONE', `${esc(a.billingEmail)} · ${esc(a.billingPhone)}`],
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
