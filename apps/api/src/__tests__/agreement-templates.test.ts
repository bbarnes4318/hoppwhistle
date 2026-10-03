/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any -- the validation cases mutate deep copies of a fixture */
import { describe, expect, it } from 'vitest';

import { renderDocuments } from '../services/agreements/documents.js';
import {
  formatDeliveryDays,
  formatDeliveryHours,
  formatFirstDeliveryDay,
  formatIsoDate,
  money,
  moneyShort,
} from '../services/agreements/format.js';
import type { RenderOptions } from '../services/agreements/layout.js';
import { cpaIllustration } from '../services/agreements/templates/cpa.js';
import type { FrozenTerms } from '../services/agreements/terms.js';
import { agencyFromParty, partyDetailsSchema, termsSchema } from '../services/agreements/terms.js';

/**
 * The agreements' legal text is verbatim: every sentence approved for the MSA
 * (MSA-2026-10-03.2), the CPA Agreement and the CPL Agreement (both -2026-10-03)
 * must appear, word for word, in the rendered document once its HTML is
 * stripped. The expected text below is an independent copy of the approved
 * text, not read from the templates, so a reworded template fails here.
 */

/** Plain text of a rendered document, the way a reader sees it. */
export function plainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<title[\s\S]*?<\/title>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\/?(strong|span|em|b)(\s[^>]*)?>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const TERMS: FrozenTerms = {
  agency: {
    legalName: 'Summit Ridge Insurance Group LLC',
    stateEntityType: 'Colorado / Limited Liability Company',
    noticeAddress: '100 Main Street, Suite 4, Denver, CO 80202',
    principalName: 'Dana Whitfield',
    principalTitle: 'Managing Member',
    noticeEmail: 'dana@summitridge.test',
    noticePhone: '(303) 555-0142',
    billingEmail: 'billing@summitridge.test',
    billingPhone: '(303) 555-0199',
  },
  effectiveDate: '2026-10-03',
  msaEffectiveDate: '2026-10-03',
  cpa: {
    verticals: {
      FE: { selected: true, rate: 160, dailyBlock: 5 },
      MEDICARE: { selected: false, rate: 160, dailyBlock: null },
      ACA: { selected: false, rate: 100, dailyBlock: null },
    },
    deliveryDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    deliveryStart: '10:00',
    deliveryEnd: '19:00',
    firstDeliveryDay: null,
  },
  cpl: {
    verticals: {
      FE: { selected: true, rate: 45, bufferSeconds: 120, dailyBlock: 12 },
      MEDICARE: { selected: false, rate: null, bufferSeconds: null, dailyBlock: null },
      ACA: { selected: true, rate: 30.5, bufferSeconds: 90, dailyBlock: 8 },
    },
    deliveryDays: ['MON', 'WED', 'FRI'],
    deliveryStart: '09:00',
    deliveryEnd: '17:30',
    firstDeliveryDay: '2026-10-12',
  },
  netenroll: {
    noticeAddress: '2800 N 6th Street, STE 796, Saint Augustine, FL 32084',
    noticeEmail: 'support@pvnvoice.com',
  },
};

const OPTS: RenderOptions = {
  mode: 'send',
  reference: 'NE-ABCD2345',
  netenrollSignatoryName: 'James Kelly',
  netenrollSignatoryTitle: 'Managing Partner',
  netenrollSignedDate: '2026-10-03',
};

function render(terms: FrozenTerms = TERMS) {
  const [msa, cpa, cpl] = renderDocuments(terms, ['MSA', 'CPA', 'CPL'], OPTS);
  return { msa, cpa, cpl };
}

