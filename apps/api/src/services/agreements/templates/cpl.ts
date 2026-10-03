/**
 * The CPL Agreement (pay per billable call), template CPL-2026-09-25.
 *
 * The legal text is verbatim and in the approved order -- see the note at the
 * top of msa.ts. Only the agency's terms are substituted, HTML-escaped.
 */

import { esc, money } from '../format.js';
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

export const CPL_TITLE = 'CPL Agreement';
export const CPL_TEMPLATE_VERSION = 'CPL-2026-09-25';

export function render(terms: FrozenTerms, opts: RenderOptions): string {
  const cpl = terms.cpl;
  if (!cpl) throw new Error('CPL terms are required to render the CPL Agreement');

  const rows = VERTICALS.map(key => {
    const row = cpl.verticals[key];
    const on = row.selected;
    return `<tr><td>${esc(VERTICAL_NAMES[key])}</td><td class="c">${on ? CHECK_ON : CHECK_OFF}</td><td>${on && row.rate != null ? esc(money(row.rate)) : DASH}</td><td>${on && row.bufferSeconds != null ? esc(row.bufferSeconds) : DASH}</td><td>${on && row.dailyBlock != null ? esc(row.dailyBlock) : DASH}</td></tr>`;
  }).join('');

  const body = `
${para(
  'This CPL Agreement (the "**Agreement**") is entered into between **PVN LLC**, a Florida limited liability company doing business as NetEnroll ("**NetEnroll**"), and the agency identified below ("**Agency**"). It is a Campaign Agreement under, and incorporates in full, the NetEnroll Master Services Agreement between the parties (the "**MSA**"). Capitalized terms not defined here have the meanings given in the MSA.'
)}

${callout('AT A GLANCE', [
  [
    'You Pay For',
    'Billable Calls only: answered inbound calls that meet or exceed the agreed Buffer Duration.',
  ],
  [
    'Rates',
    'Fixed rate per Billable Call, set per vertical in Part 1. Calls under the Buffer Duration are free.',
  ],
  [
    'When You Pay',
    'Upfront, by invoice through Melio. Card accepted. Delivery begins once payment clears.',
  ],
  ['Credits', 'Prepaid calls do not expire while this Agreement is in force. No overrun, ever.'],
])}

${partHeading('Part 1: Insertion Order', 'Commercial terms, campaign selection and payment terms')}

${section('1. PARTIES', partiesTable(terms))}

${section(
  '2. CAMPAIGN SELECTION AND RATES',
  `${para('Agency selects each vertical; the parties agree its rate, Buffer Duration and Daily Block.')}
<table class="grid"><thead><tr><th>VERTICAL</th><th>SELECT</th><th>RATE PER BILLABLE CALL</th><th>BUFFER DURATION (SECONDS)</th><th>DAILY BLOCK (BILLABLE CALLS)</th></tr></thead><tbody>${rows}</tbody></table>`,
  { newPage: true }
)}

${section('3. DELIVERY TERMS', deliveryTable(cpl))}

${section(
  '4. PAYMENT TERMS',
  `${paymentTable()}
${para(
  "Agency purchases Billable Calls in advance by paying a NetEnroll invoice issued through Melio, by card or any other payment method offered on the invoice. Delivery begins once payment clears. Each Billable Call draws down Agency's prepaid balance at the rate for its vertical in Section 2. When the prepaid balance is used, delivery pauses until Agency pays a new invoice. Card payments are subject to Section 8.5 of the MSA."
)}`
)}

${section(
  '5. ACKNOWLEDGEMENTS',
  `${para('By signing below, Agency confirms it has read, understands and accepts the following:')}
${bullets([
  '**Buffer Finality.** Any call that reaches or exceeds the Buffer Duration is billable and non-refundable, regardless of sales outcome.',
  '**Prepayment, No Overrun.** Billable Calls are paid for upfront. NetEnroll delivers only what has been prepaid, and delivery pauses when the prepaid balance is used.',
  '**Card Payments.** Agency will not dispute or charge back any card payment for Billable Calls already delivered. A chargeback is a material breach of the MSA.',
  '**No Outcome Guarantee.** NetEnroll does not guarantee policy issuance, conversion rates, carrier approval, commission earnings or specific caller intent.',
  '**Compliance and Call Recording.** All calls are recorded. Agency is solely responsible for agent conduct, state licensing and telemarketing law compliance.',
  '**Master Services Agreement.** This Agreement is governed by the MSA, which Agency has received, read and accepted.',
])}`
)}

${section(
  '6. SIGNATURES',
  `<p class="witness">${md('IN WITNESS WHEREOF, the parties have executed this CPL Agreement as of the later date signed below.')}</p>
${signatureBlock(opts)}`
)}

${partHeading('Schedule 1: CPL Pricing and Billing Methodology', 'Forms part of the CPL Agreement', true)}

${section(
  'BILLING BASIS',
  [
    clause(
      '1.1',
      '**Pay-Per-Call.** Agency pays the fixed Rate per Billable Call stated in Part 1 for each inbound call that meets or exceeds the Buffer Duration for that vertical.'
    ),
    clause(
      '1.2',
      '**Billable Call.** A Billable Call is any inbound call routed by NetEnroll and answered by Agency whose total connected duration equals or exceeds the Buffer Duration (for example, 120 seconds).'
    ),
    clause(
      '1.3',
      "**Buffer Measurement.** Connected time begins the moment Agency's telephony system or agent answers the call and ends when the caller or agent disconnects. Duration is measured automatically by NetEnroll's Portal telephony, which is the record used for billing."
    ),
    clause(
      '1.4',
      '**Non-Billable Calls.** Calls that end before reaching the Buffer Duration, including wrong numbers, early disconnects and short transfers, are non-billable and carry no charge.'
    ),
    clause(
      '1.5',
      "**Unstaffed Periods.** Calls offered while Agency is unstaffed do not count toward Agency's Daily Block. Repeated failure to staff is a material breach under Section 5.1 of the MSA."
    ),
  ].join('\n')
)}

${section(
  'PREPAYMENT AND DAILY BLOCK',
  [
    clause(
      '1.6',
      "**Prepaid Balance.** Agency buys Billable Calls in advance by paying a NetEnroll invoice through Melio. The calls paid for form Agency's prepaid balance for the selected vertical."
    ),
    clause(
      '1.7',
      '**Drawdown.** Each Billable Call reduces the prepaid balance by the rate for its vertical.'
    ),
    clause(
      '1.8',
      '**Daily Block.** The Daily Block is the maximum number of Billable Calls delivered to Agency on a Delivery Day for each selected vertical, as stated in Part 1. Delivery pauses for the rest of the Delivery Day once it is reached.'
    ),
    clause(
      '1.9',
      '**No Overrun.** NetEnroll does not deliver or bill beyond the prepaid balance. When the balance reaches zero, delivery pauses until Agency pays a new invoice.'
    ),
  ].join('\n')
)}

${section(
  'TERM',
  `${clause(
    '1.10',
    '**Term and Termination.** This Agreement continues month to month and may be terminated under Section 15 of the MSA independently of any other Campaign Agreement. Unused prepaid calls are handled under Section 15.5 of the MSA.'
  )}
<div class="end">END OF CPL AGREEMENT</div>`
)}
`;

  return documentHtml({
    title: CPL_TITLE,
    runningHeader: 'CPL AGREEMENT · PAY-PER-CALL',
    eyebrow: 'PVN LLC D/B/A NETENROLL · CAMPAIGN AGREEMENT',
    heading: 'CPL Agreement',
    subtitle: 'Cost-Per-Lead · Pay-Per-Call (Buffer Duration Threshold)',
    body,
    reference: opts.reference,
  });
}
