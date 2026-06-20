'use client';

import {
  Bot,
  Car,
  Heart,
  Landmark,
  Cross,
  Pause,
  Plus,
  Play,
  Square,
  Upload,
  Volume2,
  Phone,
  Clock,
  PhoneOff,
  PhoneIncoming,
  Users,
  TrendingUp,
  RefreshCw,
  Loader2,
  Trash2,
} from 'lucide-react';
import { useEffect, useState, useCallback, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { CompactPageShell, CompactPageHeader, MetricStrip } from '@/components/layout/compact-layout';

// ─── Types ───────────────────────────────────────────────────
interface VapiAssistant {
  id: string;
  name: string;
  firstMessage?: string;
  voice?: { provider?: string; voiceId?: string };
  model?: { provider?: string; model?: string };
  createdAt: string;
  updatedAt: string;
  forwardingPhoneNumber?: string;
}

interface VapiCall {
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
const CATEGORIES = [
  {
    key: 'roofing',
    label: 'Roofing',
    icon: Landmark,
    color: ' border-amber-500/30',
  },
  {
    key: 'storm-damage',
    label: 'Storm Damage',
    icon: Heart,
    color: ' border-rose-500/30',
  },
  {
    key: 'gutters-siding',
    label: 'Gutters & Siding',
    icon: Car,
    color: ' border-blue-500/30',
  },
  {
    key: 'windows-exterior',
    label: 'Windows & Exterior',
    icon: Cross,
    color: ' border-emerald-500/30',
  },
  {
    key: 'solar',
    label: 'Solar',
    icon: TrendingUp,
    color: ' border-yellow-500/30',
  },
  {
    key: 'custom',
    label: 'Custom',
    icon: Bot,
    color: ' border-violet-500/30',
  },
] as const;

// Map known assistants to categories
const CATEGORY_MAP: Record<string, string> = {
  'FE-outbound': 'roofing',
  'Final Expense': 'roofing',
  Roofing: 'roofing',
  'Storm Damage': 'storm-damage',
  Storm: 'storm-damage',
  Gutters: 'gutters-siding',
  Siding: 'gutters-siding',
  Windows: 'windows-exterior',
  Exterior: 'windows-exterior',
  Solar: 'solar',
};

// Default Vapi Assistant ID for outbound calls
const DEFAULT_ASSISTANT_ID = '1fc88d85-4c44-4399-9345-f601628e64fb';

// Merged DID pool — SignalWire DIDs first, then BulkVS DIDs for rotation
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

const VOICE_OPTIONS = [
  { id: 'sarah', name: 'Sarah', provider: '11labs', desc: 'Warm, professional female' },
  { id: 'mark', name: 'Mark', provider: '11labs', desc: 'Confident male' },
  { id: 'jessica', name: 'Jessica', provider: '11labs', desc: 'Friendly, approachable female' },
  { id: 'ryan', name: 'Ryan', provider: '11labs', desc: 'Calm, authoritative male' },
  { id: 'andrea', name: 'Andrea', provider: 'deepgram', desc: 'Clear, articulate female' },
];

// ─── Helpers ─────────────────────────────────────────────────
function getCategoryForAssistant(name: string): string {
  const lowerName = name.toLowerCase();
  for (const [keyword, category] of Object.entries(CATEGORY_MAP)) {
    if (lowerName.includes(keyword.toLowerCase())) return category;
  }
  return 'custom';
}

function getOutcomeBadge(reason?: string) {
  if (!reason)
    return { label: 'In Progress', cls: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
  switch (reason) {
    case 'customer-ended-call':
      return { label: 'Answered', cls: 'bg-green-500/20 text-green-300 border-green-500/30' };
    case 'customer-did-not-answer':
      return { label: 'No Answer', cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30' };
    case 'customer-busy':
      return { label: 'Busy', cls: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30' };
    case 'silence-timed-out':
      return { label: 'Silence', cls: 'bg-orange-500/20 text-orange-300 border-orange-500/30' };
    case 'voicemail':
      return { label: 'Voicemail', cls: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
    default:
      if (reason.includes('error'))
        return { label: 'Error', cls: 'bg-red-500/20 text-red-300 border-red-500/30' };
      return {
        label: reason.replace(/-/g, ' '),
        cls: 'bg-slate-500/20 text-slate-300 border-slate-500/30',
      };
  }
}

function getCallDuration(call: VapiCall): number {
  if (typeof call.duration === 'number' && call.duration > 0) return Math.round(call.duration);
  if (call.startedAt && call.endedAt) {
    return Math.max(0, Math.round((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000));
  }
  return 0;
}

// ─── Main Component ──────────────────────────────────────────
export default function VoiceAgentsPage() {
  const { toast } = useToast();
  const [assistants, setAssistants] = useState<VapiAssistant[]>([]);
  const [calls, setCalls] = useState<VapiCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('roofing');
  const [selectedAgent, setSelectedAgent] = useState<VapiAssistant | null>(null);
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
  const [contacts, setContacts] = useState<string[]>([]);
  const [selectedDIDs, setSelectedDIDs] = useState<string[]>(AVAILABLE_DIDS);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Create Agent Form State ───
  const [newAgent, setNewAgent] = useState({
    name: '',
    firstMessage: 'Hey, good afternoon! How are you doing today?',
    systemPrompt: '',
    voice: 'sarah',
    forwardingNumber: '+18554800625',
    category: 'custom',
  });

  // ─── Fetch assistants ───
  const fetchAssistants = useCallback(async () => {
    try {
      const res = await fetch('/vapi-proxy/assistants');
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setAssistants(Array.isArray(data) ? data : []);
      // Auto-select first matching agent
      if (!selectedAgent && data.length > 0) {
        const fe = data.find(
          (a: VapiAssistant) => getCategoryForAssistant(a.name) === 'roofing'
        );
        setSelectedAgent(fe || data[0]);
      }
    } catch {
      toast({ title: 'Error', description: 'Failed to load voice agents', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast, selectedAgent]);

  // ─── Fetch calls ───
  const fetchCalls = useCallback(async (assistantId?: string) => {
    try {
      setRefreshing(true);
      let url = '/vapi-proxy/calls?limit=100';
      if (assistantId) url += `&assistantId=${assistantId}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch calls');
      const data = await res.json();
      setCalls(Array.isArray(data) ? data : []);
    } catch {
      // Silently fail on call refresh
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchAssistants();
  }, [fetchAssistants]);

  useEffect(() => {
    if (selectedAgent) void fetchCalls(selectedAgent.id);
  }, [selectedAgent, fetchCalls]);

  // ─── Auto refresh calls while campaign running ───
  useEffect(() => {
    if (campaign.running && selectedAgent) {
      const iv = setInterval(() => void fetchCalls(selectedAgent.id), 10000);
      return () => clearInterval(iv);
    }
  }, [campaign.running, selectedAgent, fetchCalls]);

  // ─── Category filtering ───
  const agentsByCategory = assistants.filter(a => {
    if (activeCategory === 'custom') return getCategoryForAssistant(a.name) === 'custom';
    return getCategoryForAssistant(a.name) === activeCategory;
  });

  // ─── Stats ───
  const recentCalls = calls.filter(c => c.assistantId === selectedAgent?.id);
  const stats = {
    total: recentCalls.length,
    answered: recentCalls.filter(c => c.endedReason === 'customer-ended-call').length,
    noAnswer: recentCalls.filter(c => c.endedReason === 'customer-did-not-answer').length,
    busy: recentCalls.filter(c => c.endedReason === 'customer-busy').length,
    errors: recentCalls.filter(c => c.endedReason?.includes('error')).length,
    inProgress: recentCalls.filter(
      c => c.status === 'in-progress' || c.status === 'ringing' || c.status === 'queued'
    ).length,
    avgDuration:
      recentCalls
        .filter(c => getCallDuration(c) > 0)
        .reduce((sum, c) => sum + getCallDuration(c), 0) /
      Math.max(1, recentCalls.filter(c => getCallDuration(c) > 0).length),
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
          // Strip out anything that isn't a digit or plus sign
          const cleaned = l.replace(/[^+\d]/g, '');
          // Automatically format US numbers to E.164 if they are missing the country code
          if (cleaned.length === 10 && !cleaned.startsWith('+')) return `+1${cleaned}`;
          if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
          if (cleaned.startsWith('+') && cleaned.length >= 11) return cleaned;
          return null;
        })
        .filter((n): n is string => n !== null);

      setContacts(parsedNumbers);
      toast({ title: 'Contacts Loaded', description: `${parsedNumbers.length} valid phone numbers parsed and ready` });
    };
    reader.readAsText(file);
  };

  // ─── Create agent ───
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
      const voiceConfig = VOICE_OPTIONS.find(v => v.id === newAgent.voice);
      const body = {
        name: newAgent.name,
        firstMessage: newAgent.firstMessage,
        model: {
          provider: 'openai',
          model: 'gpt-4o',
          messages: [{ role: 'system', content: newAgent.systemPrompt }],
        },
        voice: {
          provider: voiceConfig?.provider || '11labs',
          voiceId: voiceConfig?.id || 'sarah',
        },
        forwardingPhoneNumber: newAgent.forwardingNumber || undefined,
        maxDurationSeconds: 3600,
        endCallFunctionEnabled: true,
        recordingEnabled: true,
        backgroundSound: 'office',
        backchannelingEnabled: true,
        firstMessageMode: 'assistant-waits-for-user',
      };
      const res = await fetch('/vapi-proxy/assistants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Failed to create agent');
      const agent = await res.json();
      toast({ title: 'Agent Created', description: `${agent.name} is ready to use` });
      setShowCreateDialog(false);
      setNewAgent({
        name: '',
        firstMessage: 'Hey, good afternoon! How are you doing today?',
        systemPrompt: '',
        voice: 'sarah',
        forwardingNumber: '+18554800625',
        category: 'custom',
      });
      void fetchAssistants();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create agent',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  // ─── Delete agent ───
  const handleDeleteAgent = async (id: string) => {
    if (!confirm('Delete this voice agent? This cannot be undone.')) return;
    try {
      const res = await fetch(`/vapi-proxy/assistants/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      toast({ title: 'Agent Deleted' });
      if (selectedAgent?.id === id) setSelectedAgent(null);
      void fetchAssistants();
    } catch {
      toast({ title: 'Error', description: 'Failed to delete agent', variant: 'destructive' });
    }
  };

  // ─── Dispatch engine — fire-and-backoff ───
  const dispatchCalls = useCallback(async (contactList: string[], agentId: string) => {
    setDispatching(true);
    cancelRef.current = false;
    pauseRef.current = false;
    let dispatched = 0;
    let errors = 0;
    const activeDIDs = selectedDIDs.length > 0 ? selectedDIDs : AVAILABLE_DIDS;

    setCampaign({ running: true, paused: false, dispatched: 0, total: contactList.length, errors: 0 });

    for (let i = 0; i < contactList.length; i++) {
      if (cancelRef.current) break;

      // Pause loop — wait until unpaused or cancelled
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
            toast({ title: 'At capacity', description: 'Waiting 30s for slots...' });
            await new Promise(r => setTimeout(r, 30000));
            i--; // Retry this contact
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

      // Stagger dispatches
      if (i < contactList.length - 1 && !cancelRef.current) {
        await new Promise(r => setTimeout(r, DISPATCH_DELAY_MS));
      }
    }

    setCampaign(prev => ({ ...prev, running: false, paused: false }));
    setDispatching(false);
    toast({
      title: cancelRef.current ? 'Campaign Stopped' : 'Campaign Complete',
      description: `${dispatched} dispatched, ${errors} errors`,
    });
    if (selectedAgent) void fetchCalls(selectedAgent.id);
  }, [selectedDIDs, toast, fetchCalls, selectedAgent]);

  const handleStartCampaign = () => {
    if (!selectedAgent) {
      toast({ title: 'Error', description: 'Select a voice agent first', variant: 'destructive' });
      return;
    }
    if (contacts.length === 0) {
      toast({ title: 'Error', description: 'Upload a contacts file first', variant: 'destructive' });
      return;
    }
    void dispatchCalls(contacts, selectedAgent.id || DEFAULT_ASSISTANT_ID);
  };

  const handlePauseCampaign = () => {
    pauseRef.current = true;
    setCampaign(prev => ({ ...prev, paused: true }));
    toast({ title: 'Campaign Paused', description: 'Active calls will finish. Resume to continue.' });
  };

  const handleResumeCampaign = () => {
    pauseRef.current = false;
    setCampaign(prev => ({ ...prev, paused: false }));
    toast({ title: 'Campaign Resumed' });
  };

  const handleStopCampaign = () => {
    cancelRef.current = true;
    pauseRef.current = false;
    setCampaign(prev => ({ ...prev, running: false, paused: false }));
    toast({ title: 'Campaign Stopped', description: 'Active calls will finish naturally.' });
  };

  return (
    <CompactPageShell>
      <CompactPageHeader
        title="Voice Agents"
        subtitle="Manage AI voice agents for outbound calling campaigns"
      >
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-1.5 h-8">
              <Plus className="h-4 w-4" />
              Create Agent
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px] border-border/40">
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Create Voice Agent</DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                Build a custom AI voice agent for outbound calling
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="agent-name" className="text-xs">Agent Name</Label>
                  <Input
                    id="agent-name"
                    placeholder="e.g. Roofing Q1 Outbound"
                    value={newAgent.name}
                    className="h-8 text-xs"
                    onChange={e => setNewAgent(prev => ({ ...prev, name: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="agent-category" className="text-xs">Category</Label>
                  <Select
                    value={newAgent.category}
                    onValueChange={v => setNewAgent(prev => ({ ...prev, category: v }))}
                  >
                    <SelectTrigger id="agent-category" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map(c => (
                        <SelectItem key={c.key} value={c.key} className="text-xs">
                          {c.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="first-message" className="text-xs">First Message (greeting)</Label>
                <Input
                  id="first-message"
                  placeholder="Hey, good afternoon! How's your day going?"
                  value={newAgent.firstMessage}
                  className="h-8 text-xs"
                  onChange={e => setNewAgent(prev => ({ ...prev, firstMessage: e.target.value }))}
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="system-prompt" className="text-xs">System Prompt (agent instructions)</Label>
                <Textarea
                  id="system-prompt"
                  placeholder="You are a contractor rep calling about..."
                  rows={4}
                  value={newAgent.systemPrompt}
                  className="text-xs"
                  onChange={e => setNewAgent(prev => ({ ...prev, systemPrompt: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="voice-select" className="text-xs">Voice</Label>
                  <Select
                    value={newAgent.voice}
                    onValueChange={v => setNewAgent(prev => ({ ...prev, voice: v }))}
                  >
                    <SelectTrigger id="voice-select" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VOICE_OPTIONS.map(v => (
                        <SelectItem key={v.id} value={v.id} className="text-xs">
                          <span className="font-medium">{v.name}</span>
                          <span className="text-[10px] text-muted-foreground ml-2">{v.desc}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="transfer-number" className="text-xs">Transfer Number</Label>
                  <Input
                    id="transfer-number"
                    placeholder="+18554800625"
                    value={newAgent.forwardingNumber}
                    className="h-8 text-xs"
                    onChange={e =>
                      setNewAgent(prev => ({ ...prev, forwardingNumber: e.target.value }))
                    }
                  />
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleCreateAgent} disabled={creating}>
                {creating && <Loader2 className="h-3 w-3 mr-1.5 animate-spin" />}
                Create Agent
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CompactPageHeader>

      {/* ───────── Stats Strip ───────── */}
      <MetricStrip>
        <div className="bg-card border border-border/40 rounded p-2.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded border border-border bg-card flex items-center justify-center text-blue-400 flex-shrink-0">
            <Phone className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider truncate">Total Calls</div>
            <div className="text-base font-bold text-white leading-none mt-0.5">{stats.total}</div>
          </div>
        </div>
        <div className="bg-card border border-border/40 rounded p-2.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded border border-border bg-card flex items-center justify-center text-emerald-400 flex-shrink-0">
            <PhoneIncoming className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider truncate">Answered</div>
            <div className="text-base font-bold text-white leading-none mt-0.5">{stats.answered}</div>
          </div>
        </div>
        <div className="bg-card border border-border/40 rounded p-2.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded border border-border bg-card flex items-center justify-center text-muted-foreground flex-shrink-0">
            <PhoneOff className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider truncate">No Answer</div>
            <div className="text-base font-bold text-white leading-none mt-0.5">{stats.noAnswer}</div>
          </div>
        </div>
        <div className="bg-card border border-border/40 rounded p-2.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded border border-border bg-card flex items-center justify-center text-yellow-400 flex-shrink-0">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider truncate">Active</div>
            <div className="text-base font-bold text-white leading-none mt-0.5">{stats.inProgress}</div>
          </div>
        </div>
        <div className="bg-card border border-border/40 rounded p-2.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded border border-border bg-card flex items-center justify-center text-rose-400 flex-shrink-0">
            <PhoneOff className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider truncate">Errors</div>
            <div className="text-base font-bold text-white leading-none mt-0.5">{stats.errors}</div>
          </div>
        </div>
        <div className="bg-card border border-border/40 rounded p-2.5 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded border border-border bg-card flex items-center justify-center text-purple-400 flex-shrink-0">
            <Clock className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] text-muted-foreground uppercase font-semibold tracking-wider truncate">Avg Duration</div>
            <div className="text-base font-bold text-white leading-none mt-0.5">
              {stats.avgDuration > 0 ? `${Math.round(stats.avgDuration)}s` : '—'}
            </div>
          </div>
        </div>
      </MetricStrip>

      {/* ───────── Main content: Agent Selection + Controls ───────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-3 min-h-0 overflow-hidden">
        {/* Left Column: Agent Selection & Recent Calls */}
        <div className="lg:col-span-3 flex flex-col gap-3 min-h-0 overflow-hidden">
          {/* Select Voice Agent */}
          <Card className="flex flex-col min-h-0 overflow-hidden border-border/40 max-h-[300px]">
            <CardHeader className="flex-shrink-0 p-3 pb-2 border-b border-border/10 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Select Voice Agent</CardTitle>
                <CardDescription className="text-[10px] text-muted-foreground mt-0.5">Choose a pre-built agent or create your own</CardDescription>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-white"
                onClick={() => {
                  setLoading(true);
                  void fetchAssistants();
                }}
                disabled={loading}
              >
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </CardHeader>
            <CardContent className="p-3 flex-1 min-h-0 flex flex-col overflow-hidden">
              <Tabs value={activeCategory} onValueChange={setActiveCategory} className="flex-1 flex flex-col min-h-0 overflow-hidden">
                <TabsList className="w-full justify-start border-b border-border/40 bg-transparent h-9 p-0 mb-3 gap-4 overflow-x-auto flex-nowrap scrollbar-none">
                  {CATEGORIES.map(cat => {
                    const count = assistants.filter(
                      a => getCategoryForAssistant(a.name) === cat.key
                    ).length;
                    return (
                      <TabsTrigger
                        key={cat.key}
                        value={cat.key}
                        className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none border-b-2 border-transparent h-9 px-1 text-xs font-semibold text-muted-foreground flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <cat.icon className="h-3.5 w-3.5" />
                        <span>{cat.label}</span>
                        {count > 0 && (
                          <Badge variant="secondary" className="ml-1 text-[9px] h-3.5 px-1 flex items-center justify-center min-w-[14px]">
                            {count}
                          </Badge>
                        )}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>

                {CATEGORIES.map(cat => (
                  <TabsContent key={cat.key} value={cat.key} className="flex-1 overflow-auto min-h-0 mt-0 data-[state=active]:flex flex-col">
                    {loading ? (
                      <div className="grid gap-2 grid-cols-1 md:grid-cols-2">
                        {[1, 2].map(i => (
                          <Skeleton key={i} className="h-20" />
                        ))}
                      </div>
                    ) : agentsByCategory.length === 0 ? (
                      <div className="flex flex-col items-center justify-center flex-1 text-center py-4">
                        <cat.icon className="h-8 w-8 text-muted-foreground/40 mb-2" />
                        <h3 className="text-xs font-semibold text-muted-foreground">
                          No {cat.label} agents
                        </h3>
                        <p className="text-[10px] text-muted-foreground/60 mb-2">
                          Create one to get started
                        </p>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs px-2.5"
                          onClick={() => {
                            setNewAgent(prev => ({ ...prev, category: cat.key }));
                            setShowCreateDialog(true);
                          }}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Create {cat.label} Agent
                        </Button>
                      </div>
                    ) : (
                      <div className="grid gap-2 grid-cols-1 md:grid-cols-2 overflow-y-auto pr-1 pb-1">
                        {agentsByCategory.map(agent => (
                          <Card
                            key={agent.id}
                            className={cn(
                              "cursor-pointer transition-all hover:border-primary/50 border-border/40",
                              selectedAgent?.id === agent.id
                                ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                                : "hover:bg-accent/30"
                            )}
                            onClick={() => setSelectedAgent(agent)}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-semibold text-xs truncate text-white">{agent.name}</h3>
                                    {selectedAgent?.id === agent.id && (
                                      <Badge className="bg-primary/20 text-primary border-primary/30 text-[9px] h-4 px-1">
                                        Active
                                      </Badge>
                                    )}
                                  </div>
                                  {agent.firstMessage && (
                                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1 italic">
                                      &ldquo;{agent.firstMessage}&rdquo;
                                    </p>
                                  )}
                                  <div className="flex items-center flex-wrap gap-1 mt-2">
                                    {agent.voice?.provider && (
                                      <Badge variant="secondary" className="text-[9px] py-0 px-1 h-3.5 leading-none">
                                        <Volume2 className="h-2 w-2 mr-0.5" />
                                        {agent.voice.voiceId || agent.voice.provider}
                                      </Badge>
                                    )}
                                    {agent.forwardingPhoneNumber && (
                                      <Badge variant="outline" className="text-[9px] py-0 px-1 h-3.5 leading-none border-border/40">
                                        Transfer: {agent.forwardingPhoneNumber}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 text-muted-foreground hover:text-destructive shrink-0"
                                  onClick={e => {
                                    e.stopPropagation();
                                    void handleDeleteAgent(agent.id);
                                  }}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>

          {/* Recent Calls */}
          <Card className="flex-1 flex flex-col min-h-0 overflow-hidden border-border/40">
            <CardHeader className="flex-shrink-0 p-3 pb-2 border-b border-border/10 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Recent Calls</CardTitle>
                <CardDescription className="text-[10px] text-muted-foreground mt-0.5">
                  {selectedAgent
                    ? `Calls for ${selectedAgent.name}`
                    : 'Select an agent to view calls'}
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs px-2.5"
                onClick={() => selectedAgent && void fetchCalls(selectedAgent.id)}
                disabled={refreshing}
              >
                <RefreshCw className={`h-3 w-3 mr-1.5 ${refreshing ? 'animate-spin' : ''}`} />
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0 min-h-0">
              {recentCalls.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs py-8">
                  No calls yet
                </div>
              ) : (
                <Table className="table-dense">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Phone</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Recording</TableHead>
                      <TableHead className="text-right">Duration</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentCalls.slice(0, 50).map(call => {
                      const outcome = getOutcomeBadge(call.endedReason);
                      const duration = getCallDuration(call);
                      return (
                        <TableRow key={call.id}>
                          <TableCell className="font-mono text-xs text-white">
                            {call.customer?.number || '—'}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[10px] py-0 px-1.5 h-4",
                                call.status === 'ended'
                                  ? 'bg-slate-500/10 text-muted-foreground border-slate-500/20'
                                  : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                              )}
                            >
                              {call.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={cn("text-[10px] py-0 px-1.5 h-4", outcome.cls)}>
                              {outcome.label}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {call.recordingUrl ? (
                              <audio controls src={call.recordingUrl} className="h-6 w-32" />
                            ) : (
                              <span className="text-[11px] text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right text-xs text-muted-foreground">
                            {duration > 0 ? `${duration}s` : '—'}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Campaign Controls & Agent Details */}
        <div className="lg:col-span-1 flex flex-col gap-3 min-h-0 overflow-auto pr-1">
          {/* Campaign Controls */}
          <Card className={cn("border-border/40 flex flex-col min-h-0 flex-shrink-0", selectedAgent && "border-primary/30")}>
            <CardHeader className="p-3 pb-2 border-b border-border/10">
              <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Campaign Controls</CardTitle>
              <CardDescription className="text-[10px] text-muted-foreground mt-0.5">
                {selectedAgent ? selectedAgent.name : 'Select an agent to start'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 space-y-3 flex-1 min-h-0">
              {/* Contact Upload */}
              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Contacts
                </Label>
                <div
                  className="border border-dashed border-border/60 rounded p-3 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.csv"
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  {contacts.length > 0 ? (
                    <div className="flex flex-col items-center">
                      <Users className="h-4 w-4 text-primary mb-0.5" />
                      <p className="text-xs font-bold text-primary">
                        {contacts.length} contacts loaded
                      </p>
                      <p className="text-[9px] text-muted-foreground">Click to replace</p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center">
                      <Upload className="h-4 w-4 text-muted-foreground/60 mb-0.5" />
                      <p className="text-xs text-muted-foreground font-medium">Upload contacts (TXT/CSV)</p>
                      <p className="text-[9px] text-muted-foreground/60">One number per line</p>
                    </div>
                  )}
                </div>
              </div>

              <Separator className="bg-border/10" />

              {/* DID Selection */}
              <div className="space-y-1.5">
                <Label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Caller IDs ({selectedDIDs.length}/{AVAILABLE_DIDS.length})
                </Label>
                <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                  {AVAILABLE_DIDS.map((did, idx) => (
                    <label
                      key={did}
                      className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent/30 rounded px-1.5 py-0.5 border border-transparent"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-border h-3 w-3 bg-transparent text-primary focus:ring-0 focus:ring-offset-0"
                        checked={selectedDIDs.includes(did)}
                        onChange={e => {
                          if (e.target.checked) setSelectedDIDs(prev => [...prev, did]);
                          else setSelectedDIDs(prev => prev.filter(d => d !== did));
                        }}
                      />
                      <span className="font-mono text-[11px] text-white">{did}</span>
                      {idx < 2 && (
                        <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5 leading-none ml-auto border-border/40">SW</Badge>
                      )}
                    </label>
                  ))}
                </div>
              </div>

              <Separator className="bg-border/10" />

              {/* Start / Pause / Resume / Stop Controls */}
              {campaign.running ? (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Progress</span>
                    <div className="flex items-center gap-1.5">
                      {campaign.paused && (
                        <Badge variant="outline" className="text-amber-500 border-amber-500/50 text-[9px] h-4 py-0 px-1">PAUSED</Badge>
                      )}
                      <span className="font-mono text-[10px]">
                        {campaign.dispatched}/{campaign.total}
                        {campaign.errors > 0 && (
                          <span className="text-destructive ml-1">({campaign.errors} err)</span>
                        )}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        campaign.paused ? "bg-amber-500" : "bg-primary"
                      )}
                      style={{
                        width: `${campaign.total > 0 ? (campaign.dispatched / campaign.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                  <div className="flex gap-2">
                    {campaign.paused ? (
                      <Button
                        variant="outline"
                        className="flex-1 h-7 text-xs gap-1 border-primary/50 text-primary"
                        onClick={handleResumeCampaign}
                      >
                        <Play className="h-3 w-3" />
                        Resume
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="flex-1 h-7 text-xs gap-1 border-amber-500/50 text-amber-600"
                        onClick={handlePauseCampaign}
                      >
                        <Pause className="h-3 w-3" />
                        Pause
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      className="flex-1 h-7 text-xs gap-1"
                      onClick={handleStopCampaign}
                    >
                      <Square className="h-3 w-3" />
                      Stop
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  className="w-full h-8 text-xs gap-1.5"
                  disabled={!selectedAgent || contacts.length === 0 || dispatching}
                  onClick={handleStartCampaign}
                >
                  {dispatching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  Start Campaign
                  {contacts.length > 0 && (
                    <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1.5">
                      {contacts.length}
                    </Badge>
                  )}
                </Button>
              )}

              {!selectedAgent && (
                <p className="text-[10px] text-muted-foreground text-center">
                  ← Select a voice agent to begin
                </p>
              )}
            </CardContent>
          </Card>

          {/* Selected Agent Details */}
          {selectedAgent && (
            <Card className="border-border/40 flex-shrink-0">
              <CardHeader className="p-3 pb-2 border-b border-border/10">
                <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Agent Details</CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-1.5 text-[11px]">
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-foreground">ID</span>
                  <span className="font-mono text-[10px] text-white">{selectedAgent.id.slice(0, 12)}...</span>
                </div>
                <Separator className="bg-border/10" />
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-foreground">Voice</span>
                  <span className="text-white font-medium">
                    {selectedAgent.voice?.voiceId || selectedAgent.voice?.provider || '—'}
                  </span>
                </div>
                <Separator className="bg-border/10" />
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-foreground">Model</span>
                  <span className="text-white font-medium">{selectedAgent.model?.model || '—'}</span>
                </div>
                <Separator className="bg-border/10" />
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-foreground">Transfer</span>
                  <span className="font-mono text-white">{selectedAgent.forwardingPhoneNumber || '—'}</span>
                </div>
                <Separator className="bg-border/10" />
                <div className="flex justify-between items-center py-0.5">
                  <span className="text-muted-foreground">Updated</span>
                  <span className="text-white font-medium">{new Date(selectedAgent.updatedAt).toLocaleDateString()}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </CompactPageShell>
  );
}
