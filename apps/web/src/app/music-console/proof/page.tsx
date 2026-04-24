'use client';

import {
  Calendar,
  Check,
  CheckCircle2,
  Download,
  FileText,
  Link as LinkIcon,
  Megaphone,
  Mic,
  Play,
  Search,
  ShieldCheck,
  User,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { proofRecords } from '@/features/music/data/demo-music-data';
import { formatCurrency, outcomeLabel, segmentLabel } from '@/features/music/lib/utils';
import { ProofRecord } from '@/features/music/types';
import { cn } from '@/lib/utils';

export default function MusicProofPage() {
  const [selectedProof, setSelectedProof] = useState<ProofRecord>();
  
  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('All Outcomes');
  const [filterIntent, setFilterIntent] = useState('All Intents');
  const [requireRecording, setRequireRecording] = useState(false);

  const filteredRecords = proofRecords.filter(r => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!r.fanName.toLowerCase().includes(q) && !r.campaignName.toLowerCase().includes(q) && !r.artist.toLowerCase().includes(q)) return false;
    }
    if (filterOutcome !== 'All Outcomes') {
      const isVerified = filterOutcome === 'Verified';
      if (r.verifiedAction !== isVerified) return false;
    }
    if (filterIntent !== 'All Intents') {
      if (r.intent.toLowerCase() !== filterIntent.replace('Intent: ', '').toLowerCase()) return false;
    }
    if (requireRecording && !r.hasRecording) {
      return false;
    }
    return true;
  });

  const renderTranscript = (snippet: string) => {
    if (!snippet) return null;
    return snippet.split('\n').map((line, i) => {
      const isAI = line.startsWith('AI:');
      const isFan = line.startsWith('Fan:');
      const content = line.replace(/^(AI|Fan):\s*/, '');
      return (
        <div key={i} className={cn("m-transcript-line", isAI && "m-transcript-line--ai")}>
          <div className={cn("m-transcript-speaker", isAI ? "m-transcript-speaker--ai" : "m-transcript-speaker--fan")}>
            {isAI ? 'AI Agent' : isFan ? 'Fan' : ''}
          </div>
          <div className="m-transcript-text">{content}</div>
        </div>
      );
    });
  };

  return (
    <div className="relative z-10 p-6 md:p-8 space-y-6">
      
      {/* ─── Header ─── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--m-border-2)] pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 m-text-accent-2" /> Proof Log
          </h1>
          <p className="mt-1 text-sm m-text-muted max-w-xl">
            Every fan interaction can be proven with timestamp, recording, transcript, sentiment, intent, and outcome.
          </p>
        </div>
      </header>

      {/* ─── Filters ─── */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center bg-[var(--m-surface-2)] border border-[var(--m-border)] p-4 rounded-lg">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 m-text-dim" />
          <input 
            type="text" 
            placeholder="Search fans, artists, campaigns..." 
            className="w-full pl-9 pr-4 py-2 bg-[var(--m-bg)] border border-[var(--m-border)] rounded-md text-sm focus:outline-none focus:border-[var(--m-accent)] text-[var(--m-text)]"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex flex-wrap items-center gap-3">
          <select 
            className="bg-[var(--m-bg)] border border-[var(--m-border)] rounded-md px-3 py-2 text-sm text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)] appearance-none cursor-pointer"
            value={filterOutcome}
            onChange={(e) => setFilterOutcome(e.target.value)}
          >
            <option>All Outcomes</option>
            <option>Verified</option>
            <option>Neutral</option>
          </select>
          
          <select 
            className="bg-[var(--m-bg)] border border-[var(--m-border)] rounded-md px-3 py-2 text-sm text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)] appearance-none cursor-pointer"
            value={filterIntent}
            onChange={(e) => setFilterIntent(e.target.value)}
          >
            <option>All Intents</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>

          <label className="flex items-center gap-2 text-sm m-text-text cursor-pointer ml-2">
            <input 
              type="checkbox" 
              className="accent-[var(--m-accent)] h-4 w-4" 
              checked={requireRecording}
              onChange={(e) => setRequireRecording(e.target.checked)}
            /> 
            Has Recording
          </label>
        </div>
      </div>

      {/* ─── Table ─── */}
      <div className="m-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="m-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Fan</th>
                <th>Artist</th>
                <th>Campaign</th>
                <th>Segment</th>
                <th className="text-center">Score</th>
                <th className="text-center">Sentiment</th>
                <th className="text-center">Intent</th>
                <th>Outcome</th>
                <th className="text-center">Proof</th>
                <th>Proof ID</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.map((r) => (
                <tr 
                  key={r.id} 
                  onClick={() => setSelectedProof(r)}
                  className="cursor-pointer"
                >
                  <td className="m-font-mono text-[10px] m-text-dim">
                    {new Date(r.timestamp).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                  </td>
                  <td className="font-medium text-[var(--m-text)]">{r.fanName}</td>
                  <td className="m-text-muted">{r.artist}</td>
                  <td className="m-text-muted truncate max-w-[150px]">{r.campaignName}</td>
                  <td className="m-text-dim text-[10px]">{segmentLabel(r.segment)}</td>
                  <td className="text-center m-font-mono m-text-accent">{r.engagementScore}</td>
                  <td className="text-center">
                    <span className={cn(
                      "inline-flex h-2 w-2 rounded-full",
                      r.sentiment === 'positive' ? 'bg-[var(--m-accent-2)]' : r.sentiment === 'negative' ? 'bg-[var(--m-danger)]' : 'bg-[var(--m-dim)]'
                    )} />
                  </td>
                  <td className="text-center">
                    <span className={cn(
                      "text-[10px] font-bold uppercase tracking-wider",
                      r.intent === 'high' ? 'm-text-accent-2' : r.intent === 'medium' ? 'm-text-warning' : 'm-text-dim'
                    )}>
                      {r.intent}
                    </span>
                  </td>
                  <td>
                    <span className={cn("m-badge", r.verifiedAction ? "m-badge--verified" : "m-badge--neutral")}>
                      {outcomeLabel(r.outcome)}
                    </span>
                  </td>
                  <td>
                    <div className="flex items-center justify-center gap-2">
                      {r.hasRecording ? <Mic className="h-3.5 w-3.5 m-text-accent" /> : <span className="h-3.5 w-3.5" />}
                      {r.hasTranscript ? <FileText className="h-3.5 w-3.5 m-text-accent-2" /> : <span className="h-3.5 w-3.5" />}
                    </div>
                  </td>
                  <td className="m-text-dim m-font-mono text-[9px] uppercase">{r.id.split('-')[1]}A9F</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── Detail Drawer ─── */}
      {selectedProof && (
        <div className="m-drawer-overlay">
          <div className="m-drawer">
            
            {/* Drawer Header */}
            <div className="m-drawer-header flex items-start justify-between">
              <div>
                <div className="flex items-center gap-3 mb-2">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <User className="h-5 w-5 m-text-muted" /> {selectedProof.fanName}
                  </h2>
                  <span className={cn("m-badge", selectedProof.verifiedAction ? "m-badge--verified" : "m-badge--neutral")}>
                    {outcomeLabel(selectedProof.outcome)}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs m-text-muted">
                  <span className="flex items-center gap-1.5"><Mic className="h-3.5 w-3.5" /> {selectedProof.artist}</span>
                  <span className="flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> {selectedProof.campaignName}</span>
                  <span className="m-font-mono text-[10px] m-text-dim uppercase border-l border-[var(--m-border)] pl-4">ID: {selectedProof.id.split('-')[1]}A9F</span>
                </div>
              </div>
              <button onClick={() => setSelectedProof(undefined)} className="m-text-dim hover:text-[var(--m-text)] m-bg-surface p-1.5 rounded">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="m-drawer-body space-y-8">
              
              {/* Audio & Intent */}
              <div className="grid grid-cols-2 gap-4">
                <div className="m-card-flush p-4 flex flex-col justify-between">
                  <p className="m-kpi-label mb-3">Audio Proof</p>
                  {selectedProof.hasRecording ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-3">
                        <button className="h-10 w-10 rounded-full bg-[var(--m-accent)] flex items-center justify-center text-white hover:opacity-90 transition-opacity">
                          <Play className="h-4 w-4 ml-0.5" />
                        </button>
                        <div className="m-waveform flex-1">
                          {Array.from({ length: 30 }).map((_, i) => (
                            <div key={i} className="m-waveform-bar" style={{ height: `${Math.random() * 80 + 20}%` }} />
                          ))}
                        </div>
                      </div>
                      <div className="flex justify-between text-[10px] m-text-dim m-font-mono">
                        <span>0:00</span>
                        <span>{Math.floor(selectedProof.duration / 60)}:{(selectedProof.duration % 60).toString().padStart(2, '0')}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs m-text-dim py-4">No audio recording available.</div>
                  )}
                </div>

                <div className="m-card-flush p-4">
                  <p className="m-kpi-label mb-3">Intent & Sentiment</p>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs m-text-muted">Captured Intent</span>
                      <span className={cn(
                        "text-xs font-bold uppercase",
                        selectedProof.intent === 'high' ? "m-text-accent-2" : selectedProof.intent === 'medium' ? "m-text-warning" : "m-text-dim"
                      )}>{selectedProof.intent}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs m-text-muted">Sentiment</span>
                      <span className="text-xs font-medium capitalize flex items-center gap-2">
                        <span className={cn("h-2 w-2 rounded-full", selectedProof.sentiment === 'positive' ? 'bg-[var(--m-accent-2)]' : selectedProof.sentiment === 'negative' ? 'bg-[var(--m-danger)]' : 'bg-[var(--m-dim)]')} />
                        {selectedProof.sentiment}
                      </span>
                    </div>
                    <div className="flex items-center justify-between pt-2 border-t border-[var(--m-border-2)]">
                      <span className="text-xs m-text-muted">Disposition</span>
                      <span className="text-xs m-font-mono m-text-accent-2">{outcomeLabel(selectedProof.outcome)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Transcript */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="m-section-title">
                    <FileText className="!text-[var(--m-accent-2)]" /> Verbatim Transcript
                  </h3>
                  <button className="m-btn m-btn--ghost">
                    <Download className="h-3 w-3" /> Export
                  </button>
                </div>
                {selectedProof.hasTranscript && selectedProof.transcriptSnippet ? (
                  <div className="m-transcript space-y-2">
                    {renderTranscript(selectedProof.transcriptSnippet)}
                    {selectedProof.verifiedAction && (
                      <div className="mt-4 p-3 rounded border border-[var(--m-accent-2)]/20 bg-[var(--m-accent-2-dim)] flex items-start gap-3">
                        <CheckCircle2 className="h-4 w-4 m-text-accent-2 mt-0.5" />
                        <div>
                          <p className="text-xs font-medium m-text-accent-2">Verified Action Detected</p>
                          <p className="text-[10px] m-text-muted mt-1">System captured explicit intent related to the campaign goal.</p>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="m-card-deep p-8 text-center text-xs m-text-dim">
                    Transcript processing or unavailable for this status.
                  </div>
                )}
              </div>

              {/* Attribution & Compliance */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-4">
                  <h3 className="m-kpi-label border-b border-[var(--m-border-2)] pb-2">Campaign Attribution</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="m-text-dim">Source Target</span><span>{segmentLabel(selectedProof.segment)}</span></div>
                    <div className="flex justify-between"><span className="m-text-dim">Score</span><span className="m-font-mono">{selectedProof.engagementScore}/100</span></div>
                    <div className="flex justify-between"><span className="m-text-dim">CPA Applied</span><span className="m-font-mono m-text-accent">{formatCurrency(selectedProof.cpaAttribution)}</span></div>
                    {selectedProof.verifiedAction && (
                      <div className="flex items-center gap-1.5 m-text-accent-2 mt-2">
                        <LinkIcon className="h-3 w-3" /> <span className="font-medium hover:underline cursor-pointer">View Generated Tracking Link</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <h3 className="m-kpi-label border-b border-[var(--m-border-2)] pb-2">Compliance & Privacy</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="m-text-dim">Phone Map</span><span className="m-font-mono">{selectedProof.fanPhone.replace(/\d{4}$/, 'XXXX')}</span></div>
                    <div className="flex justify-between"><span className="m-text-dim">Consent Source</span><span>{selectedProof.consentSource}</span></div>
                    <div className="flex justify-between"><span className="m-text-dim">DNC Check</span><span className="m-text-accent-2 flex items-center gap-1"><Check className="h-3 w-3" /> Passed</span></div>
                    <div className="flex justify-between"><span className="m-text-dim">AI Disclosure</span><span className="m-text-accent-2 flex items-center gap-1"><Check className="h-3 w-3" /> Delivered</span></div>
                  </div>
                </div>
                
                <div className="space-y-4">
                  <h3 className="m-kpi-label border-b border-[var(--m-border-2)] pb-2">Carrier Telemetry</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="m-text-dim">SIP Response</span><span className="m-font-mono">{selectedProof.status === 'completed' ? '200 OK' : selectedProof.status === 'no_answer' ? '408 Request Timeout' : '486 Busy Here'}</span></div>
                    <div className="flex justify-between"><span className="m-text-dim">Network Route</span><span>DIDCentral → US-East-1</span></div>
                    <div className="flex justify-between"><span className="m-text-dim">Avg Jitter</span><span className="m-font-mono">{Math.floor(Math.random() * 5) + 1}ms</span></div>
                    <div className="flex justify-between"><span className="m-text-dim">STIR/SHAKEN</span><span className="m-text-accent-2 flex items-center gap-1"><Check className="h-3 w-3" /> A-Attest</span></div>
                  </div>
                </div>
              </div>

              {/* Timeline */}
              <div className="pt-4 border-t border-[var(--m-border-2)]">
                <h3 className="m-kpi-label mb-4">Interaction Timeline</h3>
                <div className="relative pl-4 space-y-4 before:absolute before:inset-y-0 before:left-[7px] before:w-px before:bg-[var(--m-border-2)]">
                  <div className="relative text-xs">
                    <span className="absolute -left-4 top-1 h-1.5 w-1.5 rounded-full bg-[var(--m-dim)] ring-4 ring-[var(--m-bg)]" />
                    <span className="m-text-dim m-font-mono mr-2">14:30:00</span> <span className="m-text-muted">Outbound dial initiated</span>
                  </div>
                  <div className="relative text-xs">
                    <span className="absolute -left-4 top-1 h-1.5 w-1.5 rounded-full bg-[var(--m-accent)] ring-4 ring-[var(--m-bg)]" />
                    <span className="m-text-dim m-font-mono mr-2">14:30:12</span> <span>Fan answered, AI disclosure played</span>
                  </div>
                  {selectedProof.verifiedAction && (
                    <div className="relative text-xs">
                      <span className="absolute -left-4 top-1 h-1.5 w-1.5 rounded-full bg-[var(--m-accent-2)] ring-4 ring-[var(--m-bg)]" />
                      <span className="m-text-dim m-font-mono mr-2">14:31:05</span> <span className="m-text-accent-2 font-medium">Verified intent captured ({outcomeLabel(selectedProof.outcome)})</span>
                    </div>
                  )}
                  <div className="relative text-xs">
                    <span className="absolute -left-4 top-1 h-1.5 w-1.5 rounded-full bg-[var(--m-dim)] ring-4 ring-[var(--m-bg)]" />
                    <span className="m-text-dim m-font-mono mr-2">14:31:45</span> <span className="m-text-muted">Call disconnected normally</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
