'use client';

import {
  CheckCircle,
  Clock,
  FileAudio,
  History,
  Loader2,
  Mic,
  Pause,
  PhoneCall,
  PhoneForwarded,
  Play,
  RefreshCw,
  Save,
  Settings2,
  Square,
  TrendingUp,
  Upload,
  User,
  Volume2,
} from 'lucide-react';
import { useState, useEffect, useRef } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

// Deepgram Aura voices
const VOICES = [
  { id: 'aura-asteria-en', name: 'Asteria', gender: 'Female', accent: 'American' },
  { id: 'aura-luna-en', name: 'Luna', gender: 'Female', accent: 'American' },
  { id: 'aura-stella-en', name: 'Stella', gender: 'Female', accent: 'American' },
  { id: 'aura-athena-en', name: 'Athena', gender: 'Female', accent: 'British' },
  { id: 'aura-hera-en', name: 'Hera', gender: 'Female', accent: 'American' },
  { id: 'aura-orion-en', name: 'Orion', gender: 'Male', accent: 'American' },
  { id: 'aura-arcas-en', name: 'Arcas', gender: 'Male', accent: 'American' },
  { id: 'aura-perseus-en', name: 'Perseus', gender: 'Male', accent: 'American' },
  { id: 'aura-angus-en', name: 'Angus', gender: 'Male', accent: 'Irish' },
  { id: 'aura-orpheus-en', name: 'Orpheus', gender: 'Male', accent: 'American' },
  { id: 'aura-helios-en', name: 'Helios', gender: 'Male', accent: 'British' },
  { id: 'aura-zeus-en', name: 'Zeus', gender: 'Male', accent: 'American' },
];

const DEFAULT_SCRIPT = `Hello! This is a quick call from {company}.

We're reaching out about the final expense coverage you requested information on.

Is this a good time to speak for just a moment?`;

// Status types for the campaign
type CampaignStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';

interface DialerStatus {
  status: CampaignStatus;
  active_calls: number;
  completed: number;
  remaining: number;
  timestamp: number;
}

interface Lead {
  id: string;
  phone: string;
  name?: string;
  status: 'pending' | 'calling' | 'success' | 'failed' | 'no_answer';
  calledAt?: string;
}

interface CallRecord {
  id: string;
  timestamp: string;
  customerPhone: string;
  status: string;
  duration: string;
  callId: string;
  did: string;
  transferred: boolean;
  hasRecording: boolean;
}