const MSA_TEXT = [
  'PVN LLC D/B/A NETENROLL',
  'Master Services Agreement',
  'Master Terms and Conditions governing all NetEnroll Campaign Agreements',
  'This Master Services Agreement (the "MSA") is entered into as of the Effective Date stated below between PVN LLC, a Florida limited liability company doing business as NetEnroll ("NetEnroll", "we", "us"), and the agency identified below ("Agency", "you"). This MSA sets out the legal terms that govern every campaign Agency runs with NetEnroll. Pricing, volumes, delivery schedules and payment terms are set out separately in each Campaign Agreement.',
  'Parties',
  'NETENROLL ENTITY',
  'PVN LLC d/b/a NetEnroll, a Florida limited liability company',
  'NETENROLL NOTICE ADDRESS & EMAIL',
  '2800 N 6th Street, STE 796, Saint Augustine, FL 32084 · support@pvnvoice.com',
  'AGENCY LEGAL NAME',
  'STATE / ENTITY TYPE',
  'AGENCY NOTICE ADDRESS',
  'PRINCIPAL NAME & TITLE',
  'Dana Whitfield, Managing Member',
  'NOTICE EMAIL & PHONE',
  'dana@summitridge.test · (303) 555-0142',
  'EFFECTIVE DATE',
  '10/3/2026',
  '1. STRUCTURE OF THE AGREEMENT',
  '1.1 Master Agreement. This MSA governs the legal relationship between the parties for all services NetEnroll provides to Agency. It does not by itself obligate NetEnroll to deliver calls or Agency to purchase any volume.',
  '1.2 Campaign Agreements. NetEnroll offers campaigns under two separate Campaign Agreements:',
  '(a) the CPA Agreement (Cost-Per-Acquisition), under which Agency pays a flat rate per Submitted Application; and',
  '(b) the CPL Agreement (Cost-Per-Lead), under which Agency pays a fixed rate per Billable Call meeting the Buffer Duration.',
  '1.3 Incorporation. Agency may enter into either or both Campaign Agreements. Each Campaign Agreement incorporates this MSA by reference and, together with this MSA, forms a separate and independent contract.',
  '1.4 Order of Precedence. If this MSA conflicts with a Campaign Agreement, the Campaign Agreement controls as to rates, Daily Block quantities, Buffer Duration, delivery days and hours, payment terms and billing methodology for that campaign. This MSA controls on all other matters.',
  '2. DEFINITIONS',
  '2.1 "Application" means an insurance application prepared by Agency for a consumer introduced through a Delivered Call.',
  '2.2 "Submitted Application" means an Application recorded in the Portal as having reached "Submitted" status.',
  '2.3 "Delivered Call" means an inbound call or a Live Transfer routed by NetEnroll and answered by Agency.',
  '2.4 "Billable Call" means a Delivered Call whose connected duration equals or exceeds the Buffer Duration.',
  '2.5 "Buffer Duration" means the minimum connected call time, in seconds, required for a call to be billable, as set out in the CPL Agreement.',
  '2.6 "Daily Block" means the maximum quantity of Submitted Applications or Billable Calls delivered to Agency on a Delivery Day, as set out in the applicable Campaign Agreement.',
  '2.7 "Prepaid Balance" means the Submitted Applications or Billable Calls Agency has paid for in advance and not yet received.',
  '2.8 "Delivery Day" means any calendar day on which NetEnroll delivers calls to Agency. Each Delivery Day closes at 11:59:59 p.m. Eastern Time.',
  '2.9 "Business Day" means Monday through Friday, excluding US federal holidays. Business Days govern notice periods, cure periods and billing disputes.',
  '2.10 "Account Statement" means the statement made available in the Portal showing units delivered, amounts drawn down and the remaining Prepaid Balance.',
  '2.11 "Portal" means the NetEnroll technology platform at agents.netenroll.com.',
  '2.12 "Campaign Agreement" means the CPA Agreement or the CPL Agreement, each as executed by the parties.',
  '2.13 "Live Transfer" means a call in which a consumer already on the line with NetEnroll or its call generation partner is connected directly to Agency.',
  '3. SERVICES AND DELIVERY OBLIGATIONS',
  "3.1 Provision of Services. NetEnroll will route inbound calls and Live Transfers to Agency's agents through the Portal and provide administrative access for call monitoring, disposition logging and prepaid balance tracking.",
  '3.2 Delivery Obligation. NetEnroll will continue delivering calls until Agency receives the volume of Submitted Applications or Billable Calls paid for. NetEnroll bears the cost and risk of the call generation required to meet prepaid targets.',
  '3.3 Delivery Window. NetEnroll will deliver sufficient volume to fulfill paid targets within thirty (30) Business Days. If delivery remains unfulfilled after that period, delivery continues at no additional charge, no new invoice is issued until the outstanding Prepaid Balance is fulfilled, and Agency may terminate the affected Campaign Agreement on written notice.',
  '3.4 No Volume Guarantee. Call availability fluctuates with consumer demand and market conditions. Low call delivery on any given day does not constitute a breach of this MSA or any Campaign Agreement.',
  '4. PORTAL ACCESS AND ACCOUNT SECURITY',
  '4.1 User Credentials. Access credentials are issued to named individuals. Agency shall not share or transfer user accounts and is responsible for all actions taken under its credentials.',
  '4.2 Revocation of Access. Agency must promptly revoke Portal access for any agent who leaves Agency or loses state producer licensing.',
  '5. AGENCY OBLIGATIONS AND CALL HANDLING',
  "5.1 Staffing Standards. Agency shall staff sufficient licensed agents during the agreed delivery hours. Calls offered while Agency is unstaffed do not count toward Agency's Daily Block, but repeated failure to staff constitutes a material breach.",
  '5.2 Downline and Third-Party Deployment. Agency may route calls to internal agents, downlines or contractors. Agency remains fully responsible for the compliance and conduct of every individual answering calls.',
  '5.3 Consumer Data Protection. Agency shall use consumer data solely to service the requested insurance product and shall not sell, rent, syndicate or transfer consumer information to any third party.',
  '6. LICENSING, APPOINTMENTS AND LEGAL COMPLIANCE',
  "6.1 Producer Licensing. Agency warrants that every agent answering calls holds an active state insurance producer license and the required carrier appointments in the consumer's state of residence.",
  '6.2 Conduct and Disclosures. Agency is solely responsible for sales presentations, suitability, replacement disclosures and compliance with state insurance regulations.',
  '6.3 Outbound Contact Restrictions. An inbound call or Live Transfer routed by NetEnroll does not grant consent for outbound telemarketing. Agency is solely responsible for compliance with the Telephone Consumer Protection Act, federal and state Do-Not-Call rules and state telemarketing laws on any outbound follow-up contact.',
  '7. CALL RECORDING AND MONITORING',
  '7.1 Recording Consent. All calls delivered through the Portal are recorded. Agency consents to recording and warrants that its agents inform callers where required by applicable one-party or all-party consent laws.',
  "7.2 Proprietary Records. Recordings are NetEnroll's property and will be made available to Agency on reasonable request for compliance or carrier audit purposes.",
  '8. FEES, BILLING AND PAYMENT',
  '8.1 Rates. Agency shall pay the rates set out in each executed Campaign Agreement.',
  "8.2 Prepayment. Agency pays in advance by invoice issued through NetEnroll's payment processor, currently Melio, by card or any other payment method offered on the invoice. Delivery begins once payment clears.",
  '8.3 Drawdown. Each Submitted Application or Billable Call reduces the Prepaid Balance by its rate. When the Prepaid Balance reaches zero, delivery pauses until Agency pays a new invoice.',
  '8.4 No Overrun. NetEnroll does not deliver or bill beyond the Prepaid Balance.',
  '8.5 Card Payments and Chargebacks. Agency shall not dispute, reverse or charge back any payment for Submitted Applications or Billable Calls already delivered. A chargeback or payment reversal for delivered units is a material breach. NetEnroll may pause delivery immediately and recover the reversed amount plus any processor fees incurred.',
  '8.6 Failed Payments. If a payment fails or is reversed, NetEnroll may pause call delivery immediately. Overdue balances accrue interest at 1.5% per month or the maximum rate permitted by law, whichever is lower.',
  '9. DAILY BLOCK',
  '9.1 Daily Cap. Delivery on each Delivery Day is capped at the Daily Block for each selected vertical. When the Daily Block is reached, delivery pauses automatically for the remainder of that Delivery Day.',
  '10. NO REFUNDS; NO EXPIRATION',
  '10.1 Non-Refundable Fees. All fees are non-refundable once an Application is submitted or a call satisfies the Buffer Duration.',
  '10.2 Carrier Outcome Irrelevant. Application fees are earned in full regardless of whether a carrier issues, declines, rates, postpones, rescinds or cancels a policy, or whether a policy later lapses.',
  '10.3 Unused Prepaid Balance. The unused Prepaid Balance does not expire while the applicable Campaign Agreement is in force and rolls forward automatically.',
  '11. DISPUTES AND RECORD KEEPING',
  '11.1 Dispute Window. Agency must submit any billing dispute in writing within five (5) Business Days of the relevant Account Statement. Statements not disputed within that period are final.',
  '11.2 Audit Records. Each party shall retain transaction and call records for at least five (5) years.',
  '12. CONFIDENTIALITY AND DATA OWNERSHIP',
  '12.1 Confidentiality. Commercial terms, rates and platform mechanics are confidential and shall not be disclosed to any third party.',
  '12.2 Intellectual Property. NetEnroll retains all ownership of the Portal, call technology and routing data. Agency owns the customer policy relationships established through completed Applications.',
  '13. INDEMNIFICATION',
  "13.1 By Agency. Agency shall indemnify, defend and hold harmless NetEnroll and its officers from any claims, fines, liabilities or expenses, including reasonable attorneys' fees, arising from:",
  '(a) agent conduct on calls;',
  '(b) outbound follow-up contact by Agency;',
  '(c) state licensing or insurance compliance failures; or',
  "(d) breach of Agency's consumer data obligations.",
  "13.2 By NetEnroll. NetEnroll shall indemnify Agency against third-party claims alleging that NetEnroll's call generation or its routing of inbound calls and Live Transfers violated the TCPA or telemarketing rules, provided the claim does not arise from Agency's post-transfer conduct or sales presentation.",
  '14. LIMITATION OF LIABILITY',
  '14.1 Consequential Damages Waiver. Neither party is liable for indirect, incidental, special or consequential damages, or for lost profits or commissions.',
  "14.2 Aggregate Cap. To the maximum extent permitted by law, NetEnroll's total aggregate liability arising out of or relating to this MSA, any Campaign Agreement or the services, whether in contract, tort (including negligence), under any indemnity (including Section 13.2) or on any other basis, is limited to the total fees paid by Agency in the one (1) month preceding the event giving rise to liability. This limit does not apply to, and does not reduce, Agency's payment obligations or Agency's obligations under Section 13.1.",
  '15. TERM AND TERMINATION',
  '15.1 Term. This MSA begins on the Effective Date and continues month to month until terminated.',
  "15.2 Termination for Convenience. Either party may terminate this MSA, or any individual Campaign Agreement, on ten (10) days' written notice.",
  '15.3 Termination for Breach. Either party may terminate this MSA or any Campaign Agreement on written notice if the other party commits a material breach and fails to cure it within five (5) Business Days of receiving written notice of the breach.',
  '15.4 Effect of Termination. Termination of this MSA terminates every Campaign Agreement. Termination of a single Campaign Agreement leaves this MSA and any other Campaign Agreement in force.',
  '15.5 Prepaid Balance on Termination. No Prepaid Balance is refundable under any circumstance. On termination, the remaining Prepaid Balance is treated as follows:',
  '(a) Termination by Agency for Convenience. If Agency terminates this MSA or a Campaign Agreement under Section 15.2, NetEnroll will continue delivering calls against the remaining Prepaid Balance for sixty (60) days after the termination date. Any Prepaid Balance remaining after that period is forfeited.',
  "(b) Termination for Agency's Breach. If NetEnroll terminates this MSA or a Campaign Agreement under Section 15.3 for Agency's material breach, including a chargeback or payment reversal under Section 8.5 or repeated failure to staff under Section 5.1, the remaining Prepaid Balance is forfeited on the termination date. The parties agree that NetEnroll's damages from such a breach, including call generation costs already incurred and committed to fulfill the Prepaid Balance, are difficult to determine at the Effective Date, and that the forfeited amount is a reasonable estimate of those damages and is liquidated damages, not a penalty.",
  "(c) All Other Terminations. If this MSA or a Campaign Agreement is terminated for any other reason, including by NetEnroll under Section 15.2 or by Agency under Section 3.3 or Section 15.3, NetEnroll's sole obligation, and Agency's sole and exclusive remedy, is the continued delivery of calls against the remaining Prepaid Balance, in accordance with the terms of the applicable Campaign Agreement, until the Prepaid Balance is fulfilled.",
  '15.6 Survival. Sections 10 through 14, Section 15.5, Section 16 and all payment obligations accrued before termination survive termination.',
  '16. GENERAL PROVISIONS',
  '16.1 Independent Contractors. The parties are independent contractors. NetEnroll is not an insurance producer or insurance agency.',
  '16.2 Notices. Notices under this MSA must be in writing and delivered to the notice address or email stated above. Email notice is effective on the Business Day it is sent.',
  '16.3 Governing Law and Venue. This MSA and every Campaign Agreement are governed by the laws of the State of Florida. Venue lies exclusively in St. Johns County, Florida, or the United States District Court for the Middle District of Florida.',
  "16.4 Assignment. Agency may not assign this MSA or any Campaign Agreement without NetEnroll's prior written consent.",
  '16.5 Amendment and Waiver. No amendment or waiver is effective unless in writing and signed by both parties.',
  '16.6 Severability. If any provision is held unenforceable, the remaining provisions continue in full force.',
  '16.7 Counterparts and Electronic Signatures. This MSA may be executed in counterparts and by electronic signature, each of which is deemed an original.',
  '16.8 Entire Agreement. This MSA and the Campaign Agreements executed under it constitute the complete agreement between the parties and supersede all prior negotiations, proposals and pricing arrangements.',
  'SIGNATURES',
  'IN WITNESS WHEREOF, the parties have executed this Master Services Agreement as of the Effective Date.',
  'PVN LLC d/b/a NETENROLL',
  'AGENCY',
  'AUTHORIZED SIGNATURE',
  'PRINTED NAME James Kelly',
  'TITLE Managing Partner',
  'DATE 10/3/2026',
  'END OF MASTER SERVICES AGREEMENT',
];

