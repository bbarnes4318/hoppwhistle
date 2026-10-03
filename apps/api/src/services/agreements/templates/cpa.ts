/**
 * The CPA Agreement (pay per submitted application), template CPA-2026-09-25.
 *
 * The legal text is verbatim and in the approved order -- see the note at the
 * top of msa.ts. Only the agency's terms are substituted, HTML-escaped.
 */

import { esc, money, moneyShort } from '../format.js';
import {
  CHECK_OFF,
  CHECK_ON,
  bullets,
  callout,
  clause,
  documentHtml,
  md,
  para,
  partHeading,
  section,
  signatureBlock,
  type RenderOptions,
} from '../layout.js';
import { VERTICALS, VERTICAL_NAMES, type FrozenTerms } from '../terms.js';

import { DASH, deliveryTable, partiesTable, paymentTable } from './campaign.js';

export const CPA_TITLE = 'CPA Agreement';
export const CPA_TEMPLATE_VERSION = 'CPA-2026-09-25';

/** Schedule 1, §1.9: 20 applications of the first selected vertical. */
export function cpaIllustration(terms: FrozenTerms): {
  vertical: string;
  rate: string;
  total: string;
} {
  const cpa = terms.cpa!;
  const first = VERTICALS.find(v => cpa.verticals[v].selected) ?? 'FE';
  const rate = cpa.verticals[first].rate;
  return {
    vertical: VERTICAL_NAMES[first],
    rate: money(rate),
    total: money(Math.round(rate * 100 * 20) / 100),
  };
}