export default function BotDashboard() {
  // Campaign state
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus>('idle');
  const [activeCalls, setActiveCalls] = useState(0);
  const [completedCalls, setCompletedCalls] = useState(0);
  const [remainingCalls, setRemainingCalls] = useState(0);

  // Configuration state
  const [concurrency, setConcurrency] = useState(10);
  const [selectedVoice, setSelectedVoice] = useState('aura-asteria-en');
  const [script, setScript] = useState(DEFAULT_SCRIPT);

  // UI state
  const [isLoadingTTS, setIsLoadingTTS] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Leads state
  const [leads, setLeads] = useState<Lead[]>([]);

  // Call logs state
  const [callLogs, setCallLogs] = useState<CallRecord[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [playingCallId, setPlayingCallId] = useState<string | null>(null);

  // Stats
  const [stats] = useState({
    totalCalls: 0,
    humanAnswered: 0,
    machineDetected: 0,
    transferred: 0,
    avgDuration: 0,
  });

  // Load saved settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/bot/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.script) setScript(data.script);
          if (data.voice) setSelectedVoice(data.voice);
          if (data.concurrency) setConcurrency(data.concurrency);
        }
      } catch {
        // Use defaults
      }
    };
    void loadSettings();
  }, []);

  // Load call logs
  const loadCallLogs = async () => {
    setIsLoadingLogs(true);
    try {
      const res = await fetch('/api/bot/calls');
      if (res.ok) {
        const data = await res.json();
        setCallLogs(data.calls || []);
      }
    } catch {
      // Failed to load
    } finally {
      setIsLoadingLogs(false);
    }
  };

  useEffect(() => {
    void loadCallLogs();
  }, []);

  // Poll for status updates
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const res = await fetch('/api/bot/status');
        if (res.ok) {
          const data: DialerStatus = await res.json();
          setCampaignStatus(data.status);
          setActiveCalls(data.active_calls);
          setCompletedCalls(data.completed);
          setRemainingCalls(data.remaining);
        }
      } catch {
        // Silent fail - API might not be running
      }
    };

    void pollStatus();
    const interval = setInterval(() => {
      void pollStatus();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concurrency, script, voice: selectedVoice }),
      });
      if (res.ok) {
        setCampaignStatus('running');
      }
    } catch (e) {
      console.error('Failed to start campaign:', e);
    }
  };

  const handlePause = async () => {
    try {
      await fetch('/api/bot/pause', { method: 'POST' });
      setCampaignStatus('paused');
    } catch (e) {
      console.error('Failed to pause campaign:', e);
    }
  };

  const handleStop = async () => {
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      setCampaignStatus('idle');
    } catch (e) {
      console.error('Failed to stop campaign:', e);
    }
  };

  const handlePreviewTTS = async () => {
    // Stop any current playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    setIsLoadingTTS(true);
    setIsPlaying(false);

    try {
      const res = await fetch('/api/bot/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice: selectedVoice }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;

        audio.onplay = () => setIsPlaying(true);
        audio.onended = () => setIsPlaying(false);
        audio.onpause = () => setIsPlaying(false);

        void audio.play();
      }
    } catch (e) {
      console.error('TTS preview failed:', e);
    } finally {
      setIsLoadingTTS(false);
    }
  };

  const handleStopPlayback = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setIsPlaying(false);
    }
  };

  const handleSaveSettings = async () => {
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const res = await fetch('/api/bot/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script, voice: selectedVoice, concurrency }),
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (e) {
      console.error('Failed to save settings:', e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleUploadLeads = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/bot/leads/upload', {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads);
        setRemainingCalls(data.leads.length);
      }
    } catch (e) {
      console.error('Failed to upload leads:', e);
    }
  };

  const getStatusBadge = (status: CampaignStatus) => {
    const variants: Record<
      CampaignStatus,
      { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }
    > = {
      idle: { variant: 'secondary', label: 'Idle' },
      running: { variant: 'default', label: 'Running' },
      paused: { variant: 'outline', label: 'Paused' },
      complete: { variant: 'default', label: 'Complete' },
      error: { variant: 'destructive', label: 'Error' },
    };
    const { variant, label } = variants[status];
    return <Badge variant={variant}>{label}</Badge>;
  };

  const selectedVoiceData = VOICES.find(v => v.id === selectedVoice);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
            AI Voice Bot
          </h1>
          <p className="text-muted-foreground">
            Automated outbound calling with intelligent conversation handling
          </p>
        </div>
        <div className="flex items-center gap-2">
          {getStatusBadge(campaignStatus)}
          <Button variant="outline" size="icon" onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Calls</CardTitle>
            <PhoneCall className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCalls}</div>
            <p className="text-xs text-muted-foreground">of {concurrency} max concurrent</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedCalls}</div>
            <p className="text-xs text-muted-foreground">calls processed</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Remaining</CardTitle>
            <Clock className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{remainingCalls}</div>
            <p className="text-xs text-muted-foreground">leads in queue</p>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {completedCalls > 0 ? Math.round((stats.transferred / completedCalls) * 100) : 0}%
            </div>
            <p className="text-xs text-muted-foreground">transferred to agent</p>
          </CardContent>
        </Card>
      </div>

      {/* Control Panel */}
      <Card>
        <CardHeader className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 rounded-t-lg">
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Campaign Controls
          </CardTitle>
          <CardDescription>Start, pause, or stop the current dialing campaign</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4">
            <Button
              onClick={() => void handleStart()}
              disabled={campaignStatus === 'running'}
              className="bg-green-600 hover:bg-green-700"
            >
              <Play className="mr-2 h-4 w-4" />
              Start Campaign
            </Button>
            <Button
              onClick={() => void handlePause()}
              disabled={campaignStatus !== 'running'}
              variant="outline"
            >
              <Pause className="mr-2 h-4 w-4" />
              Pause
            </Button>
            <Button
              onClick={() => void handleStop()}
              disabled={campaignStatus === 'idle'}
              variant="destructive"
            >
              <Square className="mr-2 h-4 w-4" />
              Stop
            </Button>

            <div className="ml-auto flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-sm">Concurrency:</Label>
                <Input
                  type="number"
                  value={concurrency}
                  onChange={e => setConcurrency(Number(e.target.value))}
                  className="w-20"
                  min={1}
                  max={10}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
      <Tabs defaultValue="voice" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="voice" className="flex items-center gap-2">
            <Mic className="h-4 w-4" />
            Voice & Script
          </TabsTrigger>
          <TabsTrigger value="leads">Lead List</TabsTrigger>
          <TabsTrigger value="calllog" className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Call Log
          </TabsTrigger>
          <TabsTrigger value="monitor">Live Monitor</TabsTrigger>
        </TabsList>

        {/* Voice & Script Tab */}
        <TabsContent value="voice">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Voice Selection Card */}
            <Card className="lg:col-span-1">
              <CardHeader className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-950 dark:to-purple-950 rounded-t-lg">
                <CardTitle className="flex items-center gap-2">
                  <Volume2 className="h-5 w-5 text-indigo-600" />
                  AI Voice
                </CardTitle>
                <CardDescription>Choose the voice for your AI bot</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <Select value={selectedVoice} onValueChange={setSelectedVoice}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a voice" />
                  </SelectTrigger>
                  <SelectContent>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                      Female Voices
                    </div>
                    {VOICES.filter(v => v.gender === 'Female').map(voice => (
                      <SelectItem key={voice.id} value={voice.id}>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-pink-500" />
                          <span>{voice.name}</span>
                          <span className="text-xs text-muted-foreground">({voice.accent})</span>
                        </div>
                      </SelectItem>
                    ))}
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground mt-2">
                      Male Voices
                    </div>
                    {VOICES.filter(v => v.gender === 'Male').map(voice => (
                      <SelectItem key={voice.id} value={voice.id}>
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-blue-500" />
                          <span>{voice.name}</span>
                          <span className="text-xs text-muted-foreground">({voice.accent})</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Selected Voice Preview */}
                {selectedVoiceData && (
                  <div className="rounded-lg border bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 p-4">
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full ${
                          selectedVoiceData.gender === 'Female'
                            ? 'bg-pink-100 text-pink-600 dark:bg-pink-900'
                            : 'bg-blue-100 text-blue-600 dark:bg-blue-900'
                        }`}
                      >
                        <User className="h-6 w-6" />
                      </div>
                      <div>
                        <p className="font-semibold">{selectedVoiceData.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {selectedVoiceData.gender} • {selectedVoiceData.accent}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    onClick={isPlaying ? handleStopPlayback : () => void handlePreviewTTS()}
                    disabled={isLoadingTTS || !script.trim()}
                    className="flex-1"
                    variant={isPlaying ? 'destructive' : 'default'}
                  >
                    {isLoadingTTS ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : isPlaying ? (
                      <Square className="mr-2 h-4 w-4" />
                    ) : (
                      <Volume2 className="mr-2 h-4 w-4" />
                    )}
                    {isLoadingTTS ? 'Generating...' : isPlaying ? 'Stop' : 'Preview Voice'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Script Editor Card */}
            <Card className="lg:col-span-2">
              <CardHeader className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950 dark:to-teal-950 rounded-t-lg">
                <CardTitle>Bot Script</CardTitle>
                <CardDescription>
                  Edit the script your AI bot will use. Use {'{name}'} and {'{company}'} for dynamic
                  placeholders.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                <Textarea
                  value={script}
                  onChange={e => setScript(e.target.value)}
                  placeholder="Enter your call script here..."
                  className="min-h-[250px] font-mono text-sm leading-relaxed"
                />
                <div className="flex items-center justify-between">
                  <p className="text-sm text-muted-foreground">
                    {script.length} characters • ~{Math.ceil(script.split(' ').length / 150)} min
                    read time
                  </p>
                  <Button
                    onClick={() => void handleSaveSettings()}
                    disabled={isSaving}
                    variant={saveSuccess ? 'default' : 'outline'}
                    className={saveSuccess ? 'bg-green-600 hover:bg-green-700' : ''}
                  >
                    {isSaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : saveSuccess ? (
                      <CheckCircle className="mr-2 h-4 w-4" />
                    ) : (
                      <Save className="mr-2 h-4 w-4" />
                    )}
                    {isSaving ? 'Saving...' : saveSuccess ? 'Saved!' : 'Save Settings'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Leads Tab */}
        <TabsContent value="leads">
          <Card>
            <CardHeader>
              <CardTitle>Lead List Management</CardTitle>
              <CardDescription>Upload a CSV file with phone numbers to call</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Label htmlFor="leads-upload" className="cursor-pointer">
                  <div className="flex items-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 px-6 py-8 hover:bg-muted/50 hover:border-primary/50 transition-colors">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Upload Lead CSV</p>
                      <p className="text-sm text-muted-foreground">
                        Columns: phone, name (optional)
                      </p>
                    </div>
                  </div>
                </Label>
                <Input
                  id="leads-upload"
                  type="file"
                  accept=".csv,.txt"
                  onChange={e => void handleUploadLeads(e)}
                  className="hidden"
                />
              </div>

              {leads.length > 0 && (
                <div className="rounded-lg border">
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="p-3 text-left font-medium">Phone</th>
                          <th className="p-3 text-left font-medium">Name</th>
                          <th className="p-3 text-left font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.slice(0, 100).map(lead => (
                          <tr key={lead.id} className="border-t hover:bg-muted/50">
                            <td className="p-3 font-mono text-sm">{lead.phone}</td>
                            <td className="p-3 text-sm">{lead.name || '-'}</td>
                            <td className="p-3">
                              <Badge
                                variant={
                                  lead.status === 'success'
                                    ? 'default'
                                    : lead.status === 'failed'
                                      ? 'destructive'
                                      : lead.status === 'calling'
                                        ? 'secondary'
                                        : 'outline'
                                }
                              >
                                {lead.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {leads.length > 100 && (
                    <p className="p-3 text-center text-sm text-muted-foreground border-t">
                      Showing 100 of {leads.length} leads
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Live Monitor Tab */}
        <TabsContent value="monitor">
          <Card>
            <CardHeader>
              <CardTitle>Live Call Monitor</CardTitle>
              <CardDescription>Real-time view of active calls and their status</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {activeCalls === 0 ? (
                  <div className="col-span-full flex items-center justify-center py-12 text-muted-foreground">
                    <PhoneCall className="mr-2 h-5 w-5" />
                    No active calls. Start a campaign to see live activity.
                  </div>
                ) : (
                  Array.from({ length: activeCalls }).map((_, i) => (
                    <Card key={i} className="border-green-500/50 bg-green-500/5">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="font-mono text-sm">+1 (XXX) XXX-XXXX</p>
                            <p className="text-xs text-muted-foreground">Connected • 0:45</p>
                          </div>
                          <div className="flex h-3 w-3 animate-pulse rounded-full bg-green-500" />
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Call Log Tab */}
        <TabsContent value="calllog">
          <Card>
            <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950 rounded-t-lg">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5 text-amber-600" />
                    Call History
                  </CardTitle>
                  <CardDescription>
                    View past calls with recordings and transfer status
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void loadCallLogs()}
                  disabled={isLoadingLogs}
                >
                  {isLoadingLogs ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {callLogs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                  <FileAudio className="h-12 w-12 mb-4" />
                  <p className="font-medium">No call history yet</p>
                  <p className="text-sm">Calls will appear here after running a campaign</p>
                </div>
              ) : (
                <div className="rounded-lg border">
                  <div className="max-h-[500px] overflow-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="p-3 text-left font-medium">Time</th>
                          <th className="p-3 text-left font-medium">Phone Number</th>
                          <th className="p-3 text-left font-medium">Duration</th>
                          <th className="p-3 text-left font-medium">Result</th>
                          <th className="p-3 text-left font-medium">Recording</th>
                        </tr>
                      </thead>
                      <tbody>
                        {callLogs.map(call => (
                          <tr key={call.id} className="border-t hover:bg-muted/50">
                            <td className="p-3 text-sm">{call.timestamp}</td>
                            <td className="p-3 font-mono text-sm">{call.customerPhone}</td>
                            <td className="p-3 text-sm">{call.duration}s</td>
                            <td className="p-3">
                              {call.transferred ? (
                                <Badge className="bg-green-600 hover:bg-green-700">
                                  <PhoneForwarded className="mr-1 h-3 w-3" />
                                  Live Transfer
                                </Badge>
                              ) : (
                                <Badge variant="secondary">{call.status}</Badge>
                              )}
                            </td>
                            <td className="p-3">
                              {call.callId ? (
                                <div className="flex items-center gap-2">
                                  <audio
                                    id={`audio-${call.callId}`}
                                    src={`/api/bot/recordings/${call.callId}`}
                                    className="h-8 w-48"
                                    controls
                                    preload="none"
                                    onPlay={() => {
                                      // Stop other playing audios
                                      if (playingCallId && playingCallId !== call.callId) {
                                        const prevAudio = document.getElementById(
                                          `audio-${playingCallId}`
                                        ) as HTMLAudioElement | null;
                                        if (prevAudio) prevAudio.pause();
                                      }
                                      setPlayingCallId(call.callId);
                                    }}
                                    onPause={() => {
                                      if (playingCallId === call.callId) setPlayingCallId(null);
                                    }}
                                    onEnded={() => setPlayingCallId(null)}
                                  />
                                </div>
                              ) : (
                                <span className="text-sm text-muted-foreground">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {callLogs.length > 0 && (
                    <p className="p-3 text-center text-sm text-muted-foreground border-t">
                      Showing {callLogs.length} calls
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
