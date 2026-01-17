'use client';

import { useState, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  Upload,
  PhoneCall,
  CheckCircle,
  XCircle,
  Clock,
  Users,
  TrendingUp,
  Volume2,
  Settings2,
  RefreshCw
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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

export default function BotDashboard() {
  // Campaign state
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus>('idle');
  const [activeCalls, setActiveCalls] = useState(0);
  const [completedCalls, setCompletedCalls] = useState(0);
  const [remainingCalls, setRemainingCalls] = useState(0);

  // Configuration state
  const [concurrency, setConcurrency] = useState(10);
  const [callDelay, setCallDelay] = useState([3, 6]);
  const [script, setScript] = useState(`Hello! This is a quick call from {company}.

We're reaching out about the final expense coverage you requested information on.

Is this a good time to speak for just a moment?`);

  // Leads state
  const [leads, setLeads] = useState<Lead[]>([]);
  const [isLoadingLeads, setIsLoadingLeads] = useState(false);

  // Stats
  const [stats, setStats] = useState({
    totalCalls: 0,
    humanAnswered: 0,
    machineDetected: 0,
    transferred: 0,
    avgDuration: 0
  });

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
      } catch (e) {
        // Silent fail - API might not be running
      }
    };

    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    try {
      const res = await fetch('/api/bot/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concurrency, callDelay, script })
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
    try {
      const res = await fetch('/api/bot/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script })
      });
      if (res.ok) {
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audio.play();
      }
    } catch (e) {
      console.error('TTS preview failed:', e);
    }
  };

  const handleUploadLeads = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsLoadingLeads(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/bot/leads/upload', {
        method: 'POST',
        body: formData
      });
      if (res.ok) {
        const data = await res.json();
        setLeads(data.leads);
        setRemainingCalls(data.leads.length);
      }
    } catch (e) {
      console.error('Failed to upload leads:', e);
    } finally {
      setIsLoadingLeads(false);
    }
  };

  const getStatusBadge = (status: CampaignStatus) => {
    const variants: Record<CampaignStatus, { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
      idle: { variant: 'secondary', label: 'Idle' },
      running: { variant: 'default', label: 'Running' },
      paused: { variant: 'outline', label: 'Paused' },
      complete: { variant: 'default', label: 'Complete' },
      error: { variant: 'destructive', label: 'Error' }
    };
    const { variant, label } = variants[status];
    return <Badge variant={variant}>{label}</Badge>;
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Voice Bot</h1>
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Calls</CardTitle>
            <PhoneCall className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeCalls}</div>
            <p className="text-xs text-muted-foreground">of {concurrency} max concurrent</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedCalls}</div>
            <p className="text-xs text-muted-foreground">calls processed</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Remaining</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{remainingCalls}</div>
            <p className="text-xs text-muted-foreground">leads in queue</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            Campaign Controls
          </CardTitle>
          <CardDescription>Start, pause, or stop the current dialing campaign</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Button
              onClick={handleStart}
              disabled={campaignStatus === 'running'}
              className="bg-green-600 hover:bg-green-700"
            >
              <Play className="mr-2 h-4 w-4" />
              Start Campaign
            </Button>
            <Button
              onClick={handlePause}
              disabled={campaignStatus !== 'running'}
              variant="outline"
            >
              <Pause className="mr-2 h-4 w-4" />
              Pause
            </Button>
            <Button
              onClick={handleStop}
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
                  onChange={(e) => setConcurrency(Number(e.target.value))}
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
      <Tabs defaultValue="script" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="script">Script Editor</TabsTrigger>
          <TabsTrigger value="leads">Lead List</TabsTrigger>
          <TabsTrigger value="monitor">Live Monitor</TabsTrigger>
        </TabsList>

        {/* Script Editor Tab */}
        <TabsContent value="script">
          <Card>
            <CardHeader>
              <CardTitle>Voice Bot Script</CardTitle>
              <CardDescription>
                Edit the script your AI bot will use. Use {'{name}'} and {'{company}'} for dynamic placeholders.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                placeholder="Enter your call script here..."
                className="min-h-[200px] font-mono"
              />
              <div className="flex items-center gap-4">
                <Button onClick={handlePreviewTTS} variant="outline">
                  <Volume2 className="mr-2 h-4 w-4" />
                  Preview TTS
                </Button>
                <p className="text-sm text-muted-foreground">
                  Click to hear how your script will sound using Deepgram TTS
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Leads Tab */}
        <TabsContent value="leads">
          <Card>
            <CardHeader>
              <CardTitle>Lead List Management</CardTitle>
              <CardDescription>
                Upload a CSV file with phone numbers to call
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Label htmlFor="leads-upload" className="cursor-pointer">
                  <div className="flex items-center gap-2 rounded-md border border-dashed border-muted-foreground/25 px-4 py-8 hover:bg-muted/50">
                    <Upload className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Upload Lead CSV</p>
                      <p className="text-sm text-muted-foreground">Columns: phone, name (optional)</p>
                    </div>
                  </div>
                </Label>
                <Input
                  id="leads-upload"
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleUploadLeads}
                  className="hidden"
                />
              </div>

              {leads.length > 0 && (
                <div className="rounded-md border">
                  <div className="max-h-[400px] overflow-auto">
                    <table className="w-full">
                      <thead className="sticky top-0 bg-muted">
                        <tr>
                          <th className="p-2 text-left font-medium">Phone</th>
                          <th className="p-2 text-left font-medium">Name</th>
                          <th className="p-2 text-left font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {leads.slice(0, 100).map((lead) => (
                          <tr key={lead.id} className="border-t">
                            <td className="p-2 font-mono text-sm">{lead.phone}</td>
                            <td className="p-2 text-sm">{lead.name || '-'}</td>
                            <td className="p-2">
                              <Badge variant={
                                lead.status === 'success' ? 'default' :
                                lead.status === 'failed' ? 'destructive' :
                                lead.status === 'calling' ? 'secondary' : 'outline'
                              }>
                                {lead.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {leads.length > 100 && (
                    <p className="p-2 text-center text-sm text-muted-foreground">
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
              <CardDescription>
                Real-time view of active calls and their status
              </CardDescription>
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
      </Tabs>
    </div>
  );
}
