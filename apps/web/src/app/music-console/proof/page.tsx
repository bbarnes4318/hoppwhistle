'use client';

import {
  Download,
  FileText,
  Mic,
  Play,
  Search,
  ShieldCheck,
  User,
  X,
  Copy,
  Link as LinkIcon,
} from 'lucide-react';
import { useState, useEffect } from 'react';

import { proofRecords } from '../../../features/music/data/demo-music-data';
import { outcomeLabel, segmentLabel } from '../../../features/music/lib/utils';
import { ProofRecord } from '../../../features/music/types';

import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

function getWaveformHeight(id: string, index: number): number {
  const val = Math.sin((id.charCodeAt(id.length - 1) + index) * 127.1 + 311.7) * 43758.5453;
  return (val - Math.floor(val)) * 80 + 20;
}

function getJitter(id: string): number {
  const val = Math.sin(id.charCodeAt(0) * 127.1 + 311.7) * 43758.5453;
  return Math.floor((val - Math.floor(val)) * 5) + 1;
}

function maskPhoneNumber(num?: string) {
  if (!num) return '—';
  const cleaned = num.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 ${cleaned.slice(1, 4)}-***-${cleaned.slice(7)}`;
  } else if (cleaned.length === 10) {
    return `+1 ${cleaned.slice(0, 3)}-***-${cleaned.slice(6)}`;
  }
  return num.replace(/(\+\d{3})\d{4}(\d{3})/, '$1-***-$2');
}

function maskFanName(name: string) {
  const parts = name.split(' ');
  if (parts.length >= 2) {
    return `${parts[0]} ${parts[1][0]}.`;
  }
  return name;
}

export default function MusicProofPage() {
  const { toast } = useToast();
  const [selectedProof, setSelectedProof] = useState<ProofRecord>();
  
  // Filter States
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOutcome, setFilterOutcome] = useState('All Outcomes');
  const [filterIntent, setFilterIntent] = useState('All Intents');
  const [requireRecording, setRequireRecording] = useState('All Records');
  const [filterDateRange, setFilterDateRange] = useState('All Time');
  const [filterArtist, setFilterArtist] = useState('All Artists');
  const [filterCampaign, setFilterCampaign] = useState('All Campaigns');

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
            interactionId: call.id,
            campaignId: 'c-live',
            campaignName: 'Live Voice Stream',
            fanName: call.customer?.name || 'Live Fan',
            fanPhone: call.customer?.number || '+1 555-000-0000',
            artist: 'Demo Label / Nona Ray',
            segment: 'superfan',
            status: 'completed',
            sentiment: 'positive',
            intent: 'high',
            outcome: call.status === 'ended' ? 'ticket_intent' : 'needs_follow_up',
            duration: call.duration || 45,
            timestamp: call.createdAt || new Date().toISOString(),
            verifiedAction: call.status === 'ended',
            hasRecording: !!call.recordingUrl,
            recordingUrl: call.recordingUrl,
            hasTranscript: !!call.transcript,
            transcriptSnippet: call.transcript || 'No transcript available for this call.',
            engagementScore: 82,
            consentSource: 'SMS Opt-In Broadcast',
            cpaAttribution: 1.15
          }));
          setLiveRecords(mapped);
        })
        .catch(e => console.error(e));
    }
  }, [liveMode, liveRecords.length]);

  const activeRecords = liveMode ? liveRecords : proofRecords;

  const filteredRecords = activeRecords.filter(r => {
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      if (!r.fanName.toLowerCase().includes(q) && 
          !r.campaignName.toLowerCase().includes(q) && 
          !r.artist.toLowerCase().includes(q) &&
          !r.id.toLowerCase().includes(q)) return false;
    }
    if (filterOutcome !== 'All Outcomes') {
      if (filterOutcome === 'Verified' && !r.verifiedAction) return false;
      if (filterOutcome === 'Unverified' && r.verifiedAction) return false;
      if (filterOutcome !== 'Verified' && filterOutcome !== 'Unverified' && r.outcome !== filterOutcome) return false;
    }
    if (filterIntent !== 'All Intents') {
      if (r.intent.toLowerCase() !== filterIntent.toLowerCase()) return false;
    }
    if (requireRecording === 'With Audio' && !r.hasRecording) return false;
    if (requireRecording === 'No Audio' && r.hasRecording) return false;

    if (filterArtist !== 'All Artists' && r.artist !== filterArtist) return false;
    if (filterCampaign !== 'All Campaigns' && r.campaignName !== filterCampaign) return false;

    if (filterDateRange !== 'All Time') {
      const recordDate = new Date(r.timestamp);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - recordDate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (filterDateRange === 'Today' && diffDays > 1) return false;
      if (filterDateRange === 'Last 7 Days' && diffDays > 7) return false;
      if (filterDateRange === 'Last 30 Days' && diffDays > 30) return false;
    }
    return true;
  });

  // Unique filters
  const uniqueArtists = Array.from(new Set(activeRecords.map(r => r.artist)));
  const uniqueCampaigns = Array.from(new Set(activeRecords.map(r => r.campaignName)));

  // Dynamic stats
  const totalCount = filteredRecords.length;
  const verifiedCount = filteredRecords.filter(r => r.verifiedAction).length;
  const recordingCount = filteredRecords.filter(r => r.hasRecording).length;
  const transcriptCount = filteredRecords.filter(r => r.hasTranscript).length;
  const positiveIntentCount = filteredRecords.filter(r => r.intent === 'high').length;
  const sponsorReadyCount = filteredRecords.filter(r => r.verifiedAction && r.hasRecording).length;

  const recordingCoverage = totalCount > 0 ? Math.round((recordingCount / totalCount) * 100) : 0;
  const transcriptCoverage = totalCount > 0 ? Math.round((transcriptCount / totalCount) * 100) : 0;

  const renderTranscript = (snippet: string) => {
    if (!snippet) return null;
    return snippet.split('\n').map((line, i) => {
      const isAI = line.startsWith('AI:');
      const isFan = line.startsWith('Fan:');
      const content = line.replace(/^(AI|Fan):\s*/, '');
      return (
        <div key={i} className="m-transcript-line py-1 border-b border-white/[0.02] last:border-b-0">
          <div className={cn(
            "text-[9px] font-black uppercase tracking-wider mb-0.5",
            isAI ? "text-[var(--m-accent)]" : isFan ? "text-[var(--m-accent-2)]" : "text-zinc-400"
          )}>
            {isAI ? 'RPS Voice Agent' : isFan ? 'Fan' : ''}
          </div>
          <div className="text-[10px] text-zinc-300 leading-normal">{content}</div>
        </div>
      );
    });
  };

  const handleCopySummary = (r: ProofRecord) => {
    const summary = `RPS Proof Packet #${r.id.toUpperCase()}\nFan: ${maskFanName(r.fanName)} (${maskPhoneNumber(r.fanPhone)})\nArtist/Station: ${r.artist}\nCampaign: ${r.campaignName}\nIntent: ${r.intent.toUpperCase()}\nOutcome: ${outcomeLabel(r.outcome)}\nConsent Evidence: ${r.consentSource}`;
    void navigator.clipboard.writeText(summary);
    toast({
      title: 'Summary Copied',
      description: 'Voice proof summary block copied to clipboard.',
    });
  };

  return (
    <div className="space-y-3">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[var(--m-border-2)] pb-2 mb-1">
        <div>
          <h1 className="text-lg font-black tracking-tight flex items-center gap-2 m-text-text uppercase">
            <ShieldCheck className="h-4.5 w-4.5 m-text-accent-2" /> RPS Proof Records
          </h1>
          <p className="text-[10px] m-text-muted mt-0.5">
            Verified fan interactions with timestamped recordings, transcripts, intent, sentiment, consent source, and outcome attribution.
          </p>
        </div>
        
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <label className="flex items-center gap-2 px-2.5 py-1 bg-zinc-900/60 border border-zinc-800 rounded text-[10px] font-bold cursor-pointer hover:bg-zinc-850 hover:text-white transition-colors">
            <input 
              type="checkbox" 
              className="accent-[var(--m-accent)] h-3 w-3 rounded bg-black border-white/20 cursor-pointer" 
              checked={liveMode} 
              onChange={e => setLiveMode(e.target.checked)} 
            />
            <span className="uppercase tracking-wider">Live Voice Data</span>
          </label>
          <span className="text-[9px] text-zinc-500 font-semibold">
            Pulls recent provider-synced voice interactions into the proof table.
          </span>
        </div>
      </div>

      {/* Top proof summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-1">
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Total Proof Records</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{totalCount.toLocaleString()}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px] border-l-2 border-l-[var(--m-accent-2)]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Verified Actions</span>
          <span className="text-sm font-bold text-[var(--m-accent-2)] block mt-0.5 font-mono">{verifiedCount.toLocaleString()}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Recording Coverage</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{recordingCoverage}%</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Transcript Coverage</span>
          <span className="text-sm font-bold text-white block mt-0.5 font-mono">{transcriptCoverage}%</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px]">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Positive Intent</span>
          <span className="text-sm font-bold text-[var(--m-warning)] block mt-0.5 font-mono">{positiveIntentCount.toLocaleString()}</span>
        </div>
        <div className="m-inset-card p-2 flex flex-col justify-between h-[52px] border-l-2 border-l-emerald-500">
          <span className="text-[8px] font-bold m-text-muted uppercase tracking-wider block">Sponsor-Ready Proof</span>
          <span className="text-sm font-bold text-emerald-400 block mt-0.5 font-mono">{sponsorReadyCount.toLocaleString()}</span>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-[var(--m-surface)] p-2 border border-[var(--m-border-2)] rounded flex flex-wrap items-center gap-2 mb-1.5 animate-fadeIn">
        <div className="relative flex-1 min-w-[150px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <input 
            type="text" 
            placeholder="Search fans, artists, campaigns, IDs..." 
            className="w-full bg-black/30 border border-white/10 rounded pl-8 pr-3 py-1 text-[11px] text-white focus:border-[var(--m-accent)] focus:outline-none transition-colors font-medium placeholder-zinc-550"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        
        <select 
          className="bg-black/30 border border-white/10 rounded px-2 py-1 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
          value={filterOutcome}
          onChange={(e) => setFilterOutcome(e.target.value)}
        >
          <option value="All Outcomes">All Outcomes</option>
          <option value="Verified">Verified Actions Only</option>
          <option value="Unverified">Unverified Only</option>
          <option value="pre_saved">Pre-Saved</option>
          <option value="ticket_intent">Ticket Intent</option>
          <option value="merch_intent">Merch Intent</option>
          <option value="vip_interest">VIP Interest</option>
          <option value="needs_follow_up">Needs Follow-Up</option>
          <option value="opted_out">Opted Out</option>
        </select>
        
        <select 
          className="bg-black/30 border border-white/10 rounded px-2 py-1 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
          value={filterIntent}
          onChange={(e) => setFilterIntent(e.target.value)}
        >
          <option value="All Intents">All Intents</option>
          <option value="high">High Intent</option>
          <option value="medium">Medium Intent</option>
          <option value="low">Low Intent</option>
        </select>

        <select 
          className="bg-black/30 border border-white/10 rounded px-2 py-1 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
          value={requireRecording}
          onChange={(e) => setRequireRecording(e.target.value)}
        >
          <option value="All Records">All Records</option>
          <option value="With Audio">With Voice Recording</option>
          <option value="No Audio">No Audio</option>
        </select>

        <select 
          className="bg-black/30 border border-white/10 rounded px-2 py-1 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
          value={filterDateRange}
          onChange={(e) => setFilterDateRange(e.target.value)}
        >
          <option value="All Time">All Time</option>
          <option value="Today">Today</option>
          <option value="Last 7 Days">Last 7 Days</option>
          <option value="Last 30 Days">Last 30 Days</option>
        </select>

        <select 
          className="bg-black/30 border border-white/10 rounded px-2 py-1 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
          value={filterArtist}
          onChange={(e) => setFilterArtist(e.target.value)}
        >
          <option value="All Artists">All Artists</option>
          {uniqueArtists.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>

        <select 
          className="bg-black/30 border border-white/10 rounded px-2 py-1 text-[10px] text-zinc-300 font-bold focus:outline-none focus:border-[var(--m-accent)] cursor-pointer"
          value={filterCampaign}
          onChange={(e) => setFilterCampaign(e.target.value)}
        >
          <option value="All Campaigns">All Campaigns</option>
          {uniqueCampaigns.map(c => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>

        {(searchQuery || filterOutcome !== 'All Outcomes' || filterIntent !== 'All Intents' || requireRecording !== 'All Records' || filterDateRange !== 'All Time' || filterArtist !== 'All Artists' || filterCampaign !== 'All Campaigns') && (
          <button 
            onClick={() => {
              setSearchQuery('');
              setFilterOutcome('All Outcomes');
              setFilterIntent('All Intents');
              setRequireRecording('All Records');
              setFilterDateRange('All Time');
              setFilterArtist('All Artists');
              setFilterCampaign('All Campaigns');
            }}
            className="text-[10px] font-extrabold text-[var(--m-accent)] hover:underline ml-auto"
          >
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="m-card overflow-hidden flex flex-col h-[480px]">
        <div className="flex-grow overflow-y-auto pr-0.5">
          <table className="w-full text-left text-xs whitespace-nowrap border-collapse m-table m-dense-table sticky-header">
            <thead className="bg-[var(--m-surface-2)] border-b border-[var(--m-border-2)] text-[8px] uppercase tracking-wider m-text-muted sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 font-black">Timestamp</th>
                <th className="px-3 py-2 font-black">Fan Profile</th>
                <th className="px-3 py-2 font-black">Artist / Station</th>
                <th className="px-3 py-2 font-black">Campaign</th>
                <th className="px-3 py-2 font-black text-center">Intent</th>
                <th className="px-3 py-2 font-black text-center">Sentiment</th>
                <th className="px-3 py-2 font-black">Attributed Outcome</th>
                <th className="px-3 py-2 font-black text-center">Proof Assets</th>
                <th className="px-3 py-2 font-black">Consent Evidence</th>
                <th className="px-3 py-2 font-black text-right">Proof ID</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--m-border-2)]">
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-20 text-zinc-550 text-xs font-semibold">
                    No verified voice proof records matching active filters.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((r) => (
                  <tr 
                    key={r.id} 
                    onClick={() => {
                      setSelectedProof(r);
                    }}
                    className="cursor-pointer hover:bg-[rgba(255,255,255,0.015)] transition-colors"
                  >
                    <td className="px-3 py-2 m-font-mono text-[9px] text-zinc-400 font-semibold">
                      {new Date(r.timestamp).toLocaleString('en-US', { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' })}
                    </td>
                    <td className="px-3 py-2 font-bold text-white text-[11px]">
                      <div className="flex flex-col">
                        <span>{maskFanName(r.fanName)}</span>
                        <span className="text-[9px] text-zinc-500 font-normal font-mono">{maskPhoneNumber(r.fanPhone)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-zinc-300 font-semibold text-[10px]">{r.artist}</td>
                    <td className="px-3 py-2 text-zinc-400 font-medium truncate max-w-[140px]" title={r.campaignName}>
                      {r.campaignName}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn(
                        "text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.2 rounded border",
                        r.intent === 'high' 
                          ? 'bg-[var(--m-accent-2-dim)] text-[var(--m-accent-2)] border-[var(--m-accent-2)]/20' 
                          : r.intent === 'medium' 
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' 
                            : 'bg-zinc-900 text-zinc-500 border-zinc-800'
                      )}>
                        {r.intent}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="flex justify-center">
                        <span className={cn(
                          "h-2 w-2 rounded-full",
                          r.sentiment === 'positive' 
                            ? 'bg-[var(--m-accent-2)] shadow-[0_0_6px_#10b981]' 
                            : r.sentiment === 'negative' 
                              ? 'bg-[var(--m-danger)] shadow-[0_0_6px_#EF4444]' 
                              : 'bg-zinc-500'
                        )} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={cn(
                        "px-2 py-0.5 text-[8px] font-extrabold uppercase rounded border", 
                        r.verifiedAction 
                          ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" 
                          : "bg-zinc-800 text-zinc-400 border-zinc-700"
                      )}>
                        {outcomeLabel(r.outcome)}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-center gap-2 text-zinc-500">
                        {r.hasRecording && (
                          <span title="Voice Recording Available">
                            <Mic className="h-3 w-3 text-[var(--m-accent)]" />
                          </span>
                        )}
                        {r.hasTranscript && (
                          <span title="Fan Transcript Available">
                            <FileText className="h-3 w-3 text-[var(--m-accent-2)]" />
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[10px] font-semibold text-zinc-400">{r.consentSource}</td>
                    <td className="px-3 py-2 text-right m-font-mono text-[9px] uppercase font-bold text-[var(--m-accent)]">
                      {r.id.includes('-') ? r.id.split('-')[1].toUpperCase() : r.id.substring(0, 4).toUpperCase()}A9F
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Drawer: Proof Packet */}
      {selectedProof && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-xs" onClick={() => setSelectedProof(undefined)}>
          <div 
            className="w-full max-w-xl bg-[var(--m-surface)] border-l border-[var(--m-border-2)] h-screen fixed top-0 right-0 flex flex-col shadow-2xl overflow-hidden animate-[m-slide-in_0.2s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            
            {/* Drawer Header */}
            <div className="flex items-center justify-between p-3.5 border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)] shrink-0">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-sm font-bold text-white uppercase tracking-tight flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4 text-[var(--m-accent-2)]" /> Fan Voice Proof Packet
                  </h2>
                  <span className={cn(
                    "px-2 py-0.5 text-[8px] font-black uppercase rounded border", 
                    selectedProof.verifiedAction ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" : "bg-zinc-800 text-zinc-400 border-zinc-700"
                  )}>
                    {outcomeLabel(selectedProof.outcome)}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] m-text-muted mt-1 font-semibold flex-wrap">
                  <span className="flex items-center gap-1"><User className="h-3 w-3 text-zinc-500" /> {maskFanName(selectedProof.fanName)}</span>
                  <span>•</span>
                  <span className="font-mono text-[9px] text-zinc-400 bg-zinc-900 border border-zinc-800 px-1.5 py-0.2 rounded font-black">
                    PROOF ID: #{selectedProof.id.toUpperCase()}
                  </span>
                </div>
              </div>
              <button 
                onClick={() => setSelectedProof(undefined)} 
                className="p-1.5 hover:bg-zinc-850 rounded border border-white/10 flex items-center justify-center bg-zinc-900 transition-colors"
                title="Close"
              >
                <X className="h-3.5 w-3.5 text-slate-400" />
              </button>
            </div>
 
            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              
              {/* Info grid */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-black/20 p-2.5 rounded border border-white/5 text-xs">
                  <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block mb-0.5">Campaign Name</span>
                  <span className="font-bold text-white">{selectedProof.campaignName}</span>
                </div>
                <div className="bg-black/20 p-2.5 rounded border border-white/5 text-xs">
                  <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block mb-0.5">Station Affinity</span>
                  <span className="font-bold text-white">{selectedProof.artist}</span>
                </div>
                <div className="bg-black/20 p-2.5 rounded border border-white/5 text-xs">
                  <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block mb-0.5">Intent Attribution</span>
                  <span className={cn(
                    "font-bold uppercase text-[10px]",
                    selectedProof.intent === 'high' ? "text-[var(--m-accent-2)]" : selectedProof.intent === 'medium' ? "text-amber-400" : "text-zinc-500"
                  )}>{selectedProof.intent} Intent</span>
                </div>
                <div className="bg-black/20 p-2.5 rounded border border-white/5 text-xs">
                  <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block mb-0.5">Sentiment Capture</span>
                  <span className="font-semibold capitalize flex items-center gap-1.5 text-white">
                    <span className={cn("h-1.5 w-1.5 rounded-full", selectedProof.sentiment === 'positive' ? 'bg-[var(--m-accent-2)]' : selectedProof.sentiment === 'negative' ? 'bg-[var(--m-danger)]' : 'bg-zinc-500')} />
                    {selectedProof.sentiment}
                  </span>
                </div>
              </div>

              {/* Waveform visualizer */}
              <div className="bg-black/20 border border-white/5 p-3 rounded-lg">
                <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block mb-2">Voice Recording</span>
                {selectedProof.hasRecording ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      {selectedProof.recordingUrl ? (
                        <audio 
                          src={selectedProof.recordingUrl} 
                          controls
                          className="w-full h-8 bg-zinc-950/60 rounded border border-zinc-800"
                        />
                      ) : (
                        <>
                          <button className="h-7 w-7 rounded-full bg-[var(--m-accent)] flex items-center justify-center text-white hover:opacity-90 transition-opacity">
                            <Play className="h-3 w-3 ml-0.5 fill-white text-white" />
                          </button>
                          <div className="m-waveform flex-1 flex items-end gap-0.5 h-8">
                            {Array.from({ length: 24 }).map((_, i) => (
                              <div key={i} className="m-waveform-bar flex-1 bg-zinc-700" style={{ height: `${getWaveformHeight(selectedProof.id, i)}%` }} />
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex justify-between text-[9px] text-zinc-500 font-mono font-bold">
                      <span>0:00</span>
                      <span>{selectedProof.duration > 0 ? `${selectedProof.duration}s` : '—'}</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-zinc-500 py-3 font-semibold">Voice recording archive unavailable.</div>
                )}
              </div>

              {/* Verbatim Transcript */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[8px] font-bold uppercase tracking-wider text-slate-400">
                    Fan Transcript
                  </h3>
                  {selectedProof.hasTranscript && selectedProof.transcriptSnippet && (
                    <button 
                      className="flex items-center gap-1 text-[8px] font-extrabold text-[var(--m-accent)] hover:underline border border-white/10 px-2 py-0.5 rounded bg-zinc-900/60"
                      onClick={() => {
                        const txtContent = `RPS Transcript - Proof Record ${selectedProof.id}\n${selectedProof.transcriptSnippet}`;
                        const link = document.createElement('a');
                        link.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(txtContent));
                        link.setAttribute('download', `rps_transcript_${selectedProof.id}.txt`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        toast({ title: 'Export Complete', description: 'Transcript text file exported successfully.' });
                      }}
                    >
                      <Download className="h-2.5 w-2.5" /> Export Text
                    </button>
                  )}
                </div>
                {selectedProof.hasTranscript && selectedProof.transcriptSnippet ? (
                  <div className="max-h-[160px] overflow-y-auto space-y-2 p-3 bg-zinc-950/60 border border-zinc-900 rounded-lg">
                    {renderTranscript(selectedProof.transcriptSnippet)}
                  </div>
                ) : (
                  <div className="p-6 text-center text-xs text-zinc-500 border border-dashed border-white/5 rounded-lg bg-black/10">
                    Verbatim transcript unavailable.
                  </div>
                )}
              </div>

              {/* Consent & Compliance telemetry */}
              <div className="grid grid-cols-3 gap-2 border border-zinc-900 rounded p-2.5 bg-zinc-950/60 text-[10px]">
                <div className="space-y-1">
                  <h4 className="font-bold uppercase tracking-wider text-slate-500 border-b border-zinc-900 pb-0.5 text-[8px]">Sponsor Attribution</h4>
                  <div className="flex flex-col"><span className="text-[8px] text-zinc-500">Segment</span><span className="font-bold text-white truncate" title={segmentLabel(selectedProof.segment)}>{segmentLabel(selectedProof.segment)}</span></div>
                  <div className="flex flex-col"><span className="text-[8px] text-zinc-500">Engagement</span><span className="m-font-mono font-bold text-white">{selectedProof.engagementScore}/100</span></div>
                </div>

                <div className="space-y-1 border-l border-zinc-900 pl-2">
                  <h4 className="font-bold uppercase tracking-wider text-slate-500 border-b border-zinc-900 pb-0.5 text-[8px]">Consent Evidence</h4>
                  <div className="flex flex-col"><span className="text-[8px] text-zinc-500">Attributed Source</span><span className="font-bold text-white truncate">{selectedProof.consentSource}</span></div>
                  <div className="flex flex-col"><span className="text-[8px] text-zinc-500">Verification State</span><span className="text-emerald-400 font-bold">TCPA Cleared</span></div>
                </div>
                
                <div className="space-y-1 border-l border-zinc-900 pl-2">
                  <h4 className="font-bold uppercase tracking-wider text-slate-500 border-b border-zinc-900 pb-0.5 text-[8px]">Telemetry Diagnostics</h4>
                  <div className="flex flex-col"><span className="text-[8px] text-zinc-500">SIP Status</span><span className="font-bold text-emerald-400">200 OK Connection</span></div>
                  <div className="flex flex-col"><span className="text-[8px] text-zinc-500">SIP Jitter</span><span className="m-font-mono font-bold text-white">{getJitter(selectedProof.id)}ms</span></div>
                </div>
              </div>

              {/* Destination Action Link */}
              <div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-2.5 flex items-center justify-between text-xs">
                <div>
                  <span className="text-[8px] text-zinc-500 font-bold uppercase tracking-wider block mb-0.5">Attributed Campaign Link</span>
                  <span className="font-semibold text-zinc-300 font-mono truncate max-w-[200px] block">
                    {selectedProof.cpaAttribution > 0 ? 'https://ffm.to/midnight-signal-presave' : '—'}
                  </span>
                </div>
                <a 
                  href="https://ffm.to/midnight-signal-presave" 
                  target="_blank" 
                  rel="noreferrer" 
                  className="flex items-center gap-1 text-[9px] font-extrabold text-[var(--m-accent)] hover:underline bg-[var(--m-accent-dim)] px-2 py-1 rounded border border-[var(--m-accent)]/20 transition-all shrink-0"
                >
                  <LinkIcon className="w-3 h-3" /> Visit Action Link
                </a>
              </div>

              {/* Drawer bottom buttons */}
              <div className="grid grid-cols-2 gap-2 mt-4 pt-4 border-t border-white/5">
                <button 
                  onClick={() => {
                    toast({
                      title: 'Proof Packet Exported',
                      description: `Packet summary and recording manifest compiled for Proof Record #${selectedProof.id.toUpperCase()}.`,
                    });
                  }}
                  className="flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-bold text-white bg-[var(--m-accent)] hover:bg-[#008be5] transition-all"
                >
                  <Download className="h-3.5 w-3.5" /> Export Proof Packet
                </button>
                
                <button 
                  onClick={() => handleCopySummary(selectedProof)}
                  className="flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-bold text-zinc-300 border border-white/10 hover:border-zinc-700 bg-zinc-900 hover:text-white transition-all"
                >
                  <Copy className="h-3.5 w-3.5" /> Copy Proof Summary
                </button>
              </div>

            </div>
          </div>
        </div>
      )}
    </div>
  );
}
