'use client';

import type { QuoteLine } from '@hopwhistle/fex-engine/types';
import * as React from 'react';

import { Panel } from '@/components/domain';
import { ResultRow, SelectedQuoteBar } from '@/components/fex/result-row';
import type { FexFacts, FexResult, FexSelection } from '@/lib/fex/api';

/**
 * The quoter's result rows in every state, from static mock results -- no
 * API, no engine. The same way the softphone gallery mocks its calls.
 */

const line = (patch: Partial<QuoteLine>): QuoteLine => ({
  classCode: 'LEVEL',
  classLabel: 'Level',
  uwClass: 'LEVEL',
  benefit: 'LEVEL',
  db: null,
  face: 10000,
  premium: 41.18,
  annual: 494.16,
  mode: 'monthly',
  modeLabel: 'Monthly',
  basis: 'ANNUAL_PER_1000',
  faceAdjusted: null,
  premiumNote: null,
  payPeriod: null,
  ...patch,
});

const facts = (patch: Partial<FexFacts> = {}): FexFacts => ({
  issueAges: ['Level 45–85 (tobacco 45–80)'],
  faceLimits: [{ classCode: 'LEVEL', label: 'Level', min: 2000, max: 40000, byAge: [] }],
  policyFeeAnnual: 36,
  monthlyFactor: 0.0875,
  monthlyLabel: 'Monthly bank draft',
  ageBasis: 'Nearest birthday',
  ratesStatus: { label: '2026 source', tone: 'good' },
  uwStatus: 'Carrier guide 2026',
  sourceDate: '2026-03-01',
  stateUnavailable: ['NY'],
  benefitByClass: { LEVEL: 'Level' },
  alerts: [],
  ...patch,
});

const result = (patch: Partial<FexResult>): FexResult => ({
  productId: 'mock',
  carrier: 'Mock Life',
  family: 'Mock Life',
  product: 'Final Expense',
  type: 'SIWL',
  status: 'CURRENT',
  ratesStatus: 'CURRENT_2026',
  uwStatus: 'CURRENT_CARRIER_2026',
  uwLoaded: true,
  alerts: [],
  age: 68,
  ageBasis: 'ANB',
  eligible: true,
  outcome: 'LEVEL',
  outcomeLabel: 'Level',
  best: line({}),
  others: [],
  reasons: [],
  needsIndication: [],
  assumptions: [],
  refer: false,
  appointed: true,
  application: {
    carrier: 'Mock Life',
    product: 'Final Expense',
    planType: 'LEVEL',
    annualizedPremium: 494.16,
  },
  facts: facts(),
  ...patch,
});

export const QUOTER_MOCKS: Array<{
  id: string;
  label: string;
  result: FexResult;
  priceOnly?: boolean;
  expanded?: boolean;
}> = [
  {
    id: 'level',
    label: 'Level',
    result: result({ productId: 'm-level', family: 'Mutual of Omaha', product: 'Living Promise' }),
  },
  {
    id: 'graded',
    label: 'Graded',
    result: result({
      productId: 'm-graded',
      family: 'Americo',
      product: 'Eagle Select',
      outcome: 'GRADED',
      best: line({ classCode: 'GRADED', classLabel: 'Graded', benefit: 'GRADED', premium: 63.4 }),
      reasons: [{ kind: 'rule', outcome: 'GRADED', text: 'Insulin use within 24 months', page: 7 }],
    }),
  },
  {
    id: 'refer',
    label: 'Refer',
    result: result({
      productId: 'm-refer',
      family: 'Accendo / Aetna',
      product: 'Final Expense',
      refer: true,
      best: line({
        classCode: 'STANDARD',
        classLabel: 'Standard',
        premium: 52.9,
        faceAdjusted: 'Capped at the age 68 maximum of $20,000',
      }),
      facts: facts({ ratesStatus: { label: 'Verify rates', tone: 'warn' } }),
    }),
  },
  {
    id: 'price-only',
    label: 'Price only',
    priceOnly: true,
    result: result({
      productId: 'm-price',
      family: 'Sons of Norway',
      product: 'LegacySure',
      uwLoaded: false,
      best: line({ premium: 49.01 }),
    }),
  },
  {
    id: 'declined',
    label: 'Declined',
    result: result({
      productId: 'm-declined',
      family: 'Transamerica',
      product: 'FE Express Solution',
      eligible: false,
      outcome: 'DECLINE',
      best: null,
      ineligibleReason: 'Kidney dialysis — decline (p.4)',
    }),
  },
  {
    id: 'expanded',
    label: 'Expanded',
    expanded: true,
    result: result({
      productId: 'm-expanded',
      family: 'CICA Life',
      product: 'Superior Choice',
      reasons: [
        {
          kind: 'rule',
          outcome: 'LEVEL',
          text: 'Diabetes, controlled with oral medication — Level',
          page: 12,
          url: 'https://example.com/guide.pdf',
        },
        { kind: 'rx', outcome: 'LEVEL', text: 'Metformin for diabetes', page: 21 },
      ],
      assumptions: ['Diabetes: diagnosis age not entered — assumed after age 50'],
      others: [
        line({ classCode: 'GRADED', classLabel: 'Graded', benefit: 'GRADED', premium: 71.22 }),
      ],
      facts: facts({ alerts: ['Face amounts above $25,000 need a phone interview.'] }),
    }),
  },
];

const SELECTION: FexSelection = {
  fexQuoteId: 'mock',
  productId: 'm-level',
  carrier: 'Mutual of Omaha',
  product: 'Living Promise',
  classCode: 'LEVEL',
  classLabel: 'Level',
  benefit: 'LEVEL',
  face: 10000,
  premium: 41.18,
  mode: 'monthly',
  application: {
    carrier: 'Mutual of Omaha',
    product: 'Living Promise',
    planType: 'LEVEL',
    annualizedPremium: 494.16,
  },
};

export function QuoterGallery(): JSX.Element {
  const [open, setOpen] = React.useState<string | null>('m-expanded');
  return (
    <div className="space-y-4">
      <Panel className="overflow-hidden">
        <ul>
          {QUOTER_MOCKS.map(mock => (
            <ResultRow
              key={mock.id}
              result={mock.result}
              priceOnly={mock.priceOnly}
              expanded={open === mock.result.productId}
              onToggle={() =>
                setOpen(o => (o === mock.result.productId ? null : mock.result.productId))
              }
              onUse={() => {}}
              onCopy={() => {}}
              onSave={() => {}}
            />
          ))}
        </ul>
      </Panel>
      <Panel className="overflow-hidden">
        <SelectedQuoteBar selection={SELECTION} onStart={() => {}} onClear={() => {}} />
      </Panel>
    </div>
  );
}
