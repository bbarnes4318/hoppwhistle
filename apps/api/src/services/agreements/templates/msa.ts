/**
 * The Master Services Agreement, template MSA-2026-10-03.2.
 *
 * ── The legal text is verbatim ───────────────────────────────────────────────
 *
 * Every sentence below is the approved text, word for word, in the approved
 * order. It is not reworded, summarised or "improved" here, ever: a change to
 * the agreement is a new template version, approved as a whole. Only the
 * agency's and NetEnroll's details are substituted, HTML-escaped.
 * `agreement-templates.test.ts` strips the HTML and checks every sentence.
 */

import { esc, formatIsoDate } from '../format.js';
import {
  clause,
  documentHtml,
  kvTable,
  md,
  para,
  section,
  signatureBlock,
  type RenderOptions,
} from '../layout.js';
import type { FrozenTerms } from '../terms.js';

export const MSA_TITLE = 'Master Services Agreement';
export const MSA_TEMPLATE_VERSION = 'MSA-2026-10-03.2';

export function render(terms: FrozenTerms, opts: RenderOptions): string {
  const a = terms.agency;
  const n = terms.netenroll;

  const body = `
${para(
  'This Master Services Agreement (the "**MSA**") is entered into as of the Effective Date stated below between **PVN LLC**, a Florida limited liability company doing business as NetEnroll ("**NetEnroll**", "we", "us"), and the agency identified below ("**Agency**", "you"). This MSA sets out the legal terms that govern every campaign Agency runs with NetEnroll. Pricing, volumes, delivery schedules and payment terms are set out separately in each Campaign Agreement.'
)}

${section(
  'Parties',
  kvTable([
    ['NETENROLL ENTITY', 'PVN LLC d/b/a NetEnroll, a Florida limited liability company'],
    ['NETENROLL NOTICE ADDRESS & EMAIL', `${esc(n.noticeAddress)} · ${esc(n.noticeEmail)}`],
    ['AGENCY LEGAL NAME', esc(a.legalName)],
    ['STATE / ENTITY TYPE', esc(a.stateEntityType)],
    ['AGENCY NOTICE ADDRESS', esc(a.noticeAddress)],
    ['PRINCIPAL NAME & TITLE', `${esc(a.principalName)}, ${esc(a.principalTitle)}`],
    ['NOTICE EMAIL & PHONE', `${esc(a.noticeEmail)} · ${esc(a.noticePhone)}`],
    ['EFFECTIVE DATE', esc(formatIsoDate(terms.effectiveDate))],
  ])
)}

${section(
  '1. STRUCTURE OF THE AGREEMENT',
  [
    clause(
      '1.1',
      '**Master Agreement.** This MSA governs the legal relationship between the parties for all services NetEnroll provides to Agency. It does not by itself obligate NetEnroll to deliver calls or Agency to purchase any volume.'
    ),
    clause(
      '1.2',
      '**Campaign Agreements.** NetEnroll offers campaigns under two separate Campaign Agreements:',
      [
        '(a) the **CPA Agreement** (Cost-Per-Acquisition), under which Agency pays a flat rate per Submitted Application; and',
        '(b) the **CPL Agreement** (Cost-Per-Lead), under which Agency pays a fixed rate per Billable Call meeting the Buffer Duration.',
      ]
    ),
    clause(
      '1.3',
      '**Incorporation.** Agency may enter into either or both Campaign Agreements. Each Campaign Agreement incorporates this MSA by reference and, together with this MSA, forms a separate and independent contract.'
    ),
    clause(
      '1.4',
      '**Order of Precedence.** If this MSA conflicts with a Campaign Agreement, the Campaign Agreement controls as to rates, Daily Block quantities, Buffer Duration, delivery days and hours, payment terms and billing methodology for that campaign. This MSA controls on all other matters.'
    ),
  ].join('\n')
)}

${section(
  '2. DEFINITIONS',
  [
    clause(
      '2.1',
      '**"Application"** means an insurance application prepared by Agency for a consumer introduced through a Delivered Call.'
    ),
    clause(
      '2.2',
      '**"Submitted Application"** means an Application recorded in the Portal as having reached "Submitted" status.'
    ),
    clause(
      '2.3',
      '**"Delivered Call"** means an inbound call or a Live Transfer routed by NetEnroll and answered by Agency.'
    ),
    clause(
      '2.4',
      '**"Billable Call"** means a Delivered Call whose connected duration equals or exceeds the Buffer Duration.'
    ),
    clause(
      '2.5',
      '**"Buffer Duration"** means the minimum connected call time, in seconds, required for a call to be billable, as set out in the CPL Agreement.'
    ),
    clause(
      '2.6',
      '**"Daily Block"** means the maximum quantity of Submitted Applications or Billable Calls delivered to Agency on a Delivery Day, as set out in the applicable Campaign Agreement.'
    ),
    clause(
      '2.7',
      '**"Prepaid Balance"** means the Submitted Applications or Billable Calls Agency has paid for in advance and not yet received.'
    ),
    clause(
      '2.8',
      '**"Delivery Day"** means any calendar day on which NetEnroll delivers calls to Agency. Each Delivery Day closes at 11:59:59 p.m. Eastern Time.'
    ),
    clause(
      '2.9',
      '**"Business Day"** means Monday through Friday, excluding US federal holidays. Business Days govern notice periods, cure periods and billing disputes.'
    ),
    clause(
      '2.10',
      '**"Account Statement"** means the statement made available in the Portal showing units delivered, amounts drawn down and the remaining Prepaid Balance.'
    ),
    clause('2.11', '**"Portal"** means the NetEnroll technology platform at agents.netenroll.com.'),
    clause(
      '2.12',
      '**"Campaign Agreement"** means the CPA Agreement or the CPL Agreement, each as executed by the parties.'
    ),
    clause(
      '2.13',
      '**"Live Transfer"** means a call in which a consumer already on the line with NetEnroll or its call generation partner is connected directly to Agency.'
    ),
  ].join('\n')
)}

${section(
  '3. SERVICES AND DELIVERY OBLIGATIONS',
  [
    clause(
      '3.1',
      "**Provision of Services.** NetEnroll will route inbound calls and Live Transfers to Agency's agents through the Portal and provide administrative access for call monitoring, disposition logging and prepaid balance tracking."
    ),
    clause(
      '3.2',
      '**Delivery Obligation.** NetEnroll will continue delivering calls until Agency receives the volume of Submitted Applications or Billable Calls paid for. NetEnroll bears the cost and risk of the call generation required to meet prepaid targets.'
    ),
    clause(
      '3.3',
      '**Delivery Window.** NetEnroll will deliver sufficient volume to fulfill paid targets within thirty (30) Business Days. If delivery remains unfulfilled after that period, delivery continues at no additional charge, no new invoice is issued until the outstanding Prepaid Balance is fulfilled, and Agency may terminate the affected Campaign Agreement on written notice.'
    ),
    clause(
      '3.4',
      '**No Volume Guarantee.** Call availability fluctuates with consumer demand and market conditions. Low call delivery on any given day does not constitute a breach of this MSA or any Campaign Agreement.'
    ),
  ].join('\n')
)}

${section(
  '4. PORTAL ACCESS AND ACCOUNT SECURITY',
  [
    clause(
      '4.1',
      '**User Credentials.** Access credentials are issued to named individuals. Agency shall not share or transfer user accounts and is responsible for all actions taken under its credentials.'
    ),
    clause(
      '4.2',
      '**Revocation of Access.** Agency must promptly revoke Portal access for any agent who leaves Agency or loses state producer licensing.'
    ),
  ].join('\n')
)}

${section(
  '5. AGENCY OBLIGATIONS AND CALL HANDLING',
  [
    clause(
      '5.1',
      "**Staffing Standards.** Agency shall staff sufficient licensed agents during the agreed delivery hours. Calls offered while Agency is unstaffed do not count toward Agency's Daily Block, but repeated failure to staff constitutes a material breach."
    ),
    clause(
      '5.2',
      '**Downline and Third-Party Deployment.** Agency may route calls to internal agents, downlines or contractors. Agency remains fully responsible for the compliance and conduct of every individual answering calls.'
    ),
    clause(
      '5.3',
      '**Consumer Data Protection.** Agency shall use consumer data solely to service the requested insurance product and shall not sell, rent, syndicate or transfer consumer information to any third party.'
    ),
  ].join('\n')
)}

${section(
  '6. LICENSING, APPOINTMENTS AND LEGAL COMPLIANCE',
  [
    clause(
      '6.1',
      "**Producer Licensing.** Agency warrants that every agent answering calls holds an active state insurance producer license and the required carrier appointments in the consumer's state of residence."
    ),
    clause(
      '6.2',
      '**Conduct and Disclosures.** Agency is solely responsible for sales presentations, suitability, replacement disclosures and compliance with state insurance regulations.'
    ),
    clause(
      '6.3',
      '**Outbound Contact Restrictions.** An inbound call or Live Transfer routed by NetEnroll does not grant consent for outbound telemarketing. Agency is solely responsible for compliance with the Telephone Consumer Protection Act, federal and state Do-Not-Call rules and state telemarketing laws on any outbound follow-up contact.'
    ),
  ].join('\n')
)}

${section(
  '7. CALL RECORDING AND MONITORING',
  [
    clause(
      '7.1',
      '**Recording Consent.** All calls delivered through the Portal are recorded. Agency consents to recording and warrants that its agents inform callers where required by applicable one-party or all-party consent laws.'
    ),
    clause(
      '7.2',
      "**Proprietary Records.** Recordings are NetEnroll's property and will be made available to Agency on reasonable request for compliance or carrier audit purposes."
    ),
  ].join('\n')
)}

${section(
  '8. FEES, BILLING AND PAYMENT',
  [
    clause(
      '8.1',
      '**Rates.** Agency shall pay the rates set out in each executed Campaign Agreement.'
    ),
    clause(
      '8.2',
      "**Prepayment.** Agency pays in advance by invoice issued through NetEnroll's payment processor, currently Melio, by card or any other payment method offered on the invoice. Delivery begins once payment clears."
    ),
    clause(
      '8.3',
      '**Drawdown.** Each Submitted Application or Billable Call reduces the Prepaid Balance by its rate. When the Prepaid Balance reaches zero, delivery pauses until Agency pays a new invoice.'
    ),
    clause('8.4', '**No Overrun.** NetEnroll does not deliver or bill beyond the Prepaid Balance.'),
    clause(
      '8.5',
      '**Card Payments and Chargebacks.** Agency shall not dispute, reverse or charge back any payment for Submitted Applications or Billable Calls already delivered. A chargeback or payment reversal for delivered units is a material breach. NetEnroll may pause delivery immediately and recover the reversed amount plus any processor fees incurred.'
    ),
    clause(
      '8.6',
      '**Failed Payments.** If a payment fails or is reversed, NetEnroll may pause call delivery immediately. Overdue balances accrue interest at 1.5% per month or the maximum rate permitted by law, whichever is lower.'
    ),
  ].join('\n')
)}

${section(
  '9. DAILY BLOCK',
  clause(
    '9.1',
    '**Daily Cap.** Delivery on each Delivery Day is capped at the Daily Block for each selected vertical. When the Daily Block is reached, delivery pauses automatically for the remainder of that Delivery Day.'
  )
)}

${section(
  '10. NO REFUNDS; NO EXPIRATION',
  [
    clause(
      '10.1',
      '**Non-Refundable Fees.** All fees are non-refundable once an Application is submitted or a call satisfies the Buffer Duration.'
    ),
    clause(
      '10.2',
      '**Carrier Outcome Irrelevant.** Application fees are earned in full regardless of whether a carrier issues, declines, rates, postpones, rescinds or cancels a policy, or whether a policy later lapses.'
    ),
    clause(
      '10.3',
      '**Unused Prepaid Balance.** The unused Prepaid Balance does not expire while the applicable Campaign Agreement is in force and rolls forward automatically.'
    ),
  ].join('\n')
)}

${section(
  '11. DISPUTES AND RECORD KEEPING',
  [
    clause(
      '11.1',
      '**Dispute Window.** Agency must submit any billing dispute in writing within five (5) Business Days of the relevant Account Statement. Statements not disputed within that period are final.'
    ),
    clause(
      '11.2',
      '**Audit Records.** Each party shall retain transaction and call records for at least five (5) years.'
    ),
  ].join('\n')
)}

${section(
  '12. CONFIDENTIALITY AND DATA OWNERSHIP',
  [
    clause(
      '12.1',
      '**Confidentiality.** Commercial terms, rates and platform mechanics are confidential and shall not be disclosed to any third party.'
    ),
    clause(
      '12.2',
      '**Intellectual Property.** NetEnroll retains all ownership of the Portal, call technology and routing data. Agency owns the customer policy relationships established through completed Applications.'
    ),
  ].join('\n')
)}

${section(
  '13. INDEMNIFICATION',
  [
    clause(
      '13.1',
      "**By Agency.** Agency shall indemnify, defend and hold harmless NetEnroll and its officers from any claims, fines, liabilities or expenses, including reasonable attorneys' fees, arising from:",
      [
        '(a) agent conduct on calls;',
        '(b) outbound follow-up contact by Agency;',
        '(c) state licensing or insurance compliance failures; or',
        "(d) breach of Agency's consumer data obligations.",
      ]
    ),
    clause(
      '13.2',
      "**By NetEnroll.** NetEnroll shall indemnify Agency against third-party claims alleging that NetEnroll's call generation or its routing of inbound calls and Live Transfers violated the TCPA or telemarketing rules, provided the claim does not arise from Agency's post-transfer conduct or sales presentation."
    ),
  ].join('\n')
)}

${section(
  '14. LIMITATION OF LIABILITY',
  [
    clause(
      '14.1',
      '**Consequential Damages Waiver.** Neither party is liable for indirect, incidental, special or consequential damages, or for lost profits or commissions.'
    ),
    clause(
      '14.2',
      "**Aggregate Cap.** To the maximum extent permitted by law, NetEnroll's total aggregate liability arising out of or relating to this MSA, any Campaign Agreement or the services, whether in contract, tort (including negligence), under any indemnity (including Section 13.2) or on any other basis, is limited to the total fees paid by Agency in the one (1) month preceding the event giving rise to liability. This limit does not apply to, and does not reduce, Agency's payment obligations or Agency's obligations under Section 13.1."
    ),
  ].join('\n')
)}

${section(
  '15. TERM AND TERMINATION',
  [
    clause(
      '15.1',
      '**Term.** This MSA begins on the Effective Date and continues month to month until terminated.'
    ),
    clause(
      '15.2',
      "**Termination for Convenience.** Either party may terminate this MSA, or any individual Campaign Agreement, on ten (10) days' written notice."
    ),
    clause(
      '15.3',
      '**Termination for Breach.** Either party may terminate this MSA or any Campaign Agreement on written notice if the other party commits a material breach and fails to cure it within five (5) Business Days of receiving written notice of the breach.'
    ),
    clause(
      '15.4',
      '**Effect of Termination.** Termination of this MSA terminates every Campaign Agreement. Termination of a single Campaign Agreement leaves this MSA and any other Campaign Agreement in force.'
    ),
    clause(
      '15.5',
      '**Prepaid Balance on Termination.** No Prepaid Balance is refundable under any circumstance. On termination, the remaining Prepaid Balance is treated as follows:',
      [
        '(a) **Termination by Agency for Convenience.** If Agency terminates this MSA or a Campaign Agreement under Section 15.2, NetEnroll will continue delivering calls against the remaining Prepaid Balance for sixty (60) days after the termination date. Any Prepaid Balance remaining after that period is forfeited.',
        "(b) **Termination for Agency's Breach.** If NetEnroll terminates this MSA or a Campaign Agreement under Section 15.3 for Agency's material breach, including a chargeback or payment reversal under Section 8.5 or repeated failure to staff under Section 5.1, the remaining Prepaid Balance is forfeited on the termination date. The parties agree that NetEnroll's damages from such a breach, including call generation costs already incurred and committed to fulfill the Prepaid Balance, are difficult to determine at the Effective Date, and that the forfeited amount is a reasonable estimate of those damages and is liquidated damages, not a penalty.",
        "(c) **All Other Terminations.** If this MSA or a Campaign Agreement is terminated for any other reason, including by NetEnroll under Section 15.2 or by Agency under Section 3.3 or Section 15.3, NetEnroll's sole obligation, and Agency's sole and exclusive remedy, is the continued delivery of calls against the remaining Prepaid Balance, in accordance with the terms of the applicable Campaign Agreement, until the Prepaid Balance is fulfilled.",
      ]
    ),
    clause(
      '15.6',
      '**Survival.** Sections 10 through 14, Section 15.5, Section 16 and all payment obligations accrued before termination survive termination.'
    ),
  ].join('\n')
)}

${section(
  '16. GENERAL PROVISIONS',
  [
    clause(
      '16.1',
      '**Independent Contractors.** The parties are independent contractors. NetEnroll is not an insurance producer or insurance agency.'
    ),
    clause(
      '16.2',
      '**Notices.** Notices under this MSA must be in writing and delivered to the notice address or email stated above. Email notice is effective on the Business Day it is sent.'
    ),
    clause(
      '16.3',
      '**Governing Law and Venue.** This MSA and every Campaign Agreement are governed by the laws of the State of Florida. Venue lies exclusively in St. Johns County, Florida, or the United States District Court for the Middle District of Florida.'
    ),
    clause(
      '16.4',
      "**Assignment.** Agency may not assign this MSA or any Campaign Agreement without NetEnroll's prior written consent."
    ),
    clause(
      '16.5',
      '**Amendment and Waiver.** No amendment or waiver is effective unless in writing and signed by both parties.'
    ),
    clause(
      '16.6',
      '**Severability.** If any provision is held unenforceable, the remaining provisions continue in full force.'
    ),
    clause(
      '16.7',
      '**Counterparts and Electronic Signatures.** This MSA may be executed in counterparts and by electronic signature, each of which is deemed an original.'
    ),
    clause(
      '16.8',
      '**Entire Agreement.** This MSA and the Campaign Agreements executed under it constitute the complete agreement between the parties and supersede all prior negotiations, proposals and pricing arrangements.'
    ),
  ].join('\n')
)}

${section(
  'SIGNATURES',
  `<p class="witness">${md('IN WITNESS WHEREOF, the parties have executed this Master Services Agreement as of the Effective Date.')}</p>
${signatureBlock(opts)}
<div class="end">END OF MASTER SERVICES AGREEMENT</div>`,
  { newPage: true }
)}
`;

  return documentHtml({
    title: MSA_TITLE,
    runningHeader: 'MASTER SERVICES AGREEMENT',
    eyebrow: 'PVN LLC D/B/A NETENROLL',
    heading: 'Master Services Agreement',
    subtitle: 'Master Terms and Conditions governing all NetEnroll Campaign Agreements',
    body,
    reference: opts.reference,
  });
}