export function render(terms: FrozenTerms, opts: RenderOptions): string {
  const cpa = terms.cpa;
  if (!cpa) throw new Error('CPA terms are required to render the CPA Agreement');
  const v = cpa.verticals;
  const illustration = cpaIllustration(terms);

  const rows = VERTICALS.map(key => {
    const row = v[key];
    return `<tr><td>${esc(VERTICAL_NAMES[key])}</td><td class="c">${row.selected ? CHECK_ON : CHECK_OFF}</td><td>${esc(money(row.rate))}</td><td>${row.selected && row.dailyBlock != null ? esc(row.dailyBlock) : DASH}</td></tr>`;
  }).join('');

  const body = `
${para(
  'This CPA Agreement (the "**Agreement**") is entered into between **PVN LLC**, a Florida limited liability company doing business as NetEnroll ("**NetEnroll**"), and the agency identified below ("**Agency**"). It is a Campaign Agreement under, and incorporates in full, the NetEnroll Master Services Agreement between the parties (the "**MSA**"). Capitalized terms not defined here have the meanings given in the MSA.'
)}

${callout('AT A GLANCE', [
  [
    'You Pay For',
    'Submitted Applications only. No charge for answered calls, talk time, or calls that do not produce an application.',
  ],
  [
    'Rates',
    `Final Expense ${esc(moneyShort(v.FE.rate))} · Medicare ${esc(moneyShort(v.MEDICARE.rate))} · ACA ${esc(moneyShort(v.ACA.rate))} per Submitted Application`,
  ],
  [
    'When You Pay',
    'Upfront, by invoice through Melio. Card accepted. Delivery begins once payment clears.',
  ],
  [
    'Credits',
    'Prepaid applications do not expire while this Agreement is in force. No overrun, ever.',
  ],
])}

${partHeading('Part 1: Insertion Order', 'Commercial terms, campaign selection and payment terms')}

${section('1. PARTIES', partiesTable(terms))}

${section(
  '2. CAMPAIGN SELECTION AND RATES',
  `${para('Agency selects each vertical it will purchase and states its Daily Block for that vertical.')}
<table class="grid"><thead><tr><th>VERTICAL</th><th>SELECT</th><th>RATE PER SUBMITTED APPLICATION</th><th>DAILY BLOCK (APPLICATIONS)</th></tr></thead><tbody>${rows}</tbody></table>`,
  { newPage: true }
)}

${section('3. DELIVERY TERMS', deliveryTable(cpa))}

${section(
  '4. PAYMENT TERMS',
  `${paymentTable()}
${para(
  "Agency purchases Submitted Applications in advance by paying a NetEnroll invoice issued through Melio, by card or any other payment method offered on the invoice. Delivery begins once payment clears. Each Submitted Application draws down Agency's prepaid balance at the rate for its vertical in Section 2. When the prepaid balance is used, delivery pauses until Agency pays a new invoice. Card payments are subject to Section 8.5 of the MSA."
)}`
)}

${section(
  '5. ACKNOWLEDGEMENTS',
  `${para('By signing below, Agency confirms it has read, understands and accepts the following:')}
${bullets([
  '**Non-Refundable Applications.** Submitted Applications are non-refundable once recorded in the Portal, regardless of whether a carrier later issues, declines or rescinds coverage.',
  '**Prepayment, No Overrun.** Applications are paid for upfront. NetEnroll delivers only what has been prepaid, and delivery pauses when the prepaid balance is used.',
  '**Card Payments.** Agency will not dispute or charge back any card payment for Submitted Applications already delivered. A chargeback is a material breach of the MSA.',
  '**No Outcome Guarantee.** NetEnroll does not guarantee policy issuance, conversion rates, carrier approval, commission earnings or specific caller intent.',
  '**Compliance and Call Recording.** All calls are recorded. Agency is solely responsible for agent conduct, state licensing and telemarketing law compliance.',
  '**Master Services Agreement.** This Agreement is governed by the MSA, which Agency has received, read and accepted.',
])}`
)}

${section(
  '6. SIGNATURES',
  `<p class="witness">${md('IN WITNESS WHEREOF, the parties have executed this CPA Agreement as of the later date signed below.')}</p>
${signatureBlock(opts)}`
)}

${partHeading('Schedule 1: CPA Pricing and Billing Methodology', 'Forms part of the CPA Agreement', true)}

${section(
  'BILLING BASIS',
  [
    clause(
      '1.1',
      '**Pay-Per-Submitted-Application.** Agency pays exclusively for Submitted Applications. Agency incurs no cost for answered calls, talk time, or calls that do not result in a Submitted Application.'
    ),
    clause(
      '1.2',
      `**Flat Rates.** The rates are ${money(v.FE.rate)} per Final Expense application, ${money(v.MEDICARE.rate)} per Medicare application and ${money(v.ACA.rate)} per ACA (Health) application, as stated in Part 1.`
    ),
    clause(
      '1.3',
      '**Submitted Application.** An Application counts once, upon reaching "Submitted" status in the Portal. Carrier underwriting decisions, including approval, rating, declination or later policy lapse, do not alter the fee.'
    ),
    clause(
      '1.4',
      '**Attribution.** A Submitted Application is attributed to the Delivery Day on which it is submitted in the Portal, regardless of when the originating inbound call took place.'
    ),
  ].join('\n')
)}

${section(
  'PREPAYMENT AND DAILY BLOCK',
  [
    clause(
      '1.5',
      "**Prepaid Balance.** Agency buys applications in advance by paying a NetEnroll invoice through Melio. The applications paid for form Agency's prepaid balance for the selected vertical."
    ),
    clause('1.6', '**Drawdown.** Each Submitted Application reduces the prepaid balance by the rate for its vertical.'),
    clause(
      '1.7',
      '**Daily Block.** The Daily Block is the maximum number of Submitted Applications delivered to Agency on a Delivery Day for each selected vertical, as stated in Part 1. Delivery pauses for the rest of the Delivery Day once it is reached.'
    ),
    clause(
      '1.8',
      '**No Overrun.** NetEnroll does not deliver or bill beyond the prepaid balance. When the balance reaches zero, delivery pauses until Agency pays a new invoice.'
    ),
    clause(
      '1.9',
      `**Illustration.** An Agency prepays 20 ${illustration.vertical} applications at ${illustration.rate}, a ${illustration.total} invoice, with a Daily Block of 5. NetEnroll delivers up to 5 Submitted Applications per Delivery Day. After the 20th, delivery pauses until the next invoice is paid. Nothing further is charged.`
    ),
  ].join('\n')
)}

${section(
  'TERM',
  `${clause(
    '1.10',
    '**Term and Termination.** This Agreement continues month to month and may be terminated under Section 15 of the MSA independently of any other Campaign Agreement. Unused prepaid applications are handled under Section 15.5 of the MSA.'
  )}
<div class="end">END OF CPA AGREEMENT</div>`
)}
`;

  return documentHtml({
    title: CPA_TITLE,
    runningHeader: 'CPA AGREEMENT · PAY-PER-APPLICATION',
    tagline: 'PAY-PER-APPLICATION',
    eyebrow: 'PVN LLC D/B/A NETENROLL · CAMPAIGN AGREEMENT',
    heading: 'CPA Agreement',
    subtitle: 'Cost-Per-Acquisition · Pay-Per-Submitted-Application (Flat Rate)',
    body,
    reference: opts.reference,
  });
}
