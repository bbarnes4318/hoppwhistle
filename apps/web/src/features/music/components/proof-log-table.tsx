'use client';

import { CheckCircle2, Clock, FileText, Mic } from 'lucide-react';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import {
  formatDurationMmSs,
  outcomeLabel,
} from '../lib/utils';
import type { ProofRecord } from '../types';

interface ProofLogTableProps {
  records: ProofRecord[];
}

export function ProofLogTable({ records }: ProofLogTableProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-[var(--m-border)] bg-card/50 backdrop-blur-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-[var(--m-border)] bg-[var(--m-surface-2)]">
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Verified</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Fan</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Artist</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Campaign</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider">Outcome</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Duration</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-center">Recording</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-center">Transcript</th>
              <th className="px-4 py-3 font-semibold text-zinc-400 uppercase tracking-wider text-right">Timestamp</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r, i) => (
              <>
                <tr
                  key={r.id}
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className={cn(
                    'border-b border-zinc-800/50 transition-colors hover:bg-[var(--m-surface-3)] cursor-pointer',
                    i % 2 === 0 ? 'bg-transparent' : 'bg-zinc-900/20',
                    expanded === r.id && 'bg-[var(--m-surface-3)]'
                  )}
                >
                  <td className="px-4 py-3">
                    {r.verifiedAction
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                      : <Clock className="h-4 w-4 text-zinc-500" />}
                  </td>
                  <td className="px-4 py-3 font-medium text-zinc-200">{r.fanName}</td>
                  <td className="px-4 py-3 text-zinc-400">{r.artist}</td>
                  <td className="px-4 py-3 text-zinc-400 truncate max-w-[180px]">{r.campaignName}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'rounded-full px-2 py-0.5 text-[10px] font-medium',
                      r.verifiedAction ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'
                    )}>
                      {outcomeLabel(r.outcome)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-300 font-mono">{formatDurationMmSs(r.duration)}</td>
                  <td className="px-4 py-3 text-center">
                    {r.hasRecording ? <Mic className="h-3.5 w-3.5 text-blue-400 mx-auto" /> : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.hasTranscript ? <FileText className="h-3.5 w-3.5 text-cyan-400 mx-auto" /> : <span className="text-zinc-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-zinc-500 font-mono text-[10px]">
                    {new Date(r.timestamp).toLocaleString()}
                  </td>
                </tr>
                {expanded === r.id && r.transcriptSnippet && (
                  <tr key={`${r.id}-transcript`}>
                    <td colSpan={9} className="bg-zinc-900/60 px-8 py-4 border-b border-[var(--m-border)]">
                      <div className="text-xs text-zinc-400 uppercase tracking-wider mb-2 font-semibold">Fan Transcript</div>
                      <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono leading-relaxed bg-zinc-900 rounded-md p-3 border border-zinc-800">
                        {r.transcriptSnippet}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