const CAMPAIGN_INTRO = (name: string) =>
  `This ${name} Agreement (the "Agreement") is entered into between PVN LLC, a Florida limited liability company doing business as NetEnroll ("NetEnroll"), and the agency identified below ("Agency"). It is a Campaign Agreement under, and incorporates in full, the NetEnroll Master Services Agreement between the parties (the "MSA"). Capitalized terms not defined here have the meanings given in the MSA.`;

const CAMPAIGN_SHARED = [
  'Part 1: Insertion Order',
  'Commercial terms, campaign selection and payment terms',
  '1. PARTIES',
  'NETENROLL ENTITY PVN LLC d/b/a NetEnroll, a Florida limited liability company',
  'AGENCY LEGAL NAME Summit Ridge Insurance Group LLC',
  'STATE / ENTITY TYPE Colorado / Limited Liability Company',
  'PRINCIPAL NAME & TITLE Dana Whitfield, Managing Member',
  'BILLING EMAIL & PHONE billing@summitridge.test · (303) 555-0199',
  'MSA EFFECTIVE DATE 10/3/2026',
  '2. CAMPAIGN SELECTION AND RATES',
  '3. DELIVERY TERMS',
  'OVERRUN None. Delivery pauses for the day once the Daily Block is reached and stops when the prepaid balance is used.',
  '4. PAYMENT TERMS',
  'PAYMENT METHOD Prepaid invoice through Melio · card or bank payment',
  'BILLING BASIS Paid in full upfront. No daily debits and no overrun charges.',
  '5. ACKNOWLEDGEMENTS',
  'By signing below, Agency confirms it has read, understands and accepts the following:',
  'Prepayment, No Overrun.',
  'No Outcome Guarantee. NetEnroll does not guarantee policy issuance, conversion rates, carrier approval, commission earnings or specific caller intent.',
  'Compliance and Call Recording. All calls are recorded. Agency is solely responsible for agent conduct, state licensing and telemarketing law compliance.',
  'Master Services Agreement. This Agreement is governed by the MSA, which Agency has received, read and accepted.',
  '6. SIGNATURES',
  'BILLING BASIS',
  'PREPAYMENT AND DAILY BLOCK',
  'TERM',
];

