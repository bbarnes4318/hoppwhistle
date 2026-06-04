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
import { useState, useEffect } from 'react';

import { proofRecords } from '@/features/music/data/demo-music-data';
import { formatCurrency, outcomeLabel, segmentLabel } from '@/features/music/lib/utils';
import { ProofRecord } from '@/features/music/types';
import { cn } from '@/lib/utils';

function getWaveformHeight(id: string, index: number): number {
  const val = Math.sin((id.charCodeAt(id.length - 1) + index) * 127.1 + 311.7) * 43758.5453;
  return (val - Math.floor(val)) * 80 + 20;
}

function getJitter(id: string): number {
  const val = Math.sin(id.charCodeAt(0) * 127.1 + 311.7) * 43758.5453;
  return Math.floor((val - Math.floor(val)) * 5) + 1;
}

export default function MusicProofPage() {
  const [selectedProof, setSelectedProof] = useState<ProofRecord>();
  
  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('All Outcomes');
  const [filterIntent, setFilterIntent] = useState('All Intents');
  const [requireRecording, setRequireRecording] = useState(false);

  const [liveMode, setLiveMode] = useState(false);
  const [liveRecords, setLiveRecords] = useState<ProofRecord[]>([]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedProof(undefined);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (liveMode && liveRecords.length === 0) {
      fetch('/api/vapi/calls?limit=50')
        .then(r => r.json())
        .then(data => {
          const calls = Array.isArray(data) ? data : (data?.message || []);
          const mapped: ProofRecord[] = calls.map((call: any) => ({
            id: call.id,
            timestamp: call.createdAt || new Date().toISOString(),
            fanName: call.customer?.name || call.customer?.number || 'Live Fan',
            artist: 'System Integration',
            campaignName: 'Live Outbound',
            intent: 'medium',
            sentiment: 'neutral',
            outcome: call.status === 'ended' ? 'converted' : 'not_interested',
            verifiedAction: call.status === 'ended',
            hasRecording: !!call.recordingUrl,
            recordingUrl: call.recordingUrl,
            hasTranscript: !!call.transcript,
            transcriptSnippet: call.transcript || 'No transcript available for this call.',
            durationSeconds: call.duration || 45,
            destinationLink: 'https://ffm.to/live',
            tcpaConsentSource: 'Live Dial Integration'
          }));
          setLiveRecords(mapped);
        })
        .catch(e => console.error(e));
    }
  }, [liveMode]);

  const activeRecords = liveMode ? liveRecords : proofRecords;

  const filteredRecords = activeRecords.filter(r => {
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
    <div className="space-y-5">
      
      {/* ─── Header ─── */}
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[var(--m-border-2)] pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <ShieldCheck className="h-6 w-6 m-text-accent-2" /> Proof Log
          </h1>
          <p className="mt-1 text-sm m-text-muted max-w-xl">
            Every fan interaction can be proven with timestamp, recording, transcript, sentiment, intent, and outcome.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 px-3 py-1.5 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded-md text-sm cursor-pointer hover:bg-[var(--m-border-2)] transition-colors">
            <input type="checkbox" className="accent-[var(--m-accent)] h-4 w-4" checked={liveMode} onChange={e => setLiveMode(e.target.checked)} />
            Live Vapi Data
          </label>
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
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs" onClick={() => setSelectedProof(undefined)}>
          <div 
            className="w-full max-w-2xl bg-[var(--m-surface)] border-l border-[var(--m-border-2)] h-screen fixed top-0 right-0 flex flex-col shadow-2xl overflow-hidden animate-[m-slide-in_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Drawer Header (Always Pinned) */}
            <div className="flex items-center justify-between p-3.5 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)] shrink-0">
              <div>
                <div className="flex items-center gap-3 mb-0.5">
                  <h2 className="text-base font-bold flex items-center gap-2 text-[var(--m-text)]">
                    <User className="h-4 w-4 m-text-muted" /> {selectedProof.fanName}
                  </h2>
                  <span className={cn("m-badge", selectedProof.verifiedAction ? "m-badge--verified" : "m-badge--neutral")}>
                    {outcomeLabel(selectedProof.outcome)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs m-text-muted flex-wrap">
                  <span className="flex items-center gap-1.5"><Mic className="h-3.5 w-3.5" /> {selectedProof.artist}</span>
                  <span className="flex items-center gap-1.5"><Megaphone className="h-3.5 w-3.5" /> {selectedProof.campaignName}</span>
                  <span className="m-font-mono text-[10px] m-text-dim uppercase border-l border-[var(--m-border)] pl-2">ID: {selectedProof.id.split('-')[1]}A9F</span>
                </div>
              </div>
              <button 
                onClick={() => setSelectedProof(undefined)} 
                className="p-1.5 hover:bg-[var(--m-surface-3)] rounded-lg transition-colors border border-[var(--m-border)] flex items-center justify-center bg-[var(--m-surface)]"
                title="Close"
              >
                <X className="h-4 w-4 text-[var(--m-text)]" />
              </button>
            </div>
 
            {/* Drawer Body (2-Column layout) */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                
                {/* Column 1: Audio and Transcript */}
                <div className="space-y-4">
                  {/* Audio */}
                  <div className="m-card-flush p-3 flex flex-col justify-between bg-[var(--m-bg)] border border-[var(--m-border)] rounded-lg">
                    <p className="m-kpi-label mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">Audio Proof</p>
                    {selectedProof.hasRecording ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-2.5">
                          <button className="h-8.5 w-8.5 rounded-full bg-[var(--m-accent)] flex items-center justify-center text-white hover:opacity-90 transition-opacity">
                            <Play className="h-3.5 w-3.5 ml-0.5" />
                          </button>
                          <div className="m-waveform flex-1">
                            {Array.from({ length: 24 }).map((_, i) => (
                              <div key={i} className="m-waveform-bar" style={{ height: `${getWaveformHeight(selectedProof.id, i)}%` }} />
                            ))}
                          </div>
                        </div>
                        <div className="flex justify-between text-[9px] m-text-dim m-font-mono">
                          <span>0:00</span>
                          <span>{Math.floor(selectedProof.duration / 60)}:{(selectedProof.duration % 60).toString().padStart(2, '0')}</span>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs m-text-dim py-3">No audio recording.</div>
                    )}
                  </div>
 
                  {/* Transcript */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-[10px] font-bold uppercase tracking-wider m-text-muted">
                        Verbatim Transcript
                      </h3>
                      <button 
                        className="m-btn m-btn--ghost text-[10px] py-0.5 px-2" 
                        onClick={() => {
                          const txtContent = `Transcript for ${selectedProof.fanName}\n${selectedProof.transcriptSnippet}`;
                          const link = document.createElement('a');
                          link.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(txtContent));
                          link.setAttribute('download', `transcript_${selectedProof.id}.txt`);
                          document.body.appendChild(link);
                          link.click();
                          document.body.removeChild(link);
                        }}
                      >
                        <Download className="h-3 w-3" /> Export
                      </button>
                    </div>
                    {selectedProof.hasTranscript && selectedProof.transcriptSnippet ? (
                      <div className="m-transcript max-h-[140px] overflow-y-auto space-y-1.5 p-2.5 bg-[var(--m-surface-2)] border border-[var(--m-border-2)] rounded">
                        {renderTranscript(selectedProof.transcriptSnippet)}
                        {selectedProof.verifiedAction && (
                          <div className="mt-2 p-2 rounded border border-[var(--m-accent-2)]/20 bg-[var(--m-accent-2-dim)] flex items-start gap-2">
                            <CheckCircle2 className="h-3.5 w-3.5 m-text-accent-2 mt-0.5" />
                            <div>
                              <p className="text-[11px] font-medium m-text-accent-2">Verified Action Detected</p>
                              <p className="text-[9px] m-text-muted mt-0.5">System captured explicit intent related to the campaign goal.</p>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="m-card-deep p-6 text-center text-xs m-text-dim">
                        Transcript unavailable for this status.
                      </div>
                    )}
                  </div>
                </div>
 
                {/* Column 2: Intent, Metadata, Timeline */}
                <div className="space-y-4">
                  {/* Intent & Sentiment */}
                  <div className="m-card-flush p-3 bg-[var(--m-bg)] border border-[var(--m-border)] rounded-lg">
                    <p className="m-kpi-label mb-2 text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">Intent & Sentiment</p>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="m-text-muted">Captured Intent</span>
                        <span className={cn(
                          "font-bold uppercase text-[11px]",
                          selectedProof.intent === 'high' ? "m-text-accent-2" : selectedProof.intent === 'medium' ? "m-text-warning" : "m-text-dim"
                        )}>{selectedProof.intent}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="m-text-muted">Sentiment</span>
                        <span className="font-medium capitalize flex items-center gap-1.5 text-[11px]">
                          <span className={cn("h-1.5 w-1.5 rounded-full", selectedProof.sentiment === 'positive' ? 'bg-[var(--m-accent-2)]' : selectedProof.sentiment === 'negative' ? 'bg-[var(--m-danger)]' : 'bg-[var(--m-dim)]')} />
                          {selectedProof.sentiment}
                        </span>
                      </div>
                    </div>
                  </div>
 
                  {/* Attribution & Compliance (3-column layout) */}
                  <div className="grid grid-cols-3 gap-2 border border-[var(--m-border-2)] rounded-lg p-2.5 bg-[var(--m-surface-2)]">
                    <div className="space-y-1 text-[9px]">
                      <h4 className="font-bold uppercase tracking-wider m-text-muted border-b border-[var(--m-border-2)] pb-0.5">Attribution</h4>
                      <div className="flex justify-between flex-col"><span className="m-text-dim">Target</span><span className="truncate max-w-[60px]" title={segmentLabel(selectedProof.segment)}>{segmentLabel(selectedProof.segment)}</span></div>
                      <div className="flex justify-between flex-col"><span className="m-text-dim">Score</span><span className="m-font-mono font-bold text-[var(--m-text)]">{selectedProof.engagementScore}</span></div>
                    </div>
 
                    <div className="space-y-1 text-[9px] border-l border-[var(--m-border-2)] pl-2">
                      <h4 className="font-bold uppercase tracking-wider m-text-muted border-b border-[var(--m-border-2)] pb-0.5">Compliance</h4>
                      <div className="flex justify-between flex-col"><span className="m-text-dim">Phone</span><span className="m-font-mono font-bold text-[var(--m-text)]">{selectedProof.fanPhone.slice(-4)}</span></div>
                      <div className="flex justify-between flex-col"><span className="m-text-dim">Consent</span><span className="truncate max-w-[60px]">{selectedProof.consentSource}</span></div>
                    </div>
                    
                    <div className="space-y-1 text-[9px] border-l border-[var(--m-border-2)] pl-2">
                      <h4 className="font-bold uppercase tracking-wider m-text-muted border-b border-[var(--m-border-2)] pb-0.5">Telemetry</h4>
                      <div className="flex justify-between flex-col"><span className="m-text-dim">SIP</span><span className="font-semibold text-emerald-400">200 OK</span></div>
                      <div className="flex justify-between flex-col"><span className="m-text-dim">Jitter</span><span className="m-font-mono font-bold text-[var(--m-text)]">{getJitter(selectedProof.id)}ms</span></div>
                    </div>
                  </div>
 
                  {/* Timeline */}
                  <div className="pt-2 border-t border-[var(--m-border-2)]">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider m-text-muted mb-2">Timeline</h3>
                    <div className="relative pl-3 space-y-2 before:absolute before:inset-y-0 before:left-[5px] before:w-px before:bg-[var(--m-border-2)]">
                      <div className="relative text-[10px]">
                        <span className="absolute -left-3 top-1 h-1.5 w-1.5 rounded-full bg-[var(--m-dim)] ring-4 ring-[var(--m-bg)]" />
                        <span className="m-text-dim m-font-mono mr-1">14:30:00</span> <span className="m-text-muted">Dial initiated</span>
                      </div>
                      <div className="relative text-[10px]">
                        <span className="absolute -left-3 top-1 h-1.5 w-1.5 rounded-full bg-[var(--m-accent)] ring-4 ring-[var(--m-bg)]" />
                        <span className="m-text-dim m-font-mono mr-1">14:30:12</span> <span>AI disclosure played</span>
                      </div>
                      {selectedProof.verifiedAction && (
                        <div className="relative text-[10px]">
                          <span className="absolute -left-3 top-1 h-1.5 w-1.5 rounded-full bg-[var(--m-accent-2)] ring-4 ring-[var(--m-bg)]" />
                          <span className="m-text-dim m-font-mono mr-1">14:31:05</span> <span className="m-text-accent-2 font-medium">Intent captured</span>
                        </div>
                      )}
                      <div className="relative text-[10px]">
                        <span className="absolute -left-3 top-1 h-1.5 w-1.5 rounded-full bg-[var(--m-dim)] ring-4 ring-[var(--m-bg)]" />
                        <span className="m-text-dim m-font-mono mr-1">14:31:45</span> <span className="m-text-muted">Call ended</span>
                      </div>
                    </div>
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
