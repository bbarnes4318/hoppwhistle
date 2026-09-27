/**
 * A statement as a page and as a spreadsheet.
 *
 * ── One template per party, one letterhead ───────────────────────────────────
 *
 * The header is the issuing agency's brand, by the rule email already follows
 * (`services/email-brand.ts`): its logo, its name, and its own domain -- or
 * APP_URL when it has none. A branded agency's buyers, publishers and child
 * agencies never see "NetEnroll" on a statement: not in the header, not in the
 * footer, not in a file name. An agency with no brand reads as NetEnroll, as
 * everything else does.
 *
 * The HTML is what `statements:close` stores and what the PDF is printed from,
 * so the page a buyer downloads in a year is the page that was made the day
 * the month closed. Everything interpolated is escaped.
 *
 * ── The CSV is the line items ────────────────────────────────────────────────
 *
 * Calls for a buyer or a publisher, with the month's other lines (late
 * returns, payments, deductions) after them; for an agency, the per-buyer,
 * per-publisher and number-charge lines; for a child agency, its agents and
 * number charges. Cells go through `csvCell`, which guards formula injection.
 */

import { csvCell } from '../../lib/csv.js';
import { appUrl, type EmailBrand } from '../email-brand.js';

import type {
  AgencyStatement,
  BuyerStatement,
  ChildAgencyStatement,
  NumberChargeGroup,
  PublisherStatement,
  StatementData,
} from './statement-data.js';

export interface StatementLetterhead {
  productName: string;
  logoUrl: string | null;
  /** The agency's own address: Tenant.domain, or APP_URL. */
  site: string;
}