const CPA_TEXT = [
  'PVN LLC D/B/A NETENROLL · CAMPAIGN AGREEMENT',
  'PAY-PER-APPLICATION',
  'CPA Agreement',
  'Cost-Per-Acquisition · Pay-Per-Submitted-Application (Flat Rate)',
  CAMPAIGN_INTRO('CPA'),
  'AT A GLANCE',
  'You Pay For Submitted Applications only. No charge for answered calls, talk time, or calls that do not produce an application.',
  'Rates Final Expense $160 · Medicare $160 · ACA $100 per Submitted Application',
  'When You Pay Upfront, by invoice through Melio. Card accepted. Delivery begins once payment clears.',
  'Credits Prepaid applications do not expire while this Agreement is in force. No overrun, ever.',
  ...CAMPAIGN_SHARED,
  'Agency selects each vertical it will purchase and states its Daily Block for that vertical.',
  'VERTICAL SELECT RATE PER SUBMITTED APPLICATION DAILY BLOCK (APPLICATIONS)',
  'Final Expense $160.00 5',
  'Medicare $160.00 —',
  'ACA (Health) $100.00 —',
  'DELIVERY DAYS Monday through Friday',
  'DELIVERY HOURS 10:00 a.m. to 7:00 p.m. Eastern Time',
  'FIRST DELIVERY DAY The first Delivery Day after payment clears',
  "Agency purchases Submitted Applications in advance by paying a NetEnroll invoice issued through Melio, by card or any other payment method offered on the invoice. Delivery begins once payment clears. Each Submitted Application draws down Agency's prepaid balance at the rate for its vertical in Section 2. When the prepaid balance is used, delivery pauses until Agency pays a new invoice. Card payments are subject to Section 8.5 of the MSA.",
  'Non-Refundable Applications. Submitted Applications are non-refundable once recorded in the Portal, regardless of whether a carrier later issues, declines or rescinds coverage.',
  'Prepayment, No Overrun. Applications are paid for upfront. NetEnroll delivers only what has been prepaid, and delivery pauses when the prepaid balance is used.',
  'Card Payments. Agency will not dispute or charge back any card payment for Submitted Applications already delivered. A chargeback is a material breach of the MSA.',
  'IN WITNESS WHEREOF, the parties have executed this CPA Agreement as of the later date signed below.',
  'Schedule 1: CPA Pricing and Billing Methodology',
  'Forms part of the CPA Agreement',
  '1.1 Pay-Per-Submitted-Application. Agency pays exclusively for Submitted Applications. Agency incurs no cost for answered calls, talk time, or calls that do not result in a Submitted Application.',
  '1.2 Flat Rates. The rates are $160.00 per Final Expense application, $160.00 per Medicare application and $100.00 per ACA (Health) application, as stated in Part 1.',
  '1.3 Submitted Application. An Application counts once, upon reaching "Submitted" status in the Portal. Carrier underwriting decisions, including approval, rating, declination or later policy lapse, do not alter the fee.',
  '1.4 Attribution. A Submitted Application is attributed to the Delivery Day on which it is submitted in the Portal, regardless of when the originating inbound call or Live Transfer took place.',
  "1.5 Prepaid Balance. Agency buys applications in advance by paying a NetEnroll invoice through Melio. The applications paid for form Agency's prepaid balance for the selected vertical.",
  '1.6 Drawdown. Each Submitted Application reduces the prepaid balance by the rate for its vertical.',
  '1.7 Daily Block. The Daily Block is the maximum number of Submitted Applications delivered to Agency on a Delivery Day for each selected vertical, as stated in Part 1. Delivery pauses for the rest of the Delivery Day once it is reached.',
  '1.8 No Overrun. NetEnroll does not deliver or bill beyond the prepaid balance. When the balance reaches zero, delivery pauses until Agency pays a new invoice.',
  '1.9 Illustration. An Agency prepays 20 Final Expense applications at $160.00, a $3,200.00 invoice, with a Daily Block of 5. NetEnroll delivers up to 5 Submitted Applications per Delivery Day. After the 20th, delivery pauses until the next invoice is paid. Nothing further is charged.',
  '1.10 Term and Termination. This Agreement continues month to month and may be terminated under Section 15 of the MSA independently of any other Campaign Agreement. Unused prepaid applications are handled under Section 15.5 of the MSA.',
  'END OF CPA AGREEMENT',
];

