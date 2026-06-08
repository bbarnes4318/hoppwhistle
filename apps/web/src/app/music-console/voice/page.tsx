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
  // SignalWire DIDs
  '+18652679650',
  '+17253022220',
  // BulkVS DIDs
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

const DISPATCH_DELAY_MS = 4000; // 4s between call dispatches

// ─── Helper Components ──────────────────────────────────────────
const MiniWaveChart = ({ color }: { color: 'blue' | 'teal' | 'amber' | 'red' | 'muted' }) => {
  const gradientId = `wave-grad-${color}`;
  const strokeColor = 
    color === 'blue' ? '#00a3ff' : 
    color === 'teal' ? '#10b981' : 
    color === 'amber' ? '#F59E0B' : 
    color === 'red' ? '#EF4444' : '#64748B';

  const stopColor = 
    color === 'blue' ? 'rgba(0, 163, 255, 0.15)' : 
    color === 'teal' ? 'rgba(16, 185, 129, 0.15)' : 
    color === 'amber' ? 'rgba(245, 158, 11, 0.15)' : 
    color === 'red' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(100, 116, 139, 0.15)';
  
  return (
    <svg className="w-full h-8 mt-2 opacity-80" viewBox="0 0 100 30" preserveAspectRatio="none">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={strokeColor} stopOpacity="0.4" />
          <stop offset="100%" stopColor={stopColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path 
        d="M0 25 Q 15 5, 30 18 T 60 10 T 90 20 L 100 15 L 100 30 L 0 30 Z" 
        fill={`url(#${gradientId})`} 
      />
      <path 
        d="M0 25 Q 15 5, 30 18 T 60 10 T 90 20 L 100 15" 
        fill="none" 
        stroke={strokeColor} 
        strokeWidth="1.5" 
        strokeLinecap="round" 
      />
    </svg>
  );
};

// ─── Helpers ─────────────────────────────────────────────────
function getOutcomeBadge(reason?: string) {
  if (!reason) {
    return { label: 'In Progress', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
  }
  switch (reason) {
    case 'customer-ended-call':
      return { label: 'Engaged', cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
    case 'customer-did-not-answer':
      return { label: 'No Answer', cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30' };
    case 'customer-busy':
      return { label: 'Busy', cls: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
    case 'silence-timed-out':
      return { label: 'Silence', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' };
    case 'voicemail':
      return { label: 'Voicemail', cls: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' };
    default:
      if (reason.includes('error')) {
        return { label: 'Error', cls: 'bg-red-500/20 text-red-300 border-red-500/30' };
      }
      return {
        label: reason.replace(/-/g, ' '),
        cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
      };
  }
}

function getCallDuration(call: VoiceInteraction): number {
  if (typeof call.duration === 'number' && call.duration > 0) return Math.round(call.duration);
  if (call.startedAt && call.endedAt) {
    return Math.max(0, Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000));
  }
  return 0;
}

// ─── Main Component ──────────────────────────────────────────
export default function MusicVoicePage() {
  const { toast } = useToast();
  const [engineInfo, setEngineInfo] = useState<RpsVoiceEngineSpec | null>(null);
  const [interactions, setInteractions] = useState<VoiceInteraction[]>([]);
  const [loadingEngine, setLoadingEngine] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDIDs, setSelectedDIDs] = useState<string[]>(AVAILABLE_DIDS);
  const [contacts, setContacts] = useState<string[]>([]);
  
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
      setLoadingEngine(true);
      const res = await fetch(`/vapi-proxy/assistants/${ASSISTANT_ID}`);
      if (!res.ok) throw new Error('Failed to fetch engine details');
      const data = await res.json();
      setEngineInfo(data);
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error Loading Voice Engine',
        description: 'Failed to fetch the designated RPS Voice Engine details.',
        variant: 'destructive',
      });
    } finally {
      setLoadingEngine(false);
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
      title: cancelRef.current ? 'Voice Campaign Stopped' : 'Voice Campaign Complete',
      description: `${dispatched} voice calls dispatched, ${errors} errors`,
    });
    void fetchInteractions();
  }, [selectedDIDs, toast, fetchInteractions]);

  const handleStartCampaign = () => {
    if (contacts.length === 0) {
      toast({ title: 'Error', description: 'Please load contacts first', variant: 'destructive' });
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
    <div className="space-y-6">
      {/* Header Banner */}
      <header className="flex items-end justify-between gap-4 border-b border-[var(--m-border-2)] pb-4">
        <div>
          <h1 className="text-[22px] font-black tracking-tight flex items-center gap-3 m-text-text uppercase">
            <Volume2 className="h-6 w-6 m-text-accent animate-pulse" /> RPS Voice Engine Control Center
          </h1>
          <p className="mt-1.5 text-xs m-text-muted max-w-xl">
            Control fan campaign automation. Target fans with high-fidelity RPS voice engines, broadcast album announcements, and rotate phone numbers.
          </p>
        </div>
      </header>

      {/* Stats Cards Row */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        {/* Total Calls */}
        <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-4 flex flex-col justify-between h-28 transition-all duration-300 hover:-translate-y-0.5 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Fan Interactions</span>
            <Phone className="h-3.5 w-3.5 text-[var(--m-accent)] opacity-70" />
          </div>
          <div>
            <span className="text-xl font-bold m-font-mono text-white block mt-1">{stats.total}</span>
            <MiniWaveChart color="blue" />
          </div>
        </div>

        {/* Answered */}
        <div className="m-inset-card hover:border-[var(--m-accent-2)]/30 p-4 flex flex-col justify-between h-28 transition-all duration-300 hover:-translate-y-0.5 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Engaged</span>
            <PhoneIncoming className="h-3.5 w-3.5 text-[var(--m-accent-2)] opacity-70" />
          </div>
          <div>
            <span className="text-xl font-bold m-font-mono text-white block mt-1">{stats.answered}</span>
            <MiniWaveChart color="teal" />
          </div>
        </div>

        {/* No Answer */}
        <div className="m-inset-card hover:border-slate-500/30 p-4 flex flex-col justify-between h-28 transition-all duration-300 hover:-translate-y-0.5 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">No Answer</span>
            <PhoneOff className="h-3.5 w-3.5 text-slate-400 opacity-70" />
          </div>
          <div>
            <span className="text-xl font-bold m-font-mono text-slate-400 block mt-1">{stats.noAnswer}</span>
            <MiniWaveChart color="muted" />
          </div>
        </div>

        {/* Active Calls */}
        <div className="m-inset-card hover:border-[var(--m-warning)]/30 p-4 flex flex-col justify-between h-28 transition-all duration-300 hover:-translate-y-0.5 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Active</span>
            <Activity className="h-3.5 w-3.5 text-[var(--m-warning)] opacity-70 animate-pulse" />
          </div>
          <div>
            <span className="text-xl font-bold m-font-mono text-[var(--m-warning)] block mt-1">{stats.inProgress}</span>
            <MiniWaveChart color="amber" />
          </div>
        </div>

        {/* Errors */}
        <div className="m-inset-card hover:border-red-500/30 p-4 flex flex-col justify-between h-28 transition-all duration-300 hover:-translate-y-0.5 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Errors</span>
            <AlertTriangle className="h-3.5 w-3.5 text-red-500 opacity-70" />
          </div>
          <div>
            <span className="text-xl font-bold m-font-mono text-red-400 block mt-1">{stats.errors}</span>
            <MiniWaveChart color="red" />
          </div>
        </div>

        {/* Avg Duration */}
        <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-4 flex flex-col justify-between h-28 transition-all duration-300 hover:-translate-y-0.5 relative overflow-hidden group">
          <div className="flex justify-between items-start">
            <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">Avg Duration</span>
            <Clock className="h-3.5 w-3.5 text-[var(--m-accent)] opacity-70" />
          </div>
          <div>
            <span className="text-xl font-bold m-font-mono text-white block mt-1">
              {stats.avgDuration > 0 ? `${Math.round(stats.avgDuration)}s` : '—'}
            </span>
            <MiniWaveChart color="blue" />
          </div>
        </div>
      </div>

      {/* Main Grid Section */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Column (Controls & Table) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Controls Card */}
          <div className="m-card p-5 bg-[var(--m-surface)] relative overflow-hidden">
            <h2 className="text-xs font-bold mb-4 uppercase tracking-wider text-slate-200 flex items-center gap-2 border-b border-[var(--m-border-2)] pb-2">
              Campaign Console
            </h2>

            <div className="grid gap-6 md:grid-cols-2">
              {/* Left Side: Upload & DID Selection */}
              <div className="space-y-4">
                {/* Upload Section */}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Upload Fan Contact List
                  </label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="border border-dashed border-white/10 rounded-lg p-4 text-center cursor-pointer bg-black/30 hover:bg-black/50 hover:border-[var(--m-accent)]/50 transition-all"
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".txt,.csv"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                    {contacts.length > 0 ? (
                      <div className="space-y-1">
                        <Users className="h-5 w-5 mx-auto text-[var(--m-accent-2)]" />
                        <p className="text-xs font-bold text-[var(--m-accent-2)]">
                          {contacts.length} Fans Loaded
                        </p>
                        <p className="text-[9px] text-slate-500 font-medium">Click to replace file</p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Upload className="h-5 w-5 mx-auto text-slate-500" />
                        <p className="text-xs text-slate-400 font-bold">Click to upload CSV / TXT</p>
                        <p className="text-[9px] text-slate-500">Plain text format, 1 number per line</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Progress Indicators */}
                {campaign.running && (
                  <div className="space-y-2 border border-white/5 rounded-lg p-3 bg-black/10">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-400 font-bold">Active Dispatch Stream</span>
                      <div className="flex gap-2">
                        {campaign.paused && (
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                            PAUSED
                          </span>
                        )}
                        <span className="font-mono text-white font-bold">
                          {campaign.dispatched}/{campaign.total}
                        </span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          campaign.paused ? 'bg-amber-500 shadow-[0_0_8px_#F59E0B]' : 'bg-[var(--m-accent-2)] shadow-[0_0_8px_#10b981]'
                        }`}
                        style={{
                          width: `${campaign.total > 0 ? (campaign.dispatched / campaign.total) * 100 : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Dispatch Trigger Bar */}
                <div>
                  {campaign.running ? (
                    <div className="flex gap-2">
                      {campaign.paused ? (
                        <button
                          onClick={handleResumeCampaign}
                          className="flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-bold text-emerald-400 border border-emerald-500/30 bg-emerald-500/5 hover:bg-emerald-500/10 transition-all"
                        >
                          <Play className="h-3.5 w-3.5" /> Resume
                        </button>
                      ) : (
                        <button
                          onClick={handlePauseCampaign}
                          className="flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-bold text-amber-400 border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-all"
                        >
                          <Pause className="h-3.5 w-3.5" /> Pause
                        </button>
                      )}
                      <button
                        onClick={handleStopCampaign}
                        className="flex-1 flex items-center justify-center gap-2 py-2 rounded text-xs font-bold text-red-400 border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 transition-all"
                      >
                        <Square className="h-3.5 w-3.5" /> Stop
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleStartCampaign}
                      disabled={contacts.length === 0 || dispatching}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded text-xs font-bold text-white bg-[var(--m-accent)] hover:bg-[#008be5] disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                    >
                      {dispatching ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Dispatching...
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" /> Start Outbound Campaign
                        </>
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Right Side: DID Selector */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2 flex justify-between">
                  <span>Caller ID Pool Rotation</span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    ({selectedDIDs.length} active)
                  </span>
                </label>
                <div className="border border-white/5 bg-black/20 rounded-lg p-2 max-h-[160px] overflow-y-auto space-y-1">
                  {AVAILABLE_DIDS.map((did, idx) => (
                    <label
                      key={did}
                      className="flex items-center gap-3 text-xs text-slate-300 font-mono py-1 px-2 rounded cursor-pointer hover:bg-white/[0.03] transition-colors"
                    >
                      <input
                        type="checkbox"
                        className="w-3.5 h-3.5 accent-[var(--m-accent)] rounded border-white/20 bg-black"
                        checked={selectedDIDs.includes(did)}
                        onChange={e => {
                          if (e.target.checked) setSelectedDIDs(prev => [...prev, did]);
                          else setSelectedDIDs(prev => prev.filter(d => d !== did));
                        }}
                      />
                      <span>{did}</span>
                      {idx < 2 && (
                        <span className="ml-auto text-[8px] font-bold uppercase text-[var(--m-accent-2)] bg-[var(--m-accent-2-dim)] px-1.5 py-0.2 rounded border border-[var(--m-accent-2)]/20">
                          SW
                        </span>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Calls Table Card */}
          <div className="m-card p-5 bg-[var(--m-surface)] relative overflow-hidden">
            <div className="flex justify-between items-center mb-4 border-b border-[var(--m-border-2)] pb-2">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                Call Telemetry Feed
              </h2>
              <button
                onClick={fetchInteractions}
                disabled={refreshing}
                className="flex items-center gap-1.5 text-[11px] text-slate-400 hover:text-white px-2 py-1 rounded border border-white/5 bg-black/20 disabled:opacity-50 transition-all font-semibold"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh Feed
              </button>
            </div>

            {interactions.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm border border-dashed border-white/5 rounded-lg bg-black/10">
                No outbound calls recorded for this voice campaign.
              </div>
            ) : (
              <div className="overflow-hidden border border-white/5 rounded bg-black/20">
                <table className="w-full text-xs text-left border-collapse m-table m-dense-table">
                  <thead>
                    <tr className="border-b border-white/5 bg-black/40">
                      <th className="font-bold text-slate-400 uppercase">Phone Number</th>
                      <th className="font-bold text-slate-400 uppercase">State</th>
                      <th className="font-bold text-slate-400 uppercase">Outcome</th>
                      <th className="font-bold text-slate-400 uppercase">Recording</th>
                      <th className="font-bold text-slate-400 uppercase text-right">Length</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interactions.slice(0, 10).map(call => {
                      const outcome = getOutcomeBadge(call.endedReason);
                      const duration = getCallDuration(call);
                      return (
                        <tr key={call.id} className="border-b border-white/[0.03] hover:bg-white/[0.01] transition-colors">
                          <td className="font-mono text-white font-semibold">
                            {call.customer?.number || '—'}
                          </td>
                          <td>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${
                              call.status === 'ended' 
                                ? 'bg-slate-500/5 text-slate-400 border-slate-500/10' 
                                : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            }`}>
                              {call.status}
                            </span>
                          </td>
                          <td>
                            <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase border ${outcome.cls}`}>
                              {outcome.label}
                            </span>
                          </td>
                          <td>
                            {call.recordingUrl ? (
                              <div className="flex items-center gap-1.5">
                                <audio 
                                  controls 
                                  src={call.recordingUrl} 
                                  className="h-5 w-32 opacity-70 hover:opacity-100 transition-opacity" 
                                />
                                <a 
                                  href={call.recordingUrl} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="text-slate-500 hover:text-white transition-colors"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              </div>
                            ) : (
                              <span className="text-slate-600 font-mono">—</span>
                            )}
                          </td>
                          <td className="text-right font-mono text-slate-400 font-semibold">
                            {duration > 0 ? `${duration}s` : '—'}
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

        {/* Right Column (Vinyl Disc & Details) */}
        <div className="space-y-6">
          {/* Visualizer Panel */}
          <div className="m-card p-5 bg-[var(--m-surface)] relative overflow-hidden flex flex-col items-center">
            <h2 className="w-full text-xs font-bold uppercase tracking-wider text-slate-200 mb-4 flex justify-between items-center border-b border-[var(--m-border-2)] pb-2">
              <span>Telemetry Status</span>
              {loadingEngine ? (
                <span className="text-[9px] text-slate-500 font-mono">syncing...</span>
              ) : (
                <div className="flex items-center gap-1.5 text-[8px] font-bold uppercase text-[var(--m-accent-2)] bg-[var(--m-accent-2-dim)] px-2 py-0.5 rounded-full border border-[var(--m-accent-2)]/25">
                  <span className="m-pulse-dot" /> Online
                </div>
              )}
            </h2>

            {/* Vinyl record skeuomorphic visualizer */}
            <div className="w-full flex justify-center py-4 border-b border-white/5">
              <div className="m-signal-disc-container">
                {campaign.running && !campaign.paused && (
                  <>
                    <div className="m-signal-disc-ripple-ring" />
                    <div className="m-signal-disc-ripple-ring" />
                    <div className="m-signal-disc-ripple-ring" />
                  </>
                )}
                
                <div className={`m-signal-disc ${campaign.running && !campaign.paused ? 'm-signal-disc-spin' : ''}`}>
                  <div className="m-signal-disc-grooves" />
                  <div className="m-signal-disc-center">
                    <div className="m-signal-disc-spindle" />
                  </div>
                </div>

                <svg 
                  className={`absolute right-6 top-0 w-28 h-40 m-signal-disc-tonearm ${campaign.running ? 'm-signal-disc-tonearm--active' : ''}`}
                  viewBox="0 0 100 150" 
                  fill="none"
                >
                  <circle cx="90" cy="15" r="9" fill="#94a3b8" stroke="#475569" strokeWidth="1.5" />
                  <circle cx="90" cy="15" r="3" fill="#1e293b" />
                  <path 
                    d="M 90 15 C 80 45, 75 75, 55 105 L 53 112" 
                    stroke="#cbd5e1" 
                    strokeWidth="3.5" 
                    strokeLinecap="round" />
                  <rect 
                    x="43" 
                    y="110" 
                    width="14" 
                    height="8" 
                    rx="1.5" 
                    transform="rotate(-15 49 114)" 
                    fill="#475569" 
                    stroke="#1e293b" 
                    strokeWidth="1" 
                  />
                  <rect 
                    x="48" 
                    y="118" 
                    width="4" 
                    height="5" 
                    transform="rotate(-15 49 114)" 
                    fill="#00a3ff" 
                  />
                </svg>
              </div>
            </div>

            {/* Assistant Settings / Spec Details */}
            <div className="w-full mt-4 space-y-2.5 text-xs">
              <div className="flex justify-between items-center border-b border-white/[0.03] pb-1.5">
                <span className="text-slate-400 font-medium">Designated Bot</span>
                <span className="text-white font-bold font-mono text-[10px]">
                  {engineInfo?.name || 'Voice Engine 054'}
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-white/[0.03] pb-1.5">
                <span className="text-slate-400 font-medium">Engine ID</span>
                <span className="text-slate-500 font-mono text-[9px]">
                  {ASSISTANT_ID.slice(0, 16)}...
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-white/[0.03] pb-1.5">
                <span className="text-slate-400 font-medium">Voice Model</span>
                <span className="text-white font-bold font-mono">
                  {engineInfo?.voice?.voiceId || engineInfo?.voice?.provider || 'ElevenLabs (Sarah)'}
                </span>
              </div>
              <div className="flex justify-between items-center border-b border-white/[0.03] pb-1.5">
                <span className="text-slate-400 font-medium">LLM Engine</span>
                <span className="text-white font-bold font-mono">
                  {engineInfo?.model?.model || 'GPT-4o'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-400 font-medium">Forwarding DID</span>
                <span className="text-white font-bold font-mono">
                  {engineInfo?.forwardingPhoneNumber || '—'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
