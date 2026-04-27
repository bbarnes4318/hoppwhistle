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
 key: 'final-expense',
 label: 'Final Expense',
 icon: Landmark,
 color: ' border-amber-500/30',
 },
 {
 key: 'aca-health',
 label: 'ACA Health',
 icon: Heart,
 color: ' border-rose-500/30',
 },
 {
 key: 'auto-insurance',
 label: 'Auto Insurance',
 icon: Car,
 color: ' border-blue-500/30',
 },
 {
 key: 'medicare',
 label: 'Medicare',
 icon: Cross,
 color: ' border-emerald-500/30',
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
 'FE-outbound': 'final-expense',
 'Final Expense': 'final-expense',
 ACA: 'aca-health',
 Health: 'aca-health',
 Auto: 'auto-insurance',
 Medicare: 'medicare',
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
 const [activeCategory, setActiveCategory] = useState('final-expense');
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
 (a: VapiAssistant) => getCategoryForAssistant(a.name) === 'final-expense'
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
 const lines = text
 .split('\n')
 .map(l => l.trim())
 .filter(l => /^\+?\d{10,}$/.test(l.replace(/[^+\d]/g, '')));
 setContacts(lines);
 toast({ title: 'Contacts Loaded', description: `${lines.length} phone numbers ready` });
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

 // ─── Render ────────────────────────────────────────────────
 return (
 <div className="space-y-6">
 {/* ───────── Header ───────── */}
 <div className="flex items-center justify-between">
 <div>
 <h1 className="text-3xl font-bold tracking-tight">Voice Agents</h1>
 <p className="text-muted-foreground">
 Manage AI voice agents for outbound calling campaigns
 </p>
 </div>
 <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
 <DialogTrigger asChild>
 <Button className="gap-2">
 <Plus className="h-4 w-4" />
 Create Agent
 </Button>
 </DialogTrigger>
 <DialogContent className="sm:max-w-[600px]">
 <DialogHeader>
 <DialogTitle>Create Voice Agent</DialogTitle>
 <DialogDescription>
 Build a custom AI voice agent for outbound calling
 </DialogDescription>
 </DialogHeader>
 <div className="space-y-4 py-4">
 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-2">
 <Label htmlFor="agent-name">Agent Name</Label>
 <Input
 id="agent-name"
 placeholder="e.g. Medicare Q1 Outbound"
 value={newAgent.name}
 onChange={e => setNewAgent(prev => ({ ...prev, name: e.target.value }))}
 />
 </div>
 <div className="space-y-2">
 <Label htmlFor="agent-category">Category</Label>
 <Select
 value={newAgent.category}
 onValueChange={v => setNewAgent(prev => ({ ...prev, category: v }))}
 >
 <SelectTrigger id="agent-category">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {CATEGORIES.map(c => (
 <SelectItem key={c.key} value={c.key}>
 {c.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>

 <div className="space-y-2">
 <Label htmlFor="first-message">First Message (greeting)</Label>
 <Input
 id="first-message"
 placeholder="Hey, good afternoon! How's your day going?"
 value={newAgent.firstMessage}
 onChange={e => setNewAgent(prev => ({ ...prev, firstMessage: e.target.value }))}
 />
 </div>

 <div className="space-y-2">
 <Label htmlFor="system-prompt">System Prompt (agent instructions)</Label>
 <Textarea
 id="system-prompt"
 placeholder="You are an insurance agent calling about..."
 rows={6}
 value={newAgent.systemPrompt}
 onChange={e => setNewAgent(prev => ({ ...prev, systemPrompt: e.target.value }))}
 />
 </div>

 <div className="grid grid-cols-2 gap-4">
 <div className="space-y-2">
 <Label htmlFor="voice-select">Voice</Label>
 <Select
 value={newAgent.voice}
 onValueChange={v => setNewAgent(prev => ({ ...prev, voice: v }))}
 >
 <SelectTrigger id="voice-select">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {VOICE_OPTIONS.map(v => (
 <SelectItem key={v.id} value={v.id}>
 <span className="font-medium">{v.name}</span>
 <span className="text-xs text-muted-foreground ml-2">{v.desc}</span>
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-2">
 <Label htmlFor="transfer-number">Transfer Number</Label>
 <Input
 id="transfer-number"
 placeholder="+18554800625"
 value={newAgent.forwardingNumber}
 onChange={e =>
 setNewAgent(prev => ({ ...prev, forwardingNumber: e.target.value }))
 }
 />
 </div>
 </div>
 </div>
 <DialogFooter>
 <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
 Cancel
 </Button>
 <Button onClick={handleCreateAgent} disabled={creating}>
 {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
 Create Agent
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>

 {/* ───────── Stats Cards ───────── */}
 <div className="grid gap-4 md:grid-cols-6">
 <Card className="bg-primary border-blue-500/20">
 <CardHeader className="pb-2">
 <CardDescription className="flex items-center gap-1.5">
 <Phone className="h-3.5 w-3.5" />
 Total Calls
 </CardDescription>
 <CardTitle className="text-2xl text-blue-400">{stats.total}</CardTitle>
 </CardHeader>
 </Card>
 <Card className="bg-primary border-green-500/20">
 <CardHeader className="pb-2">
 <CardDescription className="flex items-center gap-1.5">
 <PhoneIncoming className="h-3.5 w-3.5" />
 Answered
 </CardDescription>
 <CardTitle className="text-2xl text-green-400">{stats.answered}</CardTitle>
 </CardHeader>
 </Card>
 <Card className="bg-muted border-slate-500/20">
 <CardHeader className="pb-2">
 <CardDescription className="flex items-center gap-1.5">
 <PhoneOff className="h-3.5 w-3.5" />
 No Answer
 </CardDescription>
 <CardTitle className="text-2xl text-muted-foreground">{stats.noAnswer}</CardTitle>
 </CardHeader>
 </Card>
 <Card className="bg-amber-500 border-yellow-500/20">
 <CardHeader className="pb-2">
 <CardDescription className="flex items-center gap-1.5">
 <TrendingUp className="h-3.5 w-3.5" />
 Active
 </CardDescription>
 <CardTitle className="text-2xl text-yellow-400">{stats.inProgress}</CardTitle>
 </CardHeader>
 </Card>
 <Card className="bg-destructive border-red-500/20">
 <CardHeader className="pb-2">
 <CardDescription className="flex items-center gap-1.5">
 <PhoneOff className="h-3.5 w-3.5" />
 Errors
 </CardDescription>
 <CardTitle className="text-2xl text-red-400">{stats.errors}</CardTitle>
 </CardHeader>
 </Card>
 <Card className="bg-accent border-purple-500/20">
 <CardHeader className="pb-2">
 <CardDescription className="flex items-center gap-1.5">
 <Clock className="h-3.5 w-3.5" />
 Avg Duration
 </CardDescription>
 <CardTitle className="text-2xl text-purple-400">
 {stats.avgDuration > 0 ? `${Math.round(stats.avgDuration)}s` : '—'}
 </CardTitle>
 </CardHeader>
 </Card>
 </div>

 {/* ───────── Main content: Agent Selection + Controls ───────── */}
 <div className="grid gap-6 lg:grid-cols-3">
 {/* ───── Left: Agent Selection ───── */}
 <div className="lg:col-span-2 space-y-4">
 <Card>
 <CardHeader>
 <div className="flex items-center justify-between">
 <div>
 <CardTitle>Select Voice Agent</CardTitle>
 <CardDescription>Choose a pre-built agent or create your own</CardDescription>
 </div>
 <Button
 variant="ghost"
 size="icon"
 onClick={() => {
 setLoading(true);
 void fetchAssistants();
 }}
 disabled={loading}
 >
 <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
 </Button>
 </div>
 </CardHeader>
 <CardContent>
 {/* Category Tabs */}
 <Tabs value={activeCategory} onValueChange={setActiveCategory}>
 <TabsList className="w-full grid grid-cols-5 mb-4">
 {CATEGORIES.map(cat => {
 const count = assistants.filter(
 a => getCategoryForAssistant(a.name) === cat.key
 ).length;
 return (
 <TabsTrigger key={cat.key} value={cat.key} className="gap-1.5 text-xs">
 <cat.icon className="h-3.5 w-3.5" />
 {cat.label}
 {count > 0 && (
 <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1">
 {count}
 </Badge>
 )}
 </TabsTrigger>
 );
 })}
 </TabsList>

 {CATEGORIES.map(cat => (
 <TabsContent key={cat.key} value={cat.key}>
 {loading ? (
 <div className="grid gap-3 md:grid-cols-2">
 {[1, 2].map(i => (
 <Skeleton key={i} className="h-32" />
 ))}
 </div>
 ) : agentsByCategory.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-12 text-center">
 <cat.icon className="h-10 w-10 text-muted-foreground/40 mb-3" />
 <h3 className="text-sm font-semibold text-muted-foreground">
 No {cat.label} agents
 </h3>
 <p className="text-xs text-muted-foreground/60 mb-3">
 Create one to get started
 </p>
 <Button
 size="sm"
 variant="outline"
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
 <div className="grid gap-3 md:grid-cols-2">
 {agentsByCategory.map(agent => (
 <Card
 key={agent.id}
 className={`cursor-pointer transition-all hover:border-primary/50 ${
 selectedAgent?.id === agent.id
 ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
 : 'hover:bg-accent/30'
 }`}
 onClick={() => setSelectedAgent(agent)}
 >
 <CardContent className="p-4">
 <div className="flex items-start justify-between">
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2">
 <h3 className="font-semibold text-sm truncate">{agent.name}</h3>
 {selectedAgent?.id === agent.id && (
 <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px]">
 Active
 </Badge>
 )}
 </div>
 {agent.firstMessage && (
 <p className="text-xs text-muted-foreground mt-1 line-clamp-2 italic">
 &ldquo;{agent.firstMessage}&rdquo;
 </p>
 )}
 <div className="flex items-center gap-2 mt-2">
 {agent.voice?.provider && (
 <Badge variant="secondary" className="text-[10px]">
 <Volume2 className="h-2.5 w-2.5 mr-0.5" />
 {agent.voice.voiceId || agent.voice.provider}
 </Badge>
 )}
 {agent.forwardingPhoneNumber && (
 <Badge variant="outline" className="text-[10px]">
 Transfer: {agent.forwardingPhoneNumber}
 </Badge>
 )}
 </div>
 </div>
 <Button
 variant="ghost"
 size="icon"
 className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
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

 {/* ───── Recent Calls Table ───── */}
 <Card>
 <CardHeader>
 <div className="flex items-center justify-between">
 <div>
 <CardTitle className="text-base">Recent Calls</CardTitle>
 <CardDescription>
 {selectedAgent
 ? `Calls for ${selectedAgent.name}`
 : 'Select an agent to view calls'}
 </CardDescription>
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => selectedAgent && void fetchCalls(selectedAgent.id)}
 disabled={refreshing}
 >
 <RefreshCw className={`h-3.5 w-3.5 mr-1 ${refreshing ? 'animate-spin' : ''}`} />
 Refresh
 </Button>
 </div>
 </CardHeader>
 <CardContent>
 {recentCalls.length === 0 ? (
 <p className="text-sm text-muted-foreground text-center py-8">No calls yet</p>
 ) : (
 <div className="max-h-[300px] overflow-y-auto">
 <table className="w-full text-sm">
 <thead className="sticky top-0 bg-card">
 <tr className="border-b text-muted-foreground text-xs">
 <th className="text-left py-2 font-medium">Phone</th>
 <th className="text-left py-2 font-medium">Status</th>
 <th className="text-left py-2 font-medium">Outcome</th>
 <th className="text-left py-2 font-medium">Recording</th>
 <th className="text-right py-2 font-medium">Duration</th>
 </tr>
 </thead>
 <tbody>
 {recentCalls.slice(0, 25).map(call => {
 const outcome = getOutcomeBadge(call.endedReason);
 const duration = getCallDuration(call);
 return (
 <tr key={call.id} className="border-b border-border/50 hover:bg-muted/30">
 <td className="py-2 font-mono text-xs">
 {call.customer?.number || '—'}
 </td>
 <td className="py-2">
 <Badge
 variant="outline"
 className={
 call.status === 'ended'
 ? 'bg-slate-500/10 text-muted-foreground'
 : 'bg-blue-500/10 text-blue-400'
 }
 >
 {call.status}
 </Badge>
 </td>
 <td className="py-2">
 <Badge variant="outline" className={outcome.cls}>
 {outcome.label}
 </Badge>
 </td>
 <td className="py-2">
 {call.recordingUrl ? (
 <audio controls src={call.recordingUrl} className="h-8 w-40" />
 ) : (
 <span className="text-xs text-muted-foreground">—</span>
 )}
 </td>
 <td className="py-2 text-right text-xs text-muted-foreground">
 {duration > 0 ? `${duration}s` : '—'}
 </td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}
 </CardContent>
 </Card>
 </div>

 {/* ───── Right: Campaign Controls ───── */}
 <div className="space-y-4">
 {/* Selected Agent Info */}
 <Card className={selectedAgent ? 'border-primary/30' : ''}>
 <CardHeader className="pb-3">
 <CardTitle className="text-base">Campaign Controls</CardTitle>
 <CardDescription>
 {selectedAgent ? selectedAgent.name : 'Select an agent to start'}
 </CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 {/* Contact Upload */}
 <div className="space-y-2">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
 Contacts
 </Label>
 <div
 className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
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
 <>
 <Users className="h-5 w-5 mx-auto text-primary mb-1" />
 <p className="text-sm font-semibold text-primary">
 {contacts.length} contacts loaded
 </p>
 <p className="text-[10px] text-muted-foreground">Click to replace</p>
 </>
 ) : (
 <>
 <Upload className="h-5 w-5 mx-auto text-muted-foreground/50 mb-1" />
 <p className="text-xs text-muted-foreground">Upload contacts (TXT/CSV)</p>
 <p className="text-[10px] text-muted-foreground/60">One number per line</p>
 </>
 )}
 </div>
 </div>

 <Separator />

 {/* DID Selection */}
 <div className="space-y-2">
 <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
 Caller IDs ({selectedDIDs.length}/{AVAILABLE_DIDS.length})
 </Label>
 <div className="space-y-1 max-h-48 overflow-y-auto pr-1">
 {AVAILABLE_DIDS.map((did, idx) => (
 <label
 key={did}
 className="flex items-center gap-2 text-xs cursor-pointer hover:bg-accent/30 rounded px-2 py-1"
 >
 <input
 type="checkbox"
 className="rounded border-border"
 checked={selectedDIDs.includes(did)}
 onChange={e => {
 if (e.target.checked) setSelectedDIDs(prev => [...prev, did]);
 else setSelectedDIDs(prev => prev.filter(d => d !== did));
 }}
 />
 <span className="font-mono">{did}</span>
 {idx < 2 && (
 <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto">SW</Badge>
 )}
 </label>
 ))}
 </div>
 </div>

 <Separator />

 {/* Start / Pause / Resume / Stop Controls */}
 {campaign.running ? (
 <div className="space-y-3">
 <div className="flex items-center justify-between text-sm">
 <span className="text-muted-foreground">Progress</span>
 <div className="flex items-center gap-2">
 {campaign.paused && (
 <Badge variant="outline" className="text-amber-500 border-amber-500/50 text-[10px]">PAUSED</Badge>
 )}
 <span className="font-mono text-xs">
 {campaign.dispatched}/{campaign.total}
 {campaign.errors > 0 && (
 <span className="text-destructive ml-1">({campaign.errors} err)</span>
 )}
 </span>
 </div>
 </div>
 <div className="h-2 bg-muted rounded-full overflow-hidden">
 <div
 className={`h-full rounded-full transition-all ${campaign.paused ? 'bg-amber-500' : 'bg-primary'}`}
 style={{
 width: `${campaign.total > 0 ? (campaign.dispatched / campaign.total) * 100 : 0}%`,
 }}
 />
 </div>
 <div className="flex gap-2">
 {campaign.paused ? (
 <Button
 variant="outline"
 className="flex-1 gap-2 border-primary/50 text-primary"
 onClick={handleResumeCampaign}
 >
 <Play className="h-4 w-4" />
 Resume
 </Button>
 ) : (
 <Button
 variant="outline"
 className="flex-1 gap-2 border-amber-500/50 text-amber-600"
 onClick={handlePauseCampaign}
 >
 <Pause className="h-4 w-4" />
 Pause
 </Button>
 )}
 <Button
 variant="destructive"
 className="flex-1 gap-2"
 onClick={handleStopCampaign}
 >
 <Square className="h-4 w-4" />
 Stop
 </Button>
 </div>
 </div>
 ) : (
 <Button
 className="w-full gap-2"
 disabled={!selectedAgent || contacts.length === 0 || dispatching}
 onClick={handleStartCampaign}
 >
 {dispatching ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Play className="h-4 w-4" />
 )}
 Start Campaign
 {contacts.length > 0 && (
 <Badge variant="secondary" className="ml-1">
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
 <Card>
 <CardHeader className="pb-3">
 <CardTitle className="text-base">Agent Details</CardTitle>
 </CardHeader>
 <CardContent className="space-y-2 text-xs">
 <div className="flex justify-between">
 <span className="text-muted-foreground">ID</span>
 <span className="font-mono text-[10px]">{selectedAgent.id.slice(0, 12)}...</span>
 </div>
 <Separator />
 <div className="flex justify-between">
 <span className="text-muted-foreground">Voice</span>
 <span>
 {selectedAgent.voice?.voiceId || selectedAgent.voice?.provider || '—'}
 </span>
 </div>
 <Separator />
 <div className="flex justify-between">
 <span className="text-muted-foreground">Model</span>
 <span>{selectedAgent.model?.model || '—'}</span>
 </div>
 <Separator />
 <div className="flex justify-between">
 <span className="text-muted-foreground">Transfer</span>
 <span className="font-mono">{selectedAgent.forwardingPhoneNumber || '—'}</span>
 </div>
 <Separator />
 <div className="flex justify-between">
 <span className="text-muted-foreground">Updated</span>
 <span>{new Date(selectedAgent.updatedAt).toLocaleDateString()}</span>
 </div>
 </CardContent>
 </Card>
 )}
 </div>
 </div>
 </div>
 );
}