const CPL_TEXT = [
  'PVN LLC D/B/A NETENROLL · CAMPAIGN AGREEMENT',
  'CPL Agreement',
  'Cost-Per-Lead · Pay-Per-Call (Buffer Duration Threshold)',
  CAMPAIGN_INTRO('CPL'),
  'AT A GLANCE',
  'You Pay For Billable Calls only: answered inbound calls and Live Transfers that meet or exceed the agreed Buffer Duration.',
  'Rates Fixed rate per Billable Call, set per vertical in Part 1. Calls under the Buffer Duration are free.',
  'When You Pay Upfront, by invoice through Melio. Card accepted. Delivery begins once payment clears.',
  'Credits Prepaid calls do not expire while this Agreement is in force. No overrun, ever.',
  ...CAMPAIGN_SHARED,
  'Agency selects each vertical; the parties agree its rate, Buffer Duration and Daily Block.',
  'VERTICAL SELECT RATE PER BILLABLE CALL BUFFER DURATION (SECONDS) DAILY BLOCK (BILLABLE CALLS)',
  'Final Expense $45.00 120 12',
  'Medicare — — —',
  'ACA (Health) $30.50 90 8',
  'DELIVERY DAYS Monday, Wednesday and Friday',
  'DELIVERY HOURS 9:00 a.m. to 5:30 p.m. Eastern Time',
  'FIRST DELIVERY DAY 10/12/2026',
  "Agency purchases Billable Calls in advance by paying a NetEnroll invoice issued through Melio, by card or any other payment method offered on the invoice. Delivery begins once payment clears. Each Billable Call draws down Agency's prepaid balance at the rate for its vertical in Section 2. When the prepaid balance is used, delivery pauses until Agency pays a new invoice. Card payments are subject to Section 8.5 of the MSA.",
  'Buffer Finality. Any call that reaches or exceeds the Buffer Duration is billable and non-refundable, regardless of sales outcome.',
  'Prepayment, No Overrun. Billable Calls are paid for upfront. NetEnroll delivers only what has been prepaid, and delivery pauses when the prepaid balance is used.',
  'Card Payments. Agency will not dispute or charge back any card payment for Billable Calls already delivered. A chargeback is a material breach of the MSA.',
  'IN WITNESS WHEREOF, the parties have executed this CPL Agreement as of the later date signed below.',
  'Schedule 1: CPL Pricing and Billing Methodology',
  'Forms part of the CPL Agreement',
  '1.1 Pay-Per-Call. Agency pays the fixed Rate per Billable Call stated in Part 1 for each inbound call or Live Transfer that meets or exceeds the Buffer Duration for that vertical.',
  '1.2 Billable Call. A Billable Call is any inbound call or Live Transfer routed by NetEnroll and answered by Agency whose total connected duration equals or exceeds the Buffer Duration (for example, 120 seconds).',
  "1.3 Buffer Measurement. Connected time begins the moment Agency's telephony system or agent answers the call and ends when the caller or agent disconnects. Duration is measured automatically by NetEnroll's Portal telephony, which is the record used for billing.",
  '1.4 Non-Billable Calls. Calls that end before reaching the Buffer Duration, including wrong numbers, early disconnects and short transfers, are non-billable and carry no charge.',
  "1.5 Unstaffed Periods. Calls offered while Agency is unstaffed do not count toward Agency's Daily Block. Repeated failure to staff is a material breach under Section 5.1 of the MSA.",
  "1.6 Prepaid Balance. Agency buys Billable Calls in advance by paying a NetEnroll invoice through Melio. The calls paid for form Agency's prepaid balance for the selected vertical.",
  '1.7 Drawdown. Each Billable Call reduces the prepaid balance by the rate for its vertical.',
  '1.8 Daily Block. The Daily Block is the maximum number of Billable Calls delivered to Agency on a Delivery Day for each selected vertical, as stated in Part 1. Delivery pauses for the rest of the Delivery Day once it is reached.',
  '1.9 No Overrun. NetEnroll does not deliver or bill beyond the prepaid balance. When the balance reaches zero, delivery pauses until Agency pays a new invoice.',
  '1.10 Term and Termination. This Agreement continues month to month and may be terminated under Section 15 of the MSA independently of any other Campaign Agreement. Unused prepaid calls are handled under Section 15.5 of the MSA.',
  'END OF CPL AGREEMENT',
];

