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
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Campaign</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Artist</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Status</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Fans Contacted</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Answers</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Verified</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Engagement</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Spent</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Proof</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c, i) => {
              const st = campaignStatusStyle(c.status);
              return (
                <tr
                  key={c.id}
                  className={cn(
                    'border-b border-zinc-800/50 transition-colors hover:bg-[var(--m-surface-3)]',
                    i % 2 === 0 ? 'bg-transparent' : 'bg-zinc-900/20'
                  )}
                >
                  <td className="px-4 py-3 font-medium text-zinc-200">{c.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{c.artist}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium text-blue-400">
                      {campaignTypeLabel(c.type)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium', st.bg, st.text)}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', st.dot)} />
                      {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300 font-mono">{formatCompactNumber(c.fansContacted)}</td>
                  <td className="px-4 py-3 text-right text-zinc-300 font-mono">{formatCompactNumber(c.humanAnswers)}</td>
                  <td className="px-4 py-3 text-right text-emerald-400 font-mono">{formatCompactNumber(c.verifiedEngagements)}</td>
                  <td className="px-4 py-3 text-right text-zinc-300 font-mono">{formatPercentage(c.fansContacted > 0 ? (c.verifiedEngagements / c.fansContacted) * 100 : 0)}</td>
                  <td className="px-4 py-3 text-right text-zinc-400 font-mono">{formatCurrency(c.verifiedEngagements * c.cpa)}</td>
                  <td className="px-4 py-3 text-right text-zinc-400 font-mono">{formatCompactNumber(c.proofCaptured)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