/** The letterhead for a brand, as email builds it. */
export function letterheadOf(brand: EmailBrand): StatementLetterhead {
  return {
    productName: brand.productName,
    /*
     * The logo from the agency's own domain when it has one: the portal there
     * serves the same /brands assets, and a branded statement should not carry
     * the platform's host even in an image address.
     */
    logoUrl: brand.logoUrl ? brand.logoUrl.replace(appUrl(), brand.linkBase) : null,
    site: brand.linkBase.replace(/^https?:\/\//i, ''),
  };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function money(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : usd.format(value);
}
function count(value: number): string {
  return value.toLocaleString('en-US');
}
function pct(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}
function seconds(value: number | null): string {
  if (value === null) return '—';
  const m = Math.floor(value / 60);
  const s = value % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const PARTY_TITLE: Record<StatementData['partyType'], string> = {
  BUYER: 'Buyer statement',
  PUBLISHER: 'Publisher statement',
  AGENCY: 'Agency statement',
  CHILD_AGENCY: 'Agency statement',
};

const STYLE = `
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;font-size:11px;color:#1f2328;margin:0;padding:24px}
  header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1f2328;padding-bottom:14px;margin-bottom:18px}
  header img{max-height:44px;max-width:220px}
  .brand-name{font-size:18px;font-weight:700}
  .site{color:#57606a;margin-top:2px}
  .doc{text-align:right}
  .doc h1{font-size:16px;margin:0 0 4px}
  .doc .party{font-weight:600}
  .muted{color:#57606a}
  h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#57606a;margin:20px 0 6px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;font-weight:600;border-bottom:1px solid #1f2328;padding:5px 6px}
  td{border-bottom:1px solid #d0d7de;padding:5px 6px;vertical-align:top}
  .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .summary td:first-child{width:60%}
  .summary tr.total td{font-weight:700;border-top:2px solid #1f2328}
  .live{display:inline-block;border:1px solid #9a6700;color:#9a6700;border-radius:4px;padding:1px 6px;font-size:10px;margin-left:6px}
  footer{margin-top:24px;color:#57606a;font-size:10px}
`;

function summaryTable(rows: Array<[string, string, boolean?]>): string {
  return `<table class="summary"><tbody>${rows
    .map(
      ([label, value, total]) =>
        `<tr${total ? ' class="total"' : ''}><td>${escapeHtml(label)}</td><td class="num">${escapeHtml(value)}</td></tr>`
    )
    .join('')}</tbody></table>`;
}

function table(headers: Array<[string, boolean?]>, rows: string[][]): string {
  if (rows.length === 0) return '<p class="muted">None this month.</p>';
  return `<table><thead><tr>${headers
    .map(([label, numeric]) => `<th${numeric ? ' class="num"' : ''}>${escapeHtml(label)}</th>`)
    .join('')}</tr></thead><tbody>${rows
    .map(
      row =>
        `<tr>${row
          .map((cell, i) => `<td${headers[i]?.[1] ? ' class="num"' : ''}>${escapeHtml(cell)}</td>`)
          .join('')}</tr>`
    )
    .join('')}</tbody></table>`;
}

function numberChargesTable(groups: NumberChargeGroup[]): string {
  return table(
    [['Numbers held by'], ['Charges', true], ['Setup', true], ['Monthly', true], ['Total', true]],
    groups.map(g => [g.name, count(g.count), money(g.setup), money(g.monthly), money(g.total)])
  );
}

function buyerBody(s: BuyerStatement): string {
  const t = s.totals;
  const summary: Array<[string, string, boolean?]> = [
    ['Calls delivered', count(t.callsDelivered)],
    ['Billable calls', count(t.billableCalls)],
    ['Amount billed', money(t.amountBilled)],
    ['Average price', money(t.averagePrice)],
    [`Returns accepted (${count(t.returnsAccepted)})`, money(-t.returnsAcceptedAmount)],
    ['Returns denied', count(t.returnsDenied)],
    ['Open returns', count(t.openReturns)],
  ];
  if (t.amountDue !== null) summary.push(['Amount due', money(t.amountDue), true]);

  const wallet = s.wallet
    ? `<h2>Wallet</h2>${summaryTable([
        ['Opening balance', money(s.wallet.opening)],
        ['Top-ups', money(s.wallet.topUps)],
        ['Refunds for accepted returns', money(s.wallet.refunds)],
        ['Call charges', money(-s.wallet.callCharges)],
        ['Closing balance', money(s.wallet.closing), true],
      ])}`
    : '';

  const late =
    s.lateReturns.length > 0
      ? `<h2>Earlier months</h2>${table(
          [['Line'], ['Call date'], ['Amount', true]],
          s.lateReturns.map(r => [r.label, r.callDate, money(-r.amount)])
        )}`
      : '';

  return `<h2>Summary</h2>${summaryTable(summary)}${wallet}${late}
    <h2>Calls</h2>${table(
      [
        ['Date / time'],
        ['Caller'],
        ['Campaign'],
        ['Connected', true],
        ['Billable'],
        ['Amount', true],
        ['Return'],
      ],
      s.lines.map(l => [
        l.at,
        l.caller,
        l.campaign,
        seconds(l.connectedSeconds),
        l.billable ? 'Yes' : 'No',
        money(l.amount),
        l.returnStatus,
      ])
    )}`;
}

function publisherBody(s: PublisherStatement): string {
  const t = s.totals;
  return `<h2>Summary</h2>${summaryTable([
    ['Calls sent', count(t.callsSent)],
    ['Billable calls', count(t.billableCalls)],
    ['Payout earned', money(t.payoutEarned)],
    ['— paid', money(t.paid)],
    ['— payable', money(t.payable)],
    ['— held', money(t.held)],
    ['Returns deducted', money(-t.returnsDeducted)],
    ['Payments received', money(t.paymentsReceived)],
    ['Net still owed to you at month end', money(t.netOwedAtMonthEnd), true],
  ])}
    <h2>Payments received</h2>${table(
      [['Date'], ['Method'], ['Reference'], ['Amount', true]],
      s.payments.map(p => [p.date, p.method, p.reference ?? '', money(p.amount)])
    )}
    <h2>Returns deducted</h2>${table(
      [['Date'], ['Call date'], ['Amount', true]],
      s.returnsDeducted.map(r => [r.date, r.callDate, money(-r.amount)])
    )}
    <h2>Calls</h2>${table(
      [
        ['Date / time'],
        ['Campaign'],
        ['Connected', true],
        ['Billable'],
        ['Payout', true],
        ['Status'],
      ],
      s.lines.map(l => [
        l.at,
        l.campaign,
        seconds(l.connectedSeconds),
        l.billable ? 'Yes' : 'No',
        money(l.payout),
        l.status,
      ])
    )}`;
}

function agencyBody(s: AgencyStatement): string {
  const t = s.totals;
  return `<h2>Calls</h2>${summaryTable([
    ['Inbound calls', count(t.inboundCalls)],
    ['Answered by your agents', count(t.answeredByAgents)],
    ['Sent to buyers', count(t.sentToBuyers)],
    ['Unanswered', count(t.unanswered)],
    ['Blocked', count(t.blocked)],
    [
      'Billable calls',
      `${count(t.billable)} (${count(t.billableToBuyers)} to buyers, ${count(t.billableAgentAnswered)} your agents)`,
    ],
    ['Applications submitted', count(t.applications)],
    ['Closing %', pct(t.closingPct)],
  ])}
    <h2>Money</h2>${summaryTable([
      ['Revenue', money(t.revenue)],
      ['Publisher payouts', money(-t.publisherPayouts)],
      [t.callCostEstimated ? 'Call cost (estimated)' : 'Call cost', money(-t.callCost)],
      ['Fees', money(-t.fees)],
      ['Profit', money(t.profit), true],
      ['Adjustments', money(t.adjustments)],
    ])}
    <h2>Revenue by buyer</h2>${table(
      [['Buyer'], ['Calls', true], ['Billable', true], ['Revenue', true]],
      s.revenueByBuyer.map(r => [r.name, count(r.calls), count(r.billable), money(r.revenue)])
    )}
    <h2>Payouts by publisher</h2>${table(
      [['Publisher'], ['Calls', true], ['Billable', true], ['Payout', true]],
      s.payoutsByPublisher.map(r => [r.name, count(r.calls), count(r.billable), money(r.payout)])
    )}
    <h2>Returns and payments</h2>${summaryTable([
      [`Returns accepted (${count(t.returnsAccepted)})`, money(-t.returnsRevenueReturned)],
      ['Payouts taken back on those returns', money(t.returnsPayoutClawedBack)],
      [
        `Publisher payments recorded (${count(t.publisherPaymentsCount)})`,
        money(t.publisherPaymentsTotal),
      ],
      ['Clawbacks applied to payments', money(t.clawbacksApplied)],
    ])}${
      s.lateReturns.length > 0
        ? table(
            [['Line'], ['Call date'], ['Amount', true]],
            s.lateReturns.map(r => [r.label, r.callDate, money(-r.amount)])
          )
        : ''
    }
    <h2>Number charges</h2>${numberChargesTable(s.numberCharges)}
    ${summaryTable([['Number charges this month', money(t.numberCharges), true]])}`;
}

function childBody(s: ChildAgencyStatement): string {
  const t = s.totals;
  return `<h2>Summary</h2>${summaryTable([
    ['Inbound calls', count(t.inboundCalls)],
    ['Answered by agents', count(t.answeredByAgents)],
    ['Applications submitted', count(t.applications)],
    ['Closing %', pct(t.closingPct)],
    ['Number charges', money(t.numberCharges), true],
  ])}
    <h2>Agents</h2>${table(
      [
        ['Agent'],
        ['Calls taken', true],
        ['Applications', true],
        ['Closing %', true],
        ['Annualized premium', true],
      ],
      s.agents.map(a => [
        a.name,
        count(a.callsTaken),
        count(a.applications),
        pct(a.closingPct),
        money(a.annualizedPremium),
      ])
    )}
    <h2>Number charges</h2>${numberChargesTable(s.numberCharges)}`;
}

/** The whole page. */
export function renderStatementHtml(s: StatementData, letterhead: StatementLetterhead): string {
  const body =
    s.partyType === 'BUYER'
      ? buyerBody(s)
      : s.partyType === 'PUBLISHER'
        ? publisherBody(s)
        : s.partyType === 'AGENCY'
          ? agencyBody(s)
          : childBody(s);

  const brandBlock = letterhead.logoUrl
    ? `<img src="${escapeHtml(letterhead.logoUrl)}" alt="${escapeHtml(letterhead.productName)}"><div class="brand-name">${escapeHtml(letterhead.productName)}</div>`
    : `<div class="brand-name">${escapeHtml(letterhead.productName)}</div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>${escapeHtml(
    `${letterhead.productName} — ${PARTY_TITLE[s.partyType]} — ${s.monthLabel}`
  )}</title><style>${STYLE}</style></head><body>
<header>
  <div>${brandBlock}<div class="site">${escapeHtml(letterhead.site)}</div></div>
  <div class="doc">
    <h1>${escapeHtml(PARTY_TITLE[s.partyType])}${s.live ? '<span class="live">Month to date</span>' : ''}</h1>
    <div class="party">${escapeHtml(s.partyName)}</div>
    <div class="muted">${escapeHtml(s.monthLabel)} · ${escapeHtml(s.from)} to ${escapeHtml(s.to)}</div>
  </div>
</header>
${body}
<footer>${escapeHtml(letterhead.productName)} · ${escapeHtml(letterhead.site)} · Times are America/New_York.${
    s.live ? ' This month is still open; its figures change until it closes.' : ''
  }</footer>
</body></html>`;
}

function csv(rows: unknown[][]): string {
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}

/** The line items, as CSV. */
export function renderStatementCsv(s: StatementData): string {
  switch (s.partyType) {
    case 'BUYER':
      return csv([
        [
          'Date/time',
          'Caller',
          'Campaign',
          'Connected (seconds)',
          'Billable',
          'Amount',
          'Return status',
        ],
        ...s.lines.map(l => [
          l.at,
          l.caller,
          l.campaign,
          l.connectedSeconds ?? '',
          l.billable ? 'Yes' : 'No',
          l.amount.toFixed(2),
          l.returnStatus,
        ]),
        ...s.lateReturns.map(r => [
          r.callDate,
          '',
          r.label,
          '',
          '',
          (-r.amount).toFixed(2),
          'Return accepted',
        ]),
      ]);
    case 'PUBLISHER':
      return csv([
        ['Date/time', 'Campaign', 'Connected (seconds)', 'Billable', 'Payout', 'Status'],
        ...s.lines.map(l => [
          l.at,
          l.campaign,
          l.connectedSeconds ?? '',
          l.billable ? 'Yes' : 'No',
          l.payout.toFixed(2),
          l.status,
        ]),
        ...s.payments.map(p => [
          p.date,
          `Payment (${p.method}${p.reference ? ` ${p.reference}` : ''})`,
          '',
          '',
          p.amount.toFixed(2),
          'Paid',
        ]),
        ...s.returnsDeducted.map(r => [
          r.date,
          `Return deducted, call of ${r.callDate}`,
          '',
          '',
          (-r.amount).toFixed(2),
          'Deducted',
        ]),
      ]);
    case 'AGENCY':
      return csv([
        ['Section', 'Name', 'Calls', 'Billable', 'Amount'],
        ...s.revenueByBuyer.map(r => [
          'Revenue by buyer',
          r.name,
          r.calls,
          r.billable,
          r.revenue.toFixed(2),
        ]),
        ...s.payoutsByPublisher.map(r => [
          'Payout by publisher',
          r.name,
          r.calls,
          r.billable,
          r.payout.toFixed(2),
        ]),
        ...s.numberCharges.map(g => ['Number charges', g.name, g.count, '', g.total.toFixed(2)]),
        ...s.lateReturns.map(r => ['Returns', r.label, '', '', (-r.amount).toFixed(2)]),
        ['Total', 'Revenue', s.totals.inboundCalls, s.totals.billable, s.totals.revenue.toFixed(2)],
        ['Total', 'Publisher payouts', '', '', s.totals.publisherPayouts.toFixed(2)],
        [
          'Total',
          s.totals.callCostEstimated ? 'Call cost (estimated)' : 'Call cost',
          '',
          '',
          s.totals.callCost.toFixed(2),
        ],
        ['Total', 'Fees', '', '', s.totals.fees.toFixed(2)],
        ['Total', 'Adjustments', '', '', s.totals.adjustments.toFixed(2)],
        ['Total', 'Profit', '', '', s.totals.profit.toFixed(2)],
      ]);
    case 'CHILD_AGENCY':
      return csv([
        ['Section', 'Name', 'Calls taken', 'Applications', 'Closing %', 'Amount'],
        ...s.agents.map(a => [
          'Agent',
          a.name,
          a.callsTaken,
          a.applications,
          a.closingPct === null ? '' : a.closingPct.toFixed(2),
          a.annualizedPremium.toFixed(2),
        ]),
        ...s.numberCharges.map(g => ['Number charges', g.name, '', '', '', g.total.toFixed(2)]),
      ]);
  }
}