describe('agreement templates: the legal text is verbatim', () => {
  const { msa, cpa, cpl } = render();
  const texts = { MSA: plainText(msa.html), CPA: plainText(cpa.html), CPL: plainText(cpl.html) };

  it.each(MSA_TEXT)('MSA contains: %s', sentence => {
    expect(texts.MSA).toContain(sentence);
  });
  it.each(CPA_TEXT)('CPA contains: %s', sentence => {
    expect(texts.CPA).toContain(sentence);
  });
  it.each(CPL_TEXT)('CPL contains: %s', sentence => {
    expect(texts.CPL).toContain(sentence);
  });

  it('carries the template versions', () => {
    expect([msa.templateVersion, cpa.templateVersion, cpl.templateVersion]).toEqual([
      'MSA-2026-10-03.2',
      'CPA-2026-10-03',
      'CPL-2026-10-03',
    ]);
  });

  it('leaves no placeholder unsubstituted', () => {
    for (const doc of [msa, cpa, cpl]) {
      expect(doc.html).not.toContain('{{');
      // Read as text: the inlined base64 logo and font contain any letters.
      expect(plainText(doc.html)).not.toContain('undefined');
      expect(plainText(doc.html)).not.toMatch(/\bNaN\b/);
      expect(plainText(doc.html)).not.toContain('null');
    }
  });

  it('carries each signature marker exactly once, and NetEnroll already signed', () => {
    for (const doc of [msa, cpa, cpl]) {
      for (const marker of ['NETENROLL', 'AGENCY', 'AGENCY_NAME', 'AGENCY_TITLE', 'AGENCY_DATE']) {
        expect(doc.html.split(`<!--SIG:${marker}-->`).length - 1, `${doc.kind} ${marker}`).toBe(1);
      }
      expect(doc.html).toContain('<span class="sig-script">James Kelly</span>');
    }
  });

  it('shows NetEnroll\'s signature as "applied at send" in a preview', () => {
    const [preview] = renderDocuments(TERMS, ['MSA'], { ...OPTS, mode: 'preview' });
    expect(plainText(preview.html)).toContain('Applied at send');
    expect(preview.html).not.toContain('<span class="sig-script">James Kelly</span>');
  });

  it('starts the MSA signatures, and each campaign section 2, on a new page', () => {
    expect(msa.html).toMatch(
      /<section class="section new-page">\s*<h2 class="section-title">SIGNATURES/
    );
    expect(cpa.html).toMatch(
      /<section class="section new-page">\s*<h2 class="section-title">2\. CAMPAIGN/
    );
    expect(cpl.html).toMatch(
      /<section class="section new-page">\s*<h2 class="section-title">2\. CAMPAIGN/
    );
  });

  it('is fully self-contained: no external URL anywhere', () => {
    for (const doc of [msa, cpa, cpl]) {
      expect(doc.html).not.toMatch(/(src|href)="https?:/);
      expect(doc.html).not.toMatch(/url\(https?:/);
      expect(doc.html).not.toMatch(/<script/i);
    }
  });
});

describe('agreement templates: agency-supplied values are escaped', () => {
  it('escapes <script> and quotes in the legal name everywhere', () => {
    const hostile: FrozenTerms = {
      ...TERMS,
      agency: { ...TERMS.agency, legalName: 'Acme <script>alert(1)</script> "Quoted" LLC' },
    };
    const { msa, cpa, cpl } = render(hostile);
    for (const doc of [msa, cpa, cpl]) {
      expect(doc.html).not.toContain('<script>');
      expect(doc.html).toContain(
        'Acme &lt;script&gt;alert(1)&lt;/script&gt; &quot;Quoted&quot; LLC'
      );
    }
    expect(plainText(msa.html)).toContain('Acme <script>alert(1)</script> "Quoted" LLC');
  });
});

describe('CPA Schedule 1 §1.9 illustration', () => {
  it('reads $160 as 20 Final Expense applications at $160.00, a $3,200.00 invoice', () => {
    const { cpa } = render();
    expect(plainText(cpa.html)).toContain(
      '20 Final Expense applications at $160.00, a $3,200.00 invoice'
    );
  });

  it('uses the first selected vertical: Medicare-only at $175.50 is $3,510.00', () => {
    const terms: FrozenTerms = {
      ...TERMS,
      cpa: {
        ...TERMS.cpa!,
        verticals: {
          FE: { selected: false, rate: 160, dailyBlock: null },
          MEDICARE: { selected: true, rate: 175.5, dailyBlock: 3 },
          ACA: { selected: false, rate: 100, dailyBlock: null },
        },
      },
    };
    expect(cpaIllustration(terms)).toEqual({
      vertical: 'Medicare',
      rate: '$175.50',
      total: '$3,510.00',
    });
    const { cpa } = render(terms);
    expect(plainText(cpa.html)).toContain(
      '20 Medicare applications at $175.50, a $3,510.00 invoice'
    );
    // At a glance prints whole rates without cents, others with.
    expect(plainText(cpa.html)).toContain('Final Expense $160 · Medicare $175.50 · ACA $100');
    // Unselected rows: no daily block, but the CPA rate column shows the rate.
    expect(plainText(cpa.html)).toContain('Final Expense $160.00 —');
  });
});

describe('formatting helpers', () => {
  it('money', () => {
    expect(money(1234)).toBe('$1,234.00');
    expect(money(175.5)).toBe('$175.50');
    expect(moneyShort(160)).toBe('$160');
    expect(moneyShort(175.5)).toBe('$175.50');
  });

  it('dates read as written', () => {
    expect(formatIsoDate('2026-01-09')).toBe('1/9/2026');
  });

  it('delivery days: a contiguous run, otherwise a list', () => {
    expect(formatDeliveryDays(['MON', 'TUE', 'WED', 'THU', 'FRI'])).toBe('Monday through Friday');
    expect(formatDeliveryDays(['FRI', 'MON', 'WED'])).toBe('Monday, Wednesday and Friday');
    expect(formatDeliveryDays(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])).toBe(
      'Monday through Sunday'
    );
    expect(formatDeliveryDays(['SAT', 'SUN'])).toBe('Saturday and Sunday');
    expect(formatDeliveryDays(['TUE'])).toBe('Tuesday');
  });

  it('delivery hours and first delivery day', () => {
    expect(formatDeliveryHours('10:00', '19:00')).toBe('10:00 a.m. to 7:00 p.m. Eastern Time');
    expect(formatDeliveryHours('00:00', '12:30')).toBe('12:00 a.m. to 12:30 p.m. Eastern Time');
    expect(formatFirstDeliveryDay(null)).toBe('The first Delivery Day after payment clears');
    expect(formatFirstDeliveryDay('2026-11-02')).toBe('11/2/2026');
  });
});

describe('terms validation', () => {
  const base = JSON.parse(JSON.stringify(TERMS)) as Record<string, any>;

  it('accepts the fixture', () => {
    expect(termsSchema.safeParse(base).success).toBe(true);
  });

  it('needs a selected vertical per campaign agreement', () => {
    const t = JSON.parse(JSON.stringify(base));
    for (const v of ['FE', 'MEDICARE', 'ACA']) t.cpa.verticals[v].selected = false;
    const result = termsSchema.safeParse(t);
    expect(result.success).toBe(false);
  });

  it('bounds the CPL buffer to 1–3600 seconds', () => {
    for (const bad of [0, 3601, 12.5]) {
      const t = JSON.parse(JSON.stringify(base));
      t.cpl.verticals.FE.bufferSeconds = bad;
      expect(termsSchema.safeParse(t).success, `buffer ${bad}`).toBe(false);
    }
    const ok = JSON.parse(JSON.stringify(base));
    ok.cpl.verticals.FE.bufferSeconds = 3600;
    expect(termsSchema.safeParse(ok).success).toBe(true);
  });

  it('refuses a rate with more than two decimals, a zero rate, and hours that end before they start', () => {
    const a = JSON.parse(JSON.stringify(base));
    a.cpa.verticals.FE.rate = 160.005;
    expect(termsSchema.safeParse(a).success).toBe(false);
    const b = JSON.parse(JSON.stringify(base));
    b.cpa.verticals.FE.rate = 0;
    expect(termsSchema.safeParse(b).success).toBe(false);
    const c = JSON.parse(JSON.stringify(base));
    c.cpa.deliveryEnd = '09:00';
    expect(termsSchema.safeParse(c).success).toBe(false);
  });
});

describe('agency details entered by the agency', () => {
  it('prints "To be completed by Agency" in the offer, principal row included', () => {
    const offer: FrozenTerms = { ...TERMS, agency: undefined };
    const { msa, cpa, cpl } = render(offer);
    for (const doc of [msa, cpa, cpl]) {
      const text = plainText(doc.html);
      expect(text).toContain('AGENCY LEGAL NAME To be completed by Agency');
      expect(text).toContain('PRINCIPAL NAME & TITLE To be completed by Agency');
      expect(text).not.toContain('Summit Ridge');
    }
    expect(plainText(msa.html)).toContain('NOTICE EMAIL & PHONE To be completed by Agency');
    expect(plainText(cpa.html)).toContain('BILLING EMAIL & PHONE To be completed by Agency');
    // The commercial terms are all there.
    expect(plainText(cpa.html)).toContain('Final Expense $160.00 5');
  });

  it('prints an individual agent with no principal row', () => {
    const agency = agencyFromParty({
      kind: 'INDIVIDUAL',
      legalName: 'Dana Whitfield',
      dbaName: 'Whitfield Senior Benefits',
      stateOfResidence: 'Florida',
      noticeAddress: '12 Ocean Ave, St. Augustine, FL 32084',
      noticeEmail: 'dana@whitfield.test',
      noticePhone: '(904) 555-0142',
      billingEmail: 'dana@whitfield.test',
      billingPhone: '(904) 555-0142',
    });
    const { msa, cpa, cpl } = render({ ...TERMS, agency });
    for (const doc of [msa, cpa, cpl]) {
      const text = plainText(doc.html);
      expect(text).toContain('AGENCY LEGAL NAME Dana Whitfield d/b/a Whitfield Senior Benefits');
      expect(text).toContain('STATE / ENTITY TYPE Florida / Individual (sole proprietor)');
      expect(text).not.toContain('PRINCIPAL NAME & TITLE');
    }
    expect(plainText(msa.html)).toContain(
      'AGENCY NOTICE ADDRESS 12 Ocean Ave, St. Augustine, FL 32084'
    );
  });

  it('prints a business from its own details', () => {
    const agency = agencyFromParty({
      kind: 'BUSINESS',
      legalName: 'Summit Ridge Insurance Group LLC',
      dbaName: null,
      stateOfFormation: 'Colorado',
      entityType: 'Limited Liability Company',
      noticeAddress: '100 Main Street, Denver, CO 80202',
      principalName: 'Morgan Ridge',
      principalTitle: 'Managing Member',
      noticeEmail: 'dana@summitridge.test',
      noticePhone: '(303) 555-0142',
      billingEmail: 'billing@summitridge.test',
      billingPhone: '(303) 555-0199',
      signerName: 'Dana Whitfield',
      signerTitle: 'Operations Director',
    });
    const text = plainText(render({ ...TERMS, agency }).msa.html);
    expect(text).toContain('STATE / ENTITY TYPE Colorado / Limited Liability Company');
    expect(text).toContain('PRINCIPAL NAME & TITLE Morgan Ridge, Managing Member');
  });

  it('validates what the agency enters', () => {
    expect(partyDetailsSchema.safeParse({ kind: 'INDIVIDUAL', legalName: 'Dana' }).success).toBe(
      false
    );
    expect(
      partyDetailsSchema.safeParse({
        kind: 'BUSINESS',
        legalName: 'X LLC',
        stateOfFormation: 'Colorado',
        entityType: 'LLC',
        noticeAddress: '1 Main',
        noticeEmail: 'not-an-email',
        noticePhone: '3035550142',
        billingEmail: 'a@b.test',
        billingPhone: '3035550142',
        principalName: 'A',
        principalTitle: 'B',
        signerName: 'Al',
        signerTitle: 'C',
      }).success
    ).toBe(false);
  });
});
