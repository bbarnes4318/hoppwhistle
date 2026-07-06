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
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { EmptyState } from '@/features/music/components/shared';

// ─── Types ───────────────────────────────────────────────────
interface VoiceAgent {
  id: string;
  vapiAssistantId: string;
  displayName: string;
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

const VOICE_OPTIONS = [
  { id: 'sarah', name: 'Sarah', provider: '11labs', desc: 'Warm, professional female' },
  { id: 'mark', name: 'Mark', provider: '11labs', desc: 'Confident male' },
  { id: 'jessica', name: 'Jessica', provider: '11labs', desc: 'Friendly, approachable female' },
  { id: 'ryan', name: 'Ryan', provider: '11labs', desc: 'Calm, authoritative male' },
  { id: 'andrea', name: 'Andrea', provider: 'deepgram', desc: 'Clear, articulate female' },
];

// ─── Helper Functions ─────────────────────────────────────────
function getOutcomeBadge(reason?: string) {
  if (!reason) {
    return { label: 'Live Connection', cls: 'bg-blue-50 text-blue-700 border-blue-200' };
  }
  switch (reason) {
    case 'customer-ended-call':
      return { label: 'Completed', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
    case 'customer-did-not-answer':
      return { label: 'No Answer', cls: 'bg-[var(--m-surface-3)] text-[var(--m-muted)] border-[var(--m-border-2)]' };
    case 'customer-busy':
      return { label: 'Busy Retry', cls: 'bg-amber-50 text-amber-700 border-amber-200' };
    case 'silence-timed-out':
      return { label: 'Silence Drop', cls: 'bg-orange-50 text-orange-700 border-orange-200' };
    case 'voicemail':
      return { label: 'Voicemail', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' };
    default:
      if (reason.includes('error')) {
        return { label: 'Failed', cls: 'bg-red-50 text-red-700 border-red-200' };
      }
      return {
        label: reason.replace(/-/g, ' '),
        cls: 'bg-[var(--m-surface-3)] text-[var(--m-text-2)] border-[var(--m-border-2)]',
      };
  }
}

function getRpsOutcome(reason?: string) {
  if (!reason) return { label: 'Active Connection', color: 'text-blue-600' };
  switch (reason) {
    case 'customer-ended-call':
      return { label: 'Ad Action / Intent Logged', color: 'text-emerald-600' };
    case 'customer-did-not-answer':
      return { label: 'No Answer / Reschedule', color: 'text-[var(--m-muted)]' };
    case 'customer-busy':
      return { label: 'Line Busy / Retry Later', color: 'text-amber-600' };
    case 'silence-timed-out':
      return { label: 'Silence / Disconnected', color: 'text-orange-600' };
    case 'voicemail':
      return { label: 'Voicemail / Delivered', color: 'text-indigo-600' };
    default:
      if (reason.includes('error')) return { label: 'Failed Connection / Retry', color: 'text-red-600' };
      return { label: 'Stream Ended', color: 'text-[var(--m-text-2)]' };
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
  const [agents, setAgents] = useState<VoiceAgent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<VoiceAgent | null>(null);
  const [interactions, setInteractions] = useState<VoiceInteraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  const [selectedDIDs, setSelectedDIDs] = useState<string[]>(AVAILABLE_DIDS);
  const [contacts, setContacts] = useState<string[]>([]);
  
  // Custom interactive selectors
  const [selectedCampaign, setSelectedCampaign] = useState('demo');
  
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

  // Create Agent Form State
  const [newAgent, setNewAgent] = useState({
    name: '',
    firstMessage: 'Hey, good afternoon! How are you doing today?',
    systemPrompt: '',
    voice: 'sarah',
    forwardingNumber: '+18554800625',
    category: 'custom',
  });

  // Get Auth Headers helper
  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('token') || '';
    return {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }, []);

  // ─── Fetch agents ───
  const fetchAgents = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/v1/music-console/voice-agents', {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch voice agents');
      const data = await res.json();
      const agentsList = Array.isArray(data) ? data : [];
      setAgents(agentsList);

      // Auto-select first matching agent or keep previous
      if (agentsList.length > 0) {
        setSelectedAgent(prev => {
          if (prev && agentsList.some(a => a.id === prev.id)) {
            return agentsList.find(a => a.id === prev.id) || null;
          }
          return agentsList[0];
        });
      } else {
        setSelectedAgent(null);
      }
    } catch (error) {
      console.error(error);
      toast({
        title: 'Error Loading Voice Agents',
        description: 'Failed to fetch the registered Music Console voice agents.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast, getAuthHeaders]);

  // ─── Fetch calls ───
  const fetchInteractions = useCallback(async (agentId: string) => {
    try {
      setRefreshing(true);
      const res = await fetch(`/api/v1/music-console/voice-agents/${agentId}/calls?limit=100`, {
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error('Failed to fetch interactions');
      const data = await res.json();
      setInteractions(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error(error);
    } finally {
      setRefreshing(false);
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (selectedAgent) {
      void fetchInteractions(selectedAgent.id);
    } else {
      setInteractions([]);
    }
  }, [selectedAgent, fetchInteractions]);

  // ─── Auto refresh interactions while campaign running ───
  useEffect(() => {
    if (campaign.running && selectedAgent) {
      const iv = setInterval(() => void fetchInteractions(selectedAgent.id), 10000);
      return () => clearInterval(iv);
    }
  }, [campaign.running, selectedAgent, fetchInteractions]);

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

  // ─── Create voice agent ───
  const handleCreateAgent = async () => {
    if (!newAgent.name || !newAgent.systemPrompt) {
      toast({
        title: 'Error',
        description: 'Name and system prompt are required',
        variant: 'destructive',
      });
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/v1/music-console/voice-agents', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify(newAgent),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to create agent');
      }

      const agent = await res.json();
      toast({ title: 'Agent Created', description: `${agent.displayName || agent.name} is ready` });
      setShowCreateDialog(false);
      setNewAgent({
        name: '',
        firstMessage: 'Hey, good afternoon! How are you doing today?',
        systemPrompt: '',
        voice: 'sarah',
        forwardingNumber: '+18554800625',
        category: 'custom',
      });
      void fetchAgents();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create voice agent',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  // ─── Delete voice agent ───
  const handleDeleteAgent = async (id: string) => {
    if (!confirm('Delete this voice agent? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/v1/music-console/voice-agents/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders(),
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to delete agent');
      }
      toast({ title: 'Agent Deleted' });
      if (selectedAgent?.id === id) {
        setSelectedAgent(null);
      }
      void fetchAgents();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete agent',
        variant: 'destructive',
      });
    }
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
        const res = await fetch(`/api/v1/music-console/voice-agents/${agentId}/calls`, {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            phoneNumberId: didEntry,
            customer: { number: phone },
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          const msg = (err as { error?: string }).error || `HTTP ${res.status}`;
          if (msg.includes('oncurrency') || msg.includes('capacity')) {
            toast({ title: 'System Capacity Limit', description: 'Waiting 30s for voice outbound channels...' });
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
    if (selectedAgent) {
      void fetchInteractions(selectedAgent.id);
    }
  }, [selectedDIDs, toast, fetchInteractions, getAuthHeaders, selectedAgent]);

  const handleStartCampaign = () => {
    if (!selectedAgent) {
      toast({ title: 'Error', description: 'Please select a voice agent first', variant: 'destructive' });
      return;
    }
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
    void dispatchCampaign(contacts, selectedAgent.id);
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

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--m-accent)]" />
        <p className="text-xs text-[var(--m-muted)] font-medium">Syncing Voice AI agents...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Top compact status header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 border-b border-[var(--m-border-2)] pb-2 mb-1">
        <div>
          <h1 className="text-lg font-black tracking-tight flex items-center gap-2 text-[var(--m-text)] uppercase">
            <Volume2 className="h-4.5 w-4.5 text-[var(--m-accent)] animate-pulse" /> Voice AI
          </h1>
          <p className="text-[10px] text-[var(--m-muted)] mt-0.5">
            Launch, monitor, and control fan voice streams across stations.
          </p>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          {agents.length > 0 && (
            <div className="flex items-center gap-2">
              <select
                value={selectedAgent?.id || ''}
                onChange={e => setSelectedAgent(agents.find(a => a.id === e.target.value) || null)}
                className="m-select py-1 text-[10px] bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)] max-w-[200px]"
              >
                {agents.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.displayName || a.name}
                  </option>
                ))}
              </select>

              {selectedAgent && (
                <button
                  onClick={() => handleDeleteAgent(selectedAgent.id)}
                  className="flex items-center gap-1 text-[10px] text-red-500 hover:text-red-600 px-2 py-1 rounded border border-red-200 bg-red-50/50 hover:bg-red-50 transition-all font-semibold"
                  title="Delete selected voice agent"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          )}

          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <button className="flex items-center gap-1 text-[10px] text-white bg-[var(--m-accent)] hover:bg-[#008be5] px-2 py-1 rounded transition-all font-bold">
                <Plus className="h-3 w-3" /> Create Voice AI Agent
              </button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[550px] bg-[var(--m-surface)] border border-[var(--m-border)] text-[var(--m-text)]">
              <DialogHeader>
                <DialogTitle className="text-sm font-bold uppercase tracking-wider text-[var(--m-text)]">Create Voice AI Agent</DialogTitle>
                <DialogDescription className="text-xs text-[var(--m-muted)]">
                  Build a custom AI voice agent for direct fan phone engagement campaigns.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="agent-name" className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">Agent Name</Label>
                    <Input
                      id="agent-name"
                      placeholder="e.g. Tour Promo Campaign"
                      value={newAgent.name}
                      onChange={e => setNewAgent(prev => ({ ...prev, name: e.target.value }))}
                      className="m-input text-[11px] py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[var(--m-text)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="agent-category" className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">Category</Label>
                    <select
                      id="agent-category"
                      value={newAgent.category}
                      onChange={e => setNewAgent(prev => ({ ...prev, category: e.target.value }))}
                      className="m-select w-full text-[11px] py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[var(--m-text)]"
                    >
                      <option value="presave">Album Pre-save</option>
                      <option value="tour">Tour Promotion</option>
                      <option value="merch">Merch Drop</option>
                      <option value="custom">Custom</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="first-message" className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">First Message (greeting)</Label>
                  <Input
                    id="first-message"
                    placeholder="Hey! This is Andrea, calling to see if you pre-saved the new album..."
                    value={newAgent.firstMessage}
                    onChange={e => setNewAgent(prev => ({ ...prev, firstMessage: e.target.value }))}
                    className="m-input text-[11px] py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[var(--m-text)]"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="system-prompt" className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">System Prompt (agent behavior instructions)</Label>
                  <Textarea
                    id="system-prompt"
                    placeholder="You are an enthusiastic artist management representative. Your goal is to guide fans to pre-save the upcoming album and invite them to the VIP list. Keep responses under 2 sentences and sound natural..."
                    rows={4}
                    value={newAgent.systemPrompt}
                    onChange={e => setNewAgent(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    className="m-textarea text-[11px] py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[var(--m-text)]"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="voice-select" className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">Voice</Label>
                    <select
                      id="voice-select"
                      value={newAgent.voice}
                      onChange={e => setNewAgent(prev => ({ ...prev, voice: e.target.value }))}
                      className="m-select w-full text-[11px] py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[var(--m-text)]"
                    >
                      {VOICE_OPTIONS.map(v => (
                        <option key={v.id} value={v.id}>
                          {v.name} ({v.desc})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="transfer-number" className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-muted)]">Live Transfer Number</Label>
                    <Input
                      id="transfer-number"
                      placeholder="+18554800625"
                      value={newAgent.forwardingNumber}
                      onChange={e => setNewAgent(prev => ({ ...prev, forwardingNumber: e.target.value }))}
                      className="m-input text-[11px] py-1 bg-[var(--m-surface-2)] border border-[var(--m-border)] rounded text-[var(--m-text)]"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <button
                  onClick={() => setShowCreateDialog(false)}
                  className="px-3 py-1.5 rounded border border-[var(--m-border)] text-[var(--m-text-2)] bg-[var(--m-surface)] hover:bg-[var(--m-surface-2)] text-[10px] font-bold transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateAgent}
                  disabled={creating}
                  className="px-3 py-1.5 rounded text-white bg-[var(--m-accent)] hover:bg-[#008be5] text-[10px] font-bold flex items-center gap-1 transition-all disabled:opacity-50"
                >
                  {creating && <Loader2 className="h-3 w-3 animate-spin" />}
                  Create Agent
                </button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <button
            onClick={() => {
              if (selectedAgent) void fetchInteractions(selectedAgent.id);
            }}
            disabled={refreshing || !selectedAgent}
            className="flex items-center gap-1 text-[10px] text-[var(--m-text-2)] hover:text-[var(--m-text)] px-2 py-0.5 rounded border border-[var(--m-border)] bg-[var(--m-surface-2)] disabled:opacity-50 transition-all font-semibold"
          >
            <RefreshCw className={`h-2.5 w-2.5 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="py-16">
          <EmptyState
            title="No voice agents configured"
            description="Create your first Voice AI agent for this music campaign."
            icon={Volume2}
            action={
              <button
                onClick={() => setShowCreateDialog(true)}
                className="px-4 py-2 rounded text-white bg-[var(--m-accent)] hover:bg-[#008be5] text-xs font-bold transition-all shadow-sm"
              >
                <Plus className="h-3.5 w-3.5 inline mr-1.5" />
                Create Voice AI Agent
              </button>
            }
          />
        </div>
      ) : (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2 mb-1">
            {/* Total Interactions */}
            <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
              <div>
                <span className="text-[8px] font-bold tracking-wider text-[var(--m-muted)] uppercase block">Total Interactions</span>
                <span className="text-base font-bold m-font-mono text-[var(--m-text)] mt-0.5 block">{stats.total}</span>
              </div>
              <Phone className="h-3.5 w-3.5 text-[var(--m-accent)] opacity-70" />
            </div>

            {/* Human Answers */}
            <div className="m-inset-card hover:border-[var(--m-accent-2)]/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
              <div>
                <span className="text-[8px] font-bold tracking-wider text-[var(--m-muted)] uppercase block">Human Answers</span>
                <span className="text-base font-bold m-font-mono text-[var(--m-text)] mt-0.5 block">{stats.answered}</span>
              </div>
              <PhoneIncoming className="h-3.5 w-3.5 text-[var(--m-accent-2)] opacity-70" />
            </div>

            {/* No Answer */}
            <div className="m-inset-card hover:border-slate-500/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
              <div>
                <span className="text-[8px] font-bold tracking-wider text-[var(--m-muted)] uppercase block">No Answer</span>
                <span className="text-base font-bold m-font-mono text-[var(--m-muted)] mt-0.5 block">{stats.noAnswer + stats.busy}</span>
              </div>
              <PhoneOff className="h-3.5 w-3.5 text-[var(--m-muted)] opacity-70" />
            </div>

            {/* Live Interactions */}
            <div className="m-inset-card hover:border-[var(--m-warning)]/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
              <div>
                <span className="text-[8px] font-bold tracking-wider text-[var(--m-muted)] uppercase block">Live Interactions</span>
                <span className="text-base font-bold m-font-mono text-[#D97706] mt-0.5 block">{stats.inProgress}</span>
              </div>
              <Activity className="h-3.5 w-3.5 text-[#D97706] opacity-70 animate-pulse" />
            </div>

            {/* Failed Dispatches */}
            <div className="m-inset-card hover:border-red-500/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
              <div>
                <span className="text-[8px] font-bold tracking-wider text-[var(--m-muted)] uppercase block">Failed Dispatches</span>
                <span className="text-base font-bold m-font-mono text-red-650 mt-0.5 block">{stats.errors}</span>
              </div>
              <AlertTriangle className="h-3.5 w-3.5 text-red-500 opacity-70" />
            </div>

            {/* Avg Conversation */}
            <div className="m-inset-card hover:border-[var(--m-accent)]/30 p-2.5 flex items-center justify-between h-14 transition-all duration-300 relative overflow-hidden group">
              <div>
                <span className="text-[8px] font-bold tracking-wider text-[var(--m-muted)] uppercase block">Avg Conversation</span>
                <span className="text-base font-bold m-font-mono text-[var(--m-text)] mt-0.5 block">
                  {stats.avgDuration > 0 ? `${Math.round(stats.avgDuration)}s` : '—'}
                </span>
              </div>
              <Clock className="h-3.5 w-3.5 text-[var(--m-accent)] opacity-70" />
            </div>
          </div>

          {/* Main Split Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* Left Panel: Launch Control */}
            <div className="m-card p-3.5 bg-[var(--m-surface)] flex flex-col justify-between h-[360px] shadow-sm">
              <div className="space-y-2.5">
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-text)] flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5">
                  <Activity className="h-3.5 w-3.5 text-[var(--m-accent)]" /> Launch Control
                </h2>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[8px] font-bold uppercase tracking-wider text-[var(--m-muted)] mb-0.5">
                      Station Campaign
                    </label>
                    <select
                      value={selectedCampaign}
                      onChange={e => setSelectedCampaign(e.target.value)}
                      className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-1.5 py-0.5 text-[10px] text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)]"
                    >
                      <option value="demo">Demo Label / RPS Records</option>
                      <option value="tour">Tour Promotion / Presave</option>
                      <option value="release">Album Release campaign</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[8px] font-bold uppercase tracking-wider text-[var(--m-muted)] mb-0.5">
                      Selected Voice Agent
                    </label>
                    <select
                      value={selectedAgent?.id || ''}
                      onChange={e => setSelectedAgent(agents.find(a => a.id === e.target.value) || null)}
                      className="w-full bg-[var(--m-surface-3)] border border-[var(--m-border)] rounded px-1.5 py-0.5 text-[10px] text-[var(--m-text)] focus:outline-none focus:border-[var(--m-accent)]"
                    >
                      {agents.map(a => (
                        <option key={a.id} value={a.id}>
                          {a.displayName || a.name}
                        </option>
                      ))}
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
                    className="border border-dashed border-[var(--m-border)] rounded p-2.5 text-center cursor-pointer bg-[var(--m-surface-2)] hover:bg-[var(--m-surface-3)] hover:border-[var(--m-accent)]/45 transition-all"
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
                        <span className="block text-[10px] text-[var(--m-text)] font-bold">Load Target Fan List</span>
                        <span className="block text-[8px] text-[var(--m-muted)]">Supports TXT/CSV (1 phone # per line)</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Compliance Checklist */}
                <div className="space-y-1 bg-[var(--m-surface-3)] rounded p-2 border border-[var(--m-border)]">
                  <span className="block text-[8px] font-bold uppercase tracking-wider text-[var(--m-text)] mb-1 flex items-center gap-1">
                    <ShieldCheck className="h-3 w-3 text-[var(--m-accent)]" /> Campaign Compliance Checklist
                  </span>
                  
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                    <label className="flex items-center gap-1.5 text-[9px] text-[var(--m-text-2)] cursor-pointer hover:text-[var(--m-text)] transition-colors">
                      <input
                        type="checkbox"
                        className="w-3 h-3 accent-[var(--m-accent)] rounded border-[var(--m-border)] bg-[var(--m-surface)] cursor-pointer"
                        checked={compliance.optIn}
                        onChange={e => setCompliance(prev => ({ ...prev, optIn: e.target.checked }))}
                      />
                      <span>Opt-in Audience</span>
                    </label>
                    
                    <label className="flex items-center gap-1.5 text-[9px] text-[var(--m-text-2)] cursor-pointer hover:text-[var(--m-text)] transition-colors">
                      <input
                        type="checkbox"
                        className="w-3 h-3 accent-[var(--m-accent)] rounded border-[var(--m-border)] bg-[var(--m-surface)] cursor-pointer"
                        checked={compliance.suppression}
                        onChange={e => setCompliance(prev => ({ ...prev, suppression: e.target.checked }))}
                      />
                      <span>DNC Suppressed</span>
                    </label>
                    
                    <label className="flex items-center gap-1.5 text-[9px] text-[var(--m-text-2)] cursor-pointer hover:text-[var(--m-text)] transition-colors">
                      <input
                        type="checkbox"
                        className="w-3 h-3 accent-[var(--m-accent)] rounded border-[var(--m-border)] bg-[var(--m-surface)] cursor-pointer"
                        checked={compliance.disclosure}
                        onChange={e => setCompliance(prev => ({ ...prev, disclosure: e.target.checked }))}
                      />
                      <span>Rec Disclosure</span>
                    </label>
                    
                    <label className="flex items-center gap-1.5 text-[9px] text-[var(--m-text-2)] cursor-pointer hover:text-[var(--m-text)] transition-colors">
                      <input
                        type="checkbox"
                        className="w-3 h-3 accent-[var(--m-accent)] rounded border-[var(--m-border)] bg-[var(--m-surface)] cursor-pointer"
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
                  <div className="space-y-1 bg-[var(--m-surface-2)] rounded p-1.5 border border-[var(--m-border-2)]">
                    <div className="flex justify-between items-center text-[9px]">
                      <span className="text-[var(--m-muted)] font-semibold">Broadcasting Stream</span>
                      <span className="font-mono text-[var(--m-text)] font-bold">
                        {campaign.dispatched}/{campaign.total}
                      </span>
                    </div>
                    <div className="h-1 bg-[var(--m-surface-3)] rounded-full overflow-hidden">
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
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold text-emerald-700 border border-emerald-250 bg-emerald-50 hover:bg-emerald-100 transition-all"
                        >
                          <Play className="h-3 w-3" /> Resume
                        </button>
                      ) : (
                        <button
                          onClick={handlePauseCampaign}
                          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold text-[#D97706] border border-amber-250 bg-amber-50 hover:bg-amber-100 transition-all"
                        >
                          <Pause className="h-3 w-3" /> Pause
                        </button>
                      )}
                      <button
                        onClick={handleStopCampaign}
                        className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-[10px] font-bold text-red-700 border border-red-250 bg-red-50 hover:bg-red-100 transition-all"
                      >
                        <Square className="h-3 w-3" /> Stop
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={handleStartCampaign}
                      disabled={contacts.length === 0 || dispatching || !selectedAgent}
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
            <div className="m-card p-3.5 bg-[var(--m-surface)] flex flex-col justify-between h-[360px] shadow-sm">
              <div className="flex flex-col h-full">
                <div className="flex justify-between items-center mb-1.5 border-b border-[var(--m-border-2)] pb-1.5">
                  <h2 className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-text)] flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-[var(--m-accent-2)]" /> Station Line Pool
                  </h2>
                  <div className="flex gap-2 text-[9px] font-bold">
                    <button 
                      onClick={() => setSelectedDIDs(AVAILABLE_DIDS)}
                      className="text-[var(--m-accent)] hover:underline"
                    >
                      All
                    </button>
                    <span className="text-[var(--m-border)]">|</span>
                    <button 
                      onClick={() => setSelectedDIDs([])}
                      className="text-[var(--m-muted)] hover:text-[var(--m-text)] hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="text-[9px] text-[var(--m-muted)] font-semibold mb-2 flex justify-between bg-[var(--m-surface-3)] border border-[var(--m-border-2)] px-2 py-1 rounded">
                  <span>ACTIVE OUTBOUND LINES</span>
                  <span className="font-mono text-[var(--m-accent)] font-bold">{selectedDIDs.length} / {AVAILABLE_DIDS.length} Selected</span>
                </div>

                {/* Scrollable list */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-1 max-h-[260px]">
                  {AVAILABLE_DIDS.map((did, idx) => {
                    const isSelected = selectedDIDs.includes(did);
                    const category = getDidLabel(idx);
                    const badgeCls = 
                      category === 'Primary' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                      category === 'Backup' ? 'bg-amber-50 text-amber-700 border-amber-250' :
                      'bg-[var(--m-surface-3)] text-[var(--m-muted)] border-[var(--m-border-2)]';

                    return (
                      <label
                        key={did}
                        className={`flex items-center gap-2 text-[10px] font-mono py-1 px-1.5 rounded cursor-pointer hover:bg-[var(--m-surface-3)] transition-colors border ${
                          isSelected ? 'border-[var(--m-border)] bg-[var(--m-surface-2)]' : 'border-transparent'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="w-3 h-3 accent-[var(--m-accent)] rounded border-[var(--m-border)] bg-[var(--m-surface)] cursor-pointer"
                          checked={isSelected}
                          onChange={e => {
                            if (e.target.checked) setSelectedDIDs(prev => [...prev, did]);
                            else setSelectedDIDs(prev => prev.filter(d => d !== did));
                          }}
                        />
                        <span className={isSelected ? 'text-[var(--m-text)] font-semibold' : 'text-[var(--m-muted)]'}>
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
            <div className="m-card p-3.5 bg-[var(--m-surface)] flex flex-col justify-between h-[360px] shadow-sm">
              <div className="flex flex-col h-full">
                <h2 className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-text)] flex items-center gap-1.5 border-b border-[var(--m-border-2)] pb-1.5 mb-2">
                  <Activity className="h-3.5 w-3.5 text-[var(--m-warning)] animate-pulse" /> Live Interaction Feed
                </h2>

                <div className="flex-1 overflow-y-auto pr-1 space-y-1.5 max-h-[290px]">
                  {interactions.length === 0 ? (
                    <div className="flex items-center justify-center h-full text-center text-[var(--m-muted)] text-[10px] font-medium border border-dashed border-[var(--m-border)] rounded bg-[var(--m-surface-3)] py-8">
                      No active streams logged.
                    </div>
                  ) : (
                    interactions.slice(0, 15).map(call => {
                      const outcome = getOutcomeBadge(call.endedReason);
                      const duration = getCallDuration(call);
                      return (
                        <div 
                          key={call.id} 
                          className="flex items-center justify-between gap-1.5 border border-[var(--m-border-2)] bg-[var(--m-surface-2)] rounded p-1.5 hover:bg-[var(--m-surface-3)] hover:border-[var(--m-border)] transition-colors"
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[var(--m-text)] font-bold text-[10px]">
                                {maskPhoneNumber(call.customer?.number)}
                              </span>
                              <span className={`text-[7px] font-extrabold px-1 py-0.2 rounded uppercase border ${
                                call.status === 'ended' 
                                  ? 'bg-[var(--m-surface-3)] text-[var(--m-muted)] border-[var(--m-border-2)]' 
                                  : 'bg-blue-50 text-blue-700 border-blue-200'
                              }`}>
                                {call.status}
                              </span>
                            </div>
                            <div className="text-[8px] text-[var(--m-muted)] font-semibold mt-0.5 font-mono truncate">
                              Line: {call.phoneNumber?.number || 'Rotation'}
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 shrink-0">
                            <span className={`text-[7px] font-extrabold px-1.5 py-0.2 rounded uppercase border ${outcome.cls}`}>
                              {outcome.label}
                            </span>
                            
                            <span className="font-mono text-[9px] text-[var(--m-muted)] font-bold shrink-0">
                              {duration > 0 ? `${duration}s` : '—'}
                            </span>
                            
                            {call.recordingUrl ? (
                              <a
                                href={call.recordingUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-0.5 text-[8px] font-extrabold text-[var(--m-accent)] hover:text-[var(--m-accent-2)] bg-[var(--m-accent-dim)] px-1 py-0.5 rounded border border-[var(--m-accent)]/20 transition-colors"
                              >
                                <Play className="w-2 h-2 fill-current" /> Rec
                              </a>
                            ) : (
                              <span className="text-[8px] text-[var(--m-dim)] font-semibold">No Rec</span>
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
          <div className="m-card p-3 bg-[var(--m-surface)] shadow-sm">
            <div className="flex justify-between items-center mb-1.5 border-b border-[var(--m-border-2)] pb-1">
              <h2 className="text-[10px] font-bold uppercase tracking-wider text-[var(--m-text)]">
                Recent Media Interactions Log
              </h2>
              <span className="text-[9px] text-[var(--m-muted)] font-bold">Showing last 5 dispatches</span>
            </div>

            {interactions.length === 0 ? (
              <div className="text-center py-4 text-[var(--m-muted)] text-[10px] border border-dashed border-[var(--m-border)] rounded bg-[var(--m-surface-3)]">
                No recording sessions registered.
              </div>
            ) : (
              <div className="overflow-hidden border border-[var(--m-border-2)] rounded bg-[var(--m-surface)]">
                <table className="w-full text-[10px] text-left border-collapse m-table m-dense-table">
                  <thead>
                    <tr className="border-b border-[var(--m-border-2)] bg-[var(--m-surface-2)]">
                      <th className="font-bold text-[var(--m-muted)] uppercase py-1 px-2.5">Fan Destination</th>
                      <th className="font-bold text-[var(--m-muted)] uppercase py-1 px-2.5">Station Route Line</th>
                      <th className="font-bold text-[var(--m-muted)] uppercase py-1 px-2.5">Dial State</th>
                      <th className="font-bold text-[var(--m-muted)] uppercase py-1 px-2.5">Operational Outcome</th>
                      <th className="font-bold text-[var(--m-muted)] uppercase py-1 px-2.5 text-right">Length</th>
                      <th className="font-bold text-[var(--m-muted)] uppercase py-1 px-2.5 text-center">Audio Proof</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interactions.slice(0, 5).map(call => {
                      const rpsOutcome = getRpsOutcome(call.endedReason);
                      const duration = getCallDuration(call);
                      return (
                        <tr key={call.id} className="border-b border-[var(--m-border-2)] hover:bg-[var(--m-surface-3)] transition-colors">
                          <td className="font-mono text-[var(--m-text)] font-semibold py-1.5 px-2.5">
                            {maskPhoneNumber(call.customer?.number)}
                          </td>
                          <td className="font-mono text-[var(--m-muted)] py-1.5 px-2.5">
                            {call.phoneNumber?.number || 'Rotation Pool'}
                          </td>
                          <td className="py-1.5 px-2.5">
                            <span className={`px-1.5 py-0.2 rounded text-[7px] font-extrabold uppercase border ${
                              call.status === 'ended' 
                                ? 'bg-[var(--m-surface-3)] text-[var(--m-muted)] border-[var(--m-border-2)]' 
                                : 'bg-blue-50 text-blue-700 border-blue-200'
                            }`}>
                              {call.status}
                            </span>
                          </td>
                          <td className={`font-semibold py-1.5 px-2.5 ${rpsOutcome.color}`}>
                            {rpsOutcome.label}
                          </td>
                          <td className="text-right font-mono text-[var(--m-muted)] font-semibold py-1.5 px-2.5">
                            {duration > 0 ? `${duration}s` : '—'}
                          </td>
                          <td className="py-1.5 px-2.5">
                            <div className="flex justify-center">
                              {call.recordingUrl ? (
                                <a 
                                  href={call.recordingUrl} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="text-[var(--m-muted)] hover:text-[var(--m-accent)] transition-colors"
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </a>
                              ) : (
                                <span className="text-[var(--m-dim)] font-mono">—</span>
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
        </>
      )}
    </div>
  );
}
