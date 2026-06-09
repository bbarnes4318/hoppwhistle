'use client';

import {
  Phone,
  PhoneIncoming,
  PhoneOff,
  Clock,
  Play,
  Pause,
  Square,
  Upload,
  Volume2,
  Users,
  RefreshCw,
  Loader2,
  Activity,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';

import { useToast } from '@/components/ui/use-toast';

// ─── Types ───────────────────────────────────────────────────
interface RpsVoiceEngineSpec {
  id: string;
  name: string;
  firstMessage?: string;
  voice?: { provider?: string; voiceId?: string };
  model?: { provider?: string; model?: string };
  createdAt: string;
  updatedAt: string;
  forwardingPhoneNumber?: string;
}

interface VoiceInteraction {
  id: string;
  status: string;
  endedReason?: string;
  duration?: number;
  startedAt?: string;
  endedAt?: string;
  customer?: { number?: string };
  phoneNumber?: { number?: string };
  assistantId?: string;
  recordingUrl?: string;
}

interface CampaignState {
  running: boolean;
  paused: boolean;
  dispatched: number;
  total: number;
  errors: number;
}

// ─── Constants ───────────────────────────────────────────────
const ASSISTANT_ID = '054dbd4d-1336-4aea-bf6e-d75ad6950125';

const AVAILABLE_DIDS = [
  '+18652679650',
  '+17253022220',
  '+12816989460',
  '+12816989461',
  '+14063165877',
  '+14402992856',
  '+14402992860',
  '+16102819660',
  '+16102819662',
  '+17038313168',
  '+17042283589',
  '+17042286088',
  '+18036135410',
  '+18036135412',
  '+19124185540',
  '+19124185542',
  '+19542083921',
  '+19542083922',
];

const DISPATCH_DELAY_MS = 4000; // 4s between dispatches

// ─── Helper Functions ─────────────────────────────────────────
function getOutcomeBadge(reason?: string) {
  if (!reason) {
    return { label: 'Live Connection', cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20' };
  }
  switch (reason) {
    case 'customer-ended-call':
      return { label: 'Completed', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' };
    case 'customer-did-not-answer':
      return { label: 'No Answer', cls: 'bg-zinc-800 text-zinc-400 border-zinc-700' };
    case 'customer-busy':
      return { label: 'Busy Retry', cls: 'bg-amber-500/10 text-amber-400 border-amber-500/20' };
    case 'silence-timed-out':
      return { label: 'Silence Drop', cls: 'bg-orange-500/10 text-orange-400 border-orange-500/20' };
    case 'voicemail':
      return { label: 'Voicemail', cls: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20' };
    default:
      if (reason.includes('error')) {
        return { label: 'Failed', cls: 'bg-red-500/10 text-red-400 border-red-500/20' };
      }
      return {
        label: reason.replace(/-/g, ' '),
        cls: 'bg-zinc-800 text-zinc-300 border-zinc-700',
      };
  }
}

function getRpsOutcome(reason?: string) {
  if (!reason) return { label: 'Active Connection', color: 'text-blue-400' };
  switch (reason) {
    case 'customer-ended-call':
      return { label: 'Ad Action / Intent Logged', color: 'text-emerald-400' };
    case 'customer-did-not-answer':
      return { label: 'No Answer / Reschedule', color: 'text-zinc-400' };
    case 'customer-busy':
      return { label: 'Line Busy / Retry Later', color: 'text-amber-400' };
    case 'silence-timed-out':
      return { label: 'Silence / Disconnected', color: 'text-orange-400' };
    case 'voicemail':
      return { label: 'Voicemail / Delivered', color: 'text-indigo-400' };
    default:
      if (reason.includes('error')) return { label: 'Failed Connection / Retry', color: 'text-red-400' };
      return { label: 'Stream Ended', color: 'text-zinc-300' };
  }
}

function getCallDuration(call: VoiceInteraction): number {
  if (typeof call.duration === 'number' && call.duration > 0) return Math.round(call.duration);
  if (call.startedAt && call.endedAt) {
    return Math.max(0, Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000));
  }
  return 0;
}

function maskPhoneNumber(num?: string) {
  if (!num) return '—';
  const cleaned = num.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+1 ${cleaned.slice(1, 4)}-***-${cleaned.slice(7)}`;
  } else if (cleaned.length === 10) {
    return `+1 ${cleaned.slice(0, 3)}-***-${cleaned.slice(6)}`;
  }
  return num.replace(/(\+\d{4})\d{4}(\d{2})/, '$1-***-$2');
}

function getDidLabel(index: number) {
  if (index < 2) return 'Primary';
  if (index < 5) return 'Backup';
  return 'Rotation';
}

// ─── Main Component ──────────────────────────────────────────
export default function MusicVoicePage() {
  const { toast } = useToast();
  const [engineInfo, setEngineInfo] = useState<RpsVoiceEngineSpec | null>(null);
  const [interactions, setInteractions] = useState<VoiceInteraction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDIDs, setSelectedDIDs] = useState<string[]>(AVAILABLE_DIDS);
  const [contacts, setContacts] = useState<string[]>([]);
  
  // Custom interactive selectors
  const [selectedCampaign, setSelectedCampaign] = useState('demo');
  const [selectedPersona, setSelectedPersona] = useState('sarah');
  
  // Compliance checklists
  const [compliance, setCompliance] = useState({
    optIn: false,
    suppression: false,
    disclosure: false,
    script: false,
  });

  const [campaign, setCampaign] = useState<CampaignState>({
    running: false,
    paused: false,
    dispatched: 0,
    total: 0,
    errors: 0,
  });
  const [dispatching, setDispatching] = useState(false);
  
  const cancelRef = useRef(false);
  const pauseRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Fetch engine details ───
  const fetchEngineDetails = useCallback(async () => {
    try {
      const res = await fetch(`/vapi-proxy/assistants/${ASSISTANT_ID}`);
      if (!res.ok) throw new Error('Failed to fetch engine details');
      const data = await res.json();
      setEngineInfo(data);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error Loading Voice Engine',
        description: 'Failed to fetch the designated RPS Voice Agent details.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  // ─── Fetch calls ───
  const fetchInteractions = useCallback(async () => {
    try {
      setRefreshing(true);
      const res = await fetch(`/vapi-proxy/calls?limit=100&assistantId=${ASSISTANT_ID}`);
      if (!res.ok) throw new Error('Failed to fetch interactions');
      const data = await res.json();
      setInteractions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchEngineDetails();
    void fetchInteractions();
  }, [fetchEngineDetails, fetchInteractions]);

  // ─── Auto refresh interactions while campaign running ───
  useEffect(() => {
    if (campaign.running) {
      const iv = setInterval(() => void fetchInteractions(), 10000);
      return () => clearInterval(iv);
    }
  }, [campaign.running, fetchInteractions]);

  // ─── Stats ───
  const stats = {
    total: interactions.length,
    answered: interactions.filter(c => c.endedReason === 'customer-ended-call').length,
    noAnswer: interactions.filter(c => c.endedReason === 'customer-did-not-answer').length,
    busy: interactions.filter(c => c.endedReason === 'customer-busy').length,
    errors: interactions.filter(c => c.endedReason?.includes('error')).length,
    inProgress: interactions.filter(
      c => c.status === 'in-progress' || c.status === 'ringing' || c.status === 'queued'
    ).length,
    avgDuration:
      interactions
        .filter(c => getCallDuration(c) > 0)
        .reduce((sum, c) => sum + getCallDuration(c), 0) /
        Math.max(1, interactions.filter(c => getCallDuration(c) > 0).length),
  };

  // ─── Handle file upload ───
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      const parsedNumbers = text
        .split('\n')
        .map(l => {
          const cleaned = l.replace(/[^+\d]/g, '');
          if (cleaned.length === 10 && !cleaned.startsWith('+')) return `+1${cleaned}`;
          if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
          if (cleaned.startsWith('+') && cleaned.length >= 11) return cleaned;
          return null;
        })
        .filter((n): n is string => n !== null);
      
      setContacts(parsedNumbers);
      toast({ 
        title: 'Contacts Loaded', 
        description: `${parsedNumbers.length} fan phone numbers parsed and ready` 
      });
    };
    reader.readAsText(file);
  };

  // ─── Dispatch engine — fire-and-backoff ───
  const dispatchCampaign = useCallback(async (contactList: string[], agentId: string) => {
    setDispatching(true);
    cancelRef.current = false;
    pauseRef.current = false;
    let dispatched = 0;
    let errors = 0;
    const activeDIDs = selectedDIDs.length > 0 ? selectedDIDs : AVAILABLE_DIDS;

    setCampaign({ running: true, paused: false, dispatched: 0, total: contactList.length, errors: 0 });

    for (let i = 0; i < contactList.length; i++) {
      if (cancelRef.current) break;

      while (pauseRef.current && !cancelRef.current) {
        await new Promise(r => setTimeout(r, 500));
      }
      if (cancelRef.current) break;

      const phone = contactList[i];
      const didEntry = activeDIDs[i % activeDIDs.length];

      try {
        const res = await fetch('/vapi-proxy/calls', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assistantId: agentId,
            phoneNumberId: didEntry,
            customer: { number: phone },
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const msg = (err as { error?: string }).error || `HTTP ${res.status}`;
          if (msg.includes('oncurrency') || msg.includes('capacity')) {
            toast({ title: 'System Capacity Limit', description: 'Waiting 30s for RPS outbound channels...' });
            await new Promise(r => setTimeout(r, 30000));
            i--; 
            continue;
          }
          errors++;
        } else {
          dispatched++;
        }
      } catch {
        errors++;
      }

      setCampaign(prev => ({ ...prev, dispatched, errors }));

      if (i < contactList.length - 1 && !cancelRef.current) {
        await new Promise(r => setTimeout(r, DISPATCH_DELAY_MS));
      }
    }

    setCampaign(prev => ({ ...prev, running: false, paused: false }));
    setDispatching(false);
    toast({
      title: cancelRef.current ? 'Voice Stream Activation Terminated' : 'Voice Stream Campaign Complete',
      description: `${dispatched} fan interactions active, ${errors} Failed Dispatches`,
    });
    void fetchInteractions();
  }, [selectedDIDs, toast, fetchInteractions]);

  const handleStartCampaign = () => {
    if (contacts.length === 0) {
      toast({ title: 'Error', description: 'Please load contacts first', variant: 'destructive' });
      return;
    }
    if (!compliance.optIn || !compliance.suppression || !compliance.disclosure || !compliance.script) {
      toast({
        title: 'Compliance Required',
        description: 'Please review and verify all items in the Campaign Compliance Checklist before launching.',
        variant: 'destructive',
      });
      return;
    }
    void dispatchCampaign(contacts, ASSISTANT_ID);
  };

  const handlePauseCampaign = () => {
    pauseRef.current = true;
    setCampaign(prev => ({ ...prev, paused: true }));
    toast({ title: 'Campaign Paused', description: 'Outstanding dispatches will freeze. Resume to continue.' });
  };

  const handleResumeCampaign = () => {
    pauseRef.current = false;
    setCampaign(prev => ({ ...prev, paused: false }));
    toast({ title: 'Campaign Resumed', description: 'Re-triggering outbound flow.' });
  };

  const handleStopCampaign = () => {
    cancelRef.current = true;
    pauseRef.current = false;
    setCampaign(prev => ({ ...prev, running: false, paused: false }));
    toast({ title: 'Campaign Halted', description: 'Dispatch engine shut down.' });
  };

  return (
    <div className="space-y-3">
      {/* Top compact status header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[var(--m-border-2)] pb-2 mb-1">
        <div>
          <h1 className="text-lg font-black tracking-tight flex items-center gap-2 m-text-text uppercase">
            <Volume2 className="h-4.5 w-4.5 m-text-accent animate-pulse" /> RPS Voice Engine
          </h1>
          <p className="text-[10px] m-text-muted mt-0.5">
            Launch, monitor, and control fan voice streams across RPS stations.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <div className="flex items-center gap-1 px-2 py-0.5 bg-zinc-900/60 border border-zinc-800 rounded">
            <span className="text-zinc-500 uppercase tracking-wider font-bold">Voice Persona:</span>
            <span className="text-white font-bold font-mono">
              {selectedPersona === 'sarah' ? (engineInfo?.name || 'Sarah (Studio Voice)') : selectedPersona === 'marcus' ? 'Marcus (Studio Voice)' : 'Brian (Studio Voice)'}
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-950/20 border border-emerald-800/30 rounded text-emerald-400 font-semibold">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="uppercase tracking-wider">Provider Sync: Connected</span>
          </div>
          <div className="flex items-center gap-1 px-2 py-0.5 bg-zinc-900/60 border border-zinc-800 rounded">
            <span className="text-zinc-500 uppercase tracking-wider font-bold">Active Station:</span>
            <span className="text-white font-bold">Demo Label / Nona Ray</span>
          </div>
          <button
            onClick={() => { void fetchInteractions(); }}
            disabled={refreshing}
            className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-white px-2 py-0.5 rounded border border-white/5 bg-black/20 disabled:opacity-50 transition-all font-semibold"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-1">
        {/* Total Interactions */}
        <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
          <div>
            <span className="text-[8px] font-bold tracking-wider text-slate-400 uppercase block">Total Interactions</span>
            <span className="text-base font-bold m-font-mono text-white mt-0.5 block">{stats.total}</span>
          </div>
          <Phone className="h-3.5 w-3.5 text-[var(--m-accent)] opacity-70" />
        </div>

        {/* Human Answers */}
        <div className="m-inset-card hover:border-[var(--m-accent-2)]/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
          <div>
            <span className="text-[8px] font-bold tracking-wider text-slate-400 uppercase block">Human Answers</span>
            <span className="text-base font-bold m-font-mono text-white mt-0.5 block">{stats.answered}</span>
          </div>
          <PhoneIncoming className="h-3.5 w-3.5 text-[var(--m-accent-2)] opacity-70" />
        </div>

        {/* No Answer */}
        <div className="m-inset-card hover:border-slate-500/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
          <div>
            <span className="text-[8px] font-bold tracking-wider text-slate-400 uppercase block">No Answer</span>
            <span className="text-base font-bold m-font-mono text-slate-400 mt-0.5 block">{stats.noAnswer + stats.busy}</span>
          </div>
          <PhoneOff className="h-3.5 w-3.5 text-slate-400 opacity-70" />
        </div>

        {/* Live Interactions */}
        <div className="m-inset-card hover:border-[var(--m-warning)]/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
          <div>
            <span className="text-[8px] font-bold tracking-wider text-slate-400 uppercase block">Live Interactions</span>
            <span className="text-base font-bold m-font-mono text-[var(--m-warning)] mt-0.5 block">{stats.inProgress}</span>
          </div>
          <Activity className="h-3.5 w-3.5 text-[var(--m-warning)] opacity-70 animate-pulse" />
        </div>

        {/* Failed Dispatches */}
        <div className="m-inset-card hover:border-red-500/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
          <div>
            <span className="text-[8px] font-bold tracking-wider text-slate-400 uppercase block">Failed Dispatches</span>
            <span className="text-base font-bold m-font-mono text-red-400 mt-0.5 block">{stats.errors}</span>
          </div>
          <AlertTriangle className="h-3.5 w-3.5 text-red-500 opacity-70" />
        </div>

        {/* Avg Conversation */}
        <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
          <div>
            <span className="text-[8px] font-bold tracking-wider text-slate-400 uppercase block">Avg Conversation</span>
            <span className="text-base font-bold m-font-mono text-white mt-0.5 block">
              {stats.avgDuration > 0 ? `${Math.round(stats.avgDuration)}s` : '—'}
            </span>
          </div>
          <Clock className="h-3.5 w-3.5 text-[var(--m-accent)] opacity-70" />
        </div>
      </div>

      {/* Main Split Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Left Panel: Launch Control */}
        <div className="m-card p-3.5 bg-[var(--m-surface-2)] flex flex-col justify-between h-[360px]">
          <div className="space-y-2.5">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5">
              <Activity className="h-3.5 w-3.5 text-[var(--m-accent)]" /> Launch Control
            </h2>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[8px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                  Station Campaign
                </label>
                <select
                  value={selectedCampaign}
                  onChange={e => setSelectedCampaign(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-[var(--m-accent)]"
                >
                  <option value="demo">Demo Label / Nona Ray</option>
                  <option value="pop">Pop Station / Top 40 Hit</option>
                  <option value="rock">Classic Rock / Presave Promo</option>
                </select>
              </div>

              <div>
                <label className="block text-[8px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                  Voice Persona
                </label>
                <select
                  value={selectedPersona}
                  onChange={e => setSelectedPersona(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-[var(--m-accent)]"
                >
                  <option value="sarah">Sarah (Studio Voice) - Standard LLM</option>
                  <option value="marcus">Marcus (Studio Voice) - Advanced LLM</option>
                  <option value="brian">Brian (Studio Voice) - Creative LLM</option>
                </select>
              </div>
            </div>

            {/* CSV Dropzone */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv"
                className="hidden"
                onChange={handleFileUpload}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-dashed border-white/10 rounded p-2.5 text-center cursor-pointer bg-black/20 hover:bg-black/40 hover:border-[var(--m-accent)]/40 transition-all"
              >
                {contacts.length > 0 ? (
                  <div className="flex items-center justify-center gap-2">
                    <Users className="h-4 w-4 text-[var(--m-accent-2)]" />
                    <span className="text-[10px] font-bold text-[var(--m-accent-2)]">
                      {contacts.length} Target Fans Loaded
                    </span>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    <Upload className="h-4 w-4 mx-auto text-slate-500" />
                    <span className="block text-[10px] text-slate-400 font-bold">Load Target Fan List</span>
                    <span className="block text-[8px] text-slate-500">Supports TXT/CSV (1 phone # per line)</span>
                  </div>
                )}
              </div>
            </div>

            {/* Compliance Checklist */}
            <div className="space-y-1 bg-black/10 rounded p-2 border border-white/5">
              <span className="block text-[8px] font-bold uppercase tracking-wider text-slate-400 mb-1 flex items-center gap-1">
                <ShieldCheck className="h-3 w-3 text-[var(--m-accent)]" /> Campaign Compliance Checklist
              </span>
              
              <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                <label className="flex items-center gap-1.5 text-[9px] text-slate-300 cursor-pointer hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    className="w-3 h-3 accent-[var(--m-accent)] rounded border-white/20 bg-black cursor-pointer"
                    checked={compliance.optIn}
                    onChange={e => setCompliance(prev => ({ ...prev, optIn: e.target.checked }))}
                  />
                  <span>Opt-in Audience</span>
                </label>
                
                <label className="flex items-center gap-1.5 text-[9px] text-slate-300 cursor-pointer hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    className="w-3 h-3 accent-[var(--m-accent)] rounded border-white/20 bg-black cursor-pointer"
                    checked={compliance.suppression}
                    onChange={e => setCompliance(prev => ({ ...prev, suppression: e.target.checked }))}
                  />
                  <span>DNC Suppressed</span>
                </label>
                
                <label className="flex items-center gap-1.5 text-[9px] text-slate-300 cursor-pointer hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    className="w-3 h-3 accent-[var(--m-accent)] rounded border-white/20 bg-black cursor-pointer"
                    checked={compliance.disclosure}
                    onChange={e => setCompliance(prev => ({ ...prev, disclosure: e.target.checked }))}
                  />
                  <span>Rec Disclosure</span>
                </label>
                
                <label className="flex items-center gap-1.5 text-[9px] text-slate-300 cursor-pointer hover:text-white transition-colors">
                  <input
                    type="checkbox"
                    className="w-3 h-3 accent-[var(--m-accent)] rounded border-white/20 bg-black cursor-pointer"
                    checked={compliance.script}
                    onChange={e => setCompliance(prev => ({ ...prev, script: e.target.checked }))}
                  />
                  <span>Script Approved</span>
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-2 mt-2">
            {/* Progress Bar */}
            {campaign.running && (
              <div className="space-y-1 bg-black/20 rounded p-1.5 border border-white/5">
                <div className="flex justify-between items-center text-[9px]">
                  <span className="text-slate-400 font-semibold">Broadcasting Stream</span>
                  <span className="font-mono text-white font-bold">
                    {campaign.dispatched}/{campaign.total}
                  </span>
                </div>
                <div className="h-1 bg-black/40 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      campaign.paused ? 'bg-amber-500' : 'bg-[var(--m-accent-2)]'
                    }`}
                    style={{
                      width: `${campaign.total > 0 ? (campaign.dispatched / campaign.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            )}

            {/* Campaign Buttons */}
            <div>
              {campaign.running ? (
                <div className="flex gap-2">
                  {campaign.paused ? (
                    <button
                      onClick={handleResumeCampaign}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold text-emerald-400 border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all"
                    >
                      <Play className="h-3 w-3" /> Resume
                    </button>
                  ) : (
                    <button
                      onClick={handlePauseCampaign}
                      className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold text-amber-400 border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-all"
                    >
                      <Pause className="h-3 w-3" /> Pause
                    </button>
                  )}
                  <button
                    onClick={handleStopCampaign}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold text-red-400 border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 transition-all"
                  >
                    <Square className="h-3 w-3" /> Stop
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleStartCampaign}
                  disabled={contacts.length === 0 || dispatching}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded text-[10px] font-bold text-white bg-[var(--m-accent)] hover:bg-[#008be5] disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  {dispatching ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Deploying Streams...
                    </>
                  ) : (
                    <>
                      <Play className="h-3 w-3" /> Deploy Voice Streams
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Middle Panel: Caller ID / Station Line Pool */}
        <div className="m-card p-3.5 bg-[var(--m-surface-2)] flex flex-col justify-between h-[360px]">
          <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-1.5 border-b border-[var(--m-border-2)] pb-1.5">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-[var(--m-accent-2)]" /> Station Line Pool
              </h2>
              <div className="flex gap-2 text-[9px] font-bold">
                <button 
                  onClick={() => setSelectedDIDs(AVAILABLE_DIDS)}
                  className="text-[var(--m-accent)] hover:underline"
                >
                  All
                </button>
                <span className="text-slate-600">|</span>
                <button 
                  onClick={() => setSelectedDIDs([])}
                  className="text-slate-500 hover:text-white hover:underline"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="text-[9px] text-slate-400 font-semibold mb-2 flex justify-between bg-black/10 px-2 py-1 rounded">
              <span>ACTIVE OUTBOUND LINES</span>
              <span className="font-mono text-[var(--m-accent)] font-bold">{selectedDIDs.length} / {AVAILABLE_DIDS.length} Selected</span>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto pr-1 space-y-1 max-h-[260px]">
              {AVAILABLE_DIDS.map((did, idx) => {
                const isSelected = selectedDIDs.includes(did);
                const category = getDidLabel(idx);
                const badgeCls = 
                  category === 'Primary' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                  category === 'Backup' ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' :
                  'bg-zinc-800 text-zinc-400 border-zinc-700';

                return (
                  <label
                    key={did}
                    className={`flex items-center gap-2 text-[10px] text-slate-300 font-mono py-1 px-1.5 rounded cursor-pointer hover:bg-white/[0.03] transition-colors border ${
                      isSelected ? 'border-white/5 bg-white/[0.01]' : 'border-transparent'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="w-3 h-3 accent-[var(--m-accent)] rounded border-white/20 bg-black cursor-pointer"
                      checked={isSelected}
                      onChange={e => {
                        if (e.target.checked) setSelectedDIDs(prev => [...prev, did]);
                        else setSelectedDIDs(prev => prev.filter(d => d !== did));
                      }}
                    />
                    <span className={isSelected ? 'text-white font-semibold' : 'text-slate-500'}>
                      {did}
                    </span>
                    <span className={`ml-auto text-[7px] font-extrabold uppercase px-1 py-0.2 rounded border ${badgeCls}`}>
                      {category}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Panel: Live Interaction Feed */}
        <div className="m-card p-3.5 bg-[var(--m-surface-2)] flex flex-col justify-between h-[360px]">
          <div className="flex flex-col h-full">
            <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5 mb-2">
              <Activity className="h-3.5 w-3.5 text-[var(--m-warning)] animate-pulse" /> Live Interaction Feed
            </h2>

            <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 max-h-[290px]">
              {interactions.length === 0 ? (
                <div className="flex items-center justify-center h-full text-center text-slate-500 text-[10px] font-medium border border-dashed border-white/5 rounded bg-black/10 py-8">
                  No active streams logged.
                </div>
              ) : (
                interactions.slice(0, 15).map(call => {
                  const outcome = getOutcomeBadge(call.endedReason);
                  const duration = getCallDuration(call);
                  return (
                    <div 
                      key={call.id} 
                      className="flex items-center justify-between gap-1.5 border border-white/5 bg-black/10 rounded p-1.5 hover:bg-black/30 hover:border-white/10 transition-colors"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-white font-bold text-[10px]">
                            {maskPhoneNumber(call.customer?.number)}
                          </span>
                          <span className={`text-[7px] font-extrabold px-1 py-0.2 rounded uppercase border ${
                            call.status === 'ended' 
                              ? 'bg-zinc-800 text-zinc-400 border-zinc-700' 
                              : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          }`}>
                            {call.status}
                          </span>
                        </div>
                        <div className="text-[8px] text-slate-500 font-semibold mt-0.5 font-mono truncate">
                          Line: {call.phoneNumber?.number || 'Rotation'}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2 shrink-0">
                        <span className={`text-[7px] font-extrabold px-1.5 py-0.2 rounded uppercase border ${outcome.cls}`}>
                          {outcome.label}
                        </span>
                        
                        <span className="font-mono text-[9px] text-slate-400 font-bold shrink-0">
                          {duration > 0 ? `${duration}s` : '—'}
                        </span>
                        
                        {call.recordingUrl ? (
                          <a
                            href={call.recordingUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-0.5 text-[8px] font-extrabold text-[var(--m-accent)] hover:text-white bg-[var(--m-accent-dim)] px-1 py-0.5 rounded border border-[var(--m-accent)]/20 transition-colors"
                          >
                            <Play className="w-2 h-2 fill-current" /> Rec
                          </a>
                        ) : (
                          <span className="text-[8px] text-slate-600 font-semibold">No Rec</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Compact Table: Recent Interactions */}
      <div className="m-card p-3 bg-[var(--m-surface-2)]">
        <div className="flex justify-between items-center mb-1.5 border-b border-[var(--m-border-2)] pb-1">
          <h2 className="text-[10px] font-bold uppercase tracking-wider text-slate-200">
            Recent Media Interactions Log
          </h2>
          <span className="text-[9px] text-slate-400 font-bold">Showing last 5 dispatches</span>
        </div>

        {interactions.length === 0 ? (
          <div className="text-center py-4 text-slate-500 text-[10px] border border-dashed border-white/5 rounded bg-black/10">
            No recording sessions registered.
          </div>
        ) : (
          <div className="overflow-hidden border border-white/5 rounded bg-black/20">
            <table className="w-full text-[10px] text-left border-collapse m-table m-dense-table">
              <thead>
                <tr className="border-b border-white/5 bg-black/40">
                  <th className="font-bold text-slate-400 uppercase py-1 px-2.5">Fan Destination</th>
                  <th className="font-bold text-slate-400 uppercase py-1 px-2.5">Station Route Line</th>
                  <th className="font-bold text-slate-400 uppercase py-1 px-2.5">Dial State</th>
                  <th className="font-bold text-slate-400 uppercase py-1 px-2.5">Operational Outcome</th>
                  <th className="font-bold text-slate-400 uppercase py-1 px-2.5 text-right">Length</th>
                  <th className="font-bold text-slate-400 uppercase py-1 px-2.5 text-center">Audio Proof</th>
                </tr>
              </thead>
              <tbody>
                {interactions.slice(0, 5).map(call => {
                  const rpsOutcome = getRpsOutcome(call.endedReason);
                  const duration = getCallDuration(call);
                  return (
                    <tr key={call.id} className="border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors">
                      <td className="font-mono text-white font-semibold py-1.5 px-2.5">
                        {maskPhoneNumber(call.customer?.number)}
                      </td>
                      <td className="font-mono text-slate-400 py-1.5 px-2.5">
                        {call.phoneNumber?.number || 'Rotation Pool'}
                      </td>
                      <td className="py-1.5 px-2.5">
                        <span className={`px-1.5 py-0.2 rounded text-[7px] font-extrabold uppercase border ${
                          call.status === 'ended' 
                            ? 'bg-zinc-800 text-zinc-400 border-zinc-700' 
                            : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        }`}>
                          {call.status}
                        </span>
                      </td>
                      <td className={`font-semibold py-1.5 px-2.5 ${rpsOutcome.color}`}>
                        {rpsOutcome.label}
                      </td>
                      <td className="text-right font-mono text-slate-400 font-semibold py-1.5 px-2.5">
                        {duration > 0 ? `${duration}s` : '—'}
                      </td>
                      <td className="py-1.5 px-2.5">
                        <div className="flex justify-center">
                          {call.recordingUrl ? (
                            <a 
                              href={call.recordingUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="text-slate-500 hover:text-white transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span className="text-slate-600 font-mono">—</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
