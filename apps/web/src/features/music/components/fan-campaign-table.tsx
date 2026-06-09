'use client';

import {
  campaignStatusStyle,
  campaignTypeLabel,
  formatCompactNumber,
  formatCurrency,
  formatPercentage,
} from '../lib/utils';
import type { FanCampaign } from '../types';

import { cn } from '@/lib/utils';

interface FanCampaignTableProps {
  campaigns: FanCampaign[];
}

export function FanCampaignTable({ campaigns }: FanCampaignTableProps) {
  return (
    <div className="rounded-lg border border-[var(--m-border)] bg-card/50 backdrop-blur-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--m-border)] bg-[var(--m-surface-2)]">
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider">Campaign</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider">Artist</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider text-right">Fans Contacted</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider text-right">Answers</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider text-right">Verified</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider text-right">Engagement</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider text-right">Spent</th>
              <th className="px-4 py-3 font-semibold text-[var(--m-muted)] uppercase tracking-wider text-right">Proof</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c, i) => {
              const st = campaignStatusStyle(c.status);
              return (
                <tr
                  key={c.id}
                  className={cn(
                    'border-b border-[var(--m-border-2)] transition-colors hover:bg-[var(--m-surface-3)]',
                    i % 2 === 0 ? 'bg-transparent' : 'bg-[var(--m-surface-2)]/40'
                  )}
                >
                  <td className="px-4 py-3 font-semibold text-[var(--m-text)] pr-3">{c.name}</td>
                  <td className="px-4 py-3 text-[var(--m-text-2)]">{c.artist}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--m-accent-dim)] text-[var(--m-accent)] border border-[var(--m-accent)]/10">
                      {campaignTypeLabel(c.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold', st.bg, st.text)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
                      {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--m-text-2)] font-mono">{formatCompactNumber(c.fansContacted)}</td>
                  <td className="px-4 py-3 text-right text-[var(--m-text-2)] font-mono">{formatCompactNumber(c.humanAnswers)}</td>
                  <td className="px-4 py-3 text-right text-emerald-700 font-mono font-bold">{formatCompactNumber(c.verifiedEngagements)}</td>
                  <td className="px-4 py-3 text-right text-[var(--m-text-2)] font-mono">{formatPercentage(c.fansContacted > 0 ? (c.verifiedEngagements / c.fansContacted) * 100 : 0)}</td>
                  <td className="px-4 py-3 text-right text-[var(--m-text-2)] font-mono">{formatCurrency(c.verifiedEngagements * c.cpa)}</td>
                  <td className="px-4 py-3 text-right text-[var(--m-muted)] font-mono">{formatCompactNumber(c.proofCaptured)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
