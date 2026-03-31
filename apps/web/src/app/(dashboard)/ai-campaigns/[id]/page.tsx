'use client';

import {
  ArrowLeft,
  Download,
  Loader2,
  Pause,
  Phone,
  Play,
  RefreshCw,
  Upload,
  Users,
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface Campaign {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED';
  vertical: string;
  direction: string;
  carrier: string;
  agencyName: string;
  transferNumber: string;
  filters: Record<string, boolean>;
  vapiAssistantId: string | null;
  maxConcurrent: number;
  callsPerMinute: number;
  createdAt: string;
}

interface CampaignStats {
  campaignId: string;
  totalContacts: number;
  pendingContacts: number;
  completedContacts: number;
  failedContacts: number;
  totalCalls: number;
  activeCalls: number;
  completedCalls: number;
  totalCost: number;
  totalBillable: number;
  avgDuration: number;
  successRate: number;
}

interface Contact {
  id: string;
  phoneNumber: string;
  firstName: string | null;
  lastName: string | null;
  status: string;
  calledAt: string | null;
}

interface CallRecord {
  id: string;
  contactId: string;
  status: string;
  duration: number | null;
  outcome: string | null;
  recordingUrl: string | null;
  startedAt: string;
  endedAt: string | null;
  cost: number | null;
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  READY: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  RUNNING: 'bg-green-500/20 text-green-400 border-green-500/30 animate-pulse',
  PAUSED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  COMPLETED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const contactStatusColors: Record<string, string> = {
  PENDING: 'bg-slate-500/20 text-slate-400',
  CALLING: 'bg-blue-500/20 text-blue-400 animate-pulse',
  COMPLETED: 'bg-green-500/20 text-green-400',
  FAILED: 'bg-red-500/20 text-red-400',
  SKIPPED: 'bg-gray-500/20 text-gray-400',
  NO_ANSWER: 'bg-yellow-500/20 text-yellow-400',
};

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const campaignId = params.id as string;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [calls, setCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [uploadLoading, setUploadLoading] = useState(false);

  const fetchCampaign = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Campaign not found');
      const data = await res.json();
      setCampaign(data);
    } catch (error) {
      console.error('Error fetching campaign:', error);
      toast({
        title: 'Error',
        description: 'Failed to load campaign',
        variant: 'destructive',
      });
    }
  }, [campaignId, toast]);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}/stats`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setStats(data);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, [campaignId]);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}/contacts`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setContacts(data.data || []);
    } catch (error) {
      console.error('Error fetching contacts:', error);
    }
  }, [campaignId]);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}/calls`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setCalls(data.data || []);
    } catch (error) {
      console.error('Error fetching calls:', error);
    }
  }, [campaignId]);

  useEffect(() => {
    const loadAll = async () => {
      await fetchCampaign();
      await Promise.all([fetchStats(), fetchContacts(), fetchCalls()]);
      setLoading(false);
    };
    void loadAll();
  }, [fetchCampaign, fetchStats, fetchContacts, fetchCalls]);

  // Auto-refresh stats when campaign is running
  useEffect(() => {
    if (campaign?.status !== 'RUNNING') return;

    const interval = setInterval(() => {
      void fetchStats();
      void fetchContacts();
      void fetchCalls();
    }, 5000);

    return () => clearInterval(interval);
  }, [campaign?.status, fetchStats, fetchContacts, fetchCalls]);

  const handleStart = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}/start`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to start');
      }
      toast({ title: 'Campaign Started', description: 'AI calling is now active' });
      void fetchCampaign();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start campaign',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handlePause = async () => {
    setActionLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}/pause`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to pause');
      toast({ title: 'Campaign Paused' });
      void fetchCampaign();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to pause campaign',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadLoading(true);
    try {
      const text = await file.text();
      const lines = text.split('\n').filter(l => l.trim());

      // Parse CSV - expect header row
      const headers = lines[0]
        .toLowerCase()
        .split(',')
        .map(h => h.trim());
      const phoneIdx = headers.findIndex(h => h.includes('phone') || h.includes('number'));
      const firstNameIdx = headers.findIndex(h => h.includes('first'));
      const lastNameIdx = headers.findIndex(h => h.includes('last'));

      if (phoneIdx === -1) {
        throw new Error('CSV must have a column containing "phone" or "number"');
      }

      const parsedContacts = lines
        .slice(1)
        .map(line => {
          const cols = line.split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
          return {
            phoneNumber: cols[phoneIdx],
            firstName: firstNameIdx >= 0 ? cols[firstNameIdx] : undefined,
            lastName: lastNameIdx >= 0 ? cols[lastNameIdx] : undefined,
          };
        })
        .filter(c => c.phoneNumber);

      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}/contacts`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: parsedContacts }),
      });

      if (!res.ok) throw new Error('Upload failed');

      const result = await res.json();
      toast({
        title: 'Contacts Uploaded',
        description: `Imported ${result.imported} contacts (${result.skipped} skipped)`,
      });

      void fetchStats();
      void fetchContacts();
      void fetchCampaign();
    } catch (error) {
      toast({
        title: 'Upload Error',
        description: error instanceof Error ? error.message : 'Failed to upload contacts',
        variant: 'destructive',
      });
    } finally {
      setUploadLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <div className="grid gap-4 md:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <h2 className="text-xl font-semibold">Campaign Not Found</h2>
        <Button onClick={() => router.push('/ai-campaigns')} className="mt-4">
          Back to Campaigns
        </Button>
      </div>
    );
  }

  const progress = stats
    ? Math.round(
        ((stats.completedContacts + stats.failedContacts) / Math.max(stats.totalContacts, 1)) * 100
      )
    : 0;

  const handleRefresh = () => {
    void fetchStats();
    void fetchContacts();
    void fetchCalls();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.push('/ai-campaigns')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{campaign.name}</h1>
              <Badge variant="outline" className={statusColors[campaign.status]}>
                {campaign.status}
              </Badge>
            </div>
            {campaign.description && (
              <p className="text-muted-foreground mt-1">{campaign.description}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          {campaign.status === 'RUNNING' ? (
            <Button
              onClick={() => void handlePause()}
              variant="destructive"
              disabled={actionLoading}
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Pause className="h-4 w-4 mr-2" />
              )}
              Pause
            </Button>
          ) : campaign.status !== 'COMPLETED' ? (
            <Button
              onClick={() => void handleStart()}
              disabled={actionLoading || (stats?.pendingContacts || 0) === 0}
            >
              {actionLoading ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Play className="h-4 w-4 mr-2" />
              )}
              Start
            </Button>
          ) : null}
        </div>
      </div>

      {/* Progress Bar */}
      {stats && stats.totalContacts > 0 && (
        <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Campaign Progress</span>
              <span className="text-sm text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>{stats.completedContacts + stats.failedContacts} processed</span>
              <span>{stats.pendingContacts} remaining</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Total Contacts
            </CardDescription>
            <CardTitle className="text-2xl">{stats?.totalContacts || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-gradient-to-br from-green-500/5 to-green-500/10 border-green-500/20">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Phone className="h-4 w-4" />
              Completed Calls
            </CardDescription>
            <CardTitle className="text-2xl text-green-400">{stats?.completedCalls || 0}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Success Rate</CardDescription>
            <CardTitle className="text-2xl">{stats?.successRate?.toFixed(1) || 0}%</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Cost</CardDescription>
            <CardTitle className="text-2xl">
              ${stats?.totalBillable?.toFixed(2) || '0.00'}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="contacts">
        <TabsList>
          <TabsTrigger value="contacts">Contacts ({contacts.length})</TabsTrigger>
          <TabsTrigger value="calls">Call Records ({calls.length})</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="contacts" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Contact List</CardTitle>
                <CardDescription>Manage contacts for this campaign</CardDescription>
              </div>
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  className="hidden"
                  onChange={e => void handleFileUpload(e)}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadLoading || campaign.status === 'RUNNING'}
                >
                  {uploadLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="h-4 w-4 mr-2" />
                  )}
                  Upload CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {contacts.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-semibold">No Contacts Yet</h3>
                  <p className="text-muted-foreground mb-4">
                    Upload a CSV file with phone numbers to get started.
                  </p>
                  <p className="text-xs text-muted-foreground">
                    CSV should have columns: phone/number, first_name (optional), last_name
                    (optional)
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Phone Number</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Called At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contacts.slice(0, 100).map(contact => (
                      <TableRow key={contact.id}>
                        <TableCell className="font-mono">{contact.phoneNumber}</TableCell>
                        <TableCell>
                          {contact.firstName || contact.lastName
                            ? `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
                            : '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={contactStatusColors[contact.status]}>
                            {contact.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {contact.calledAt ? new Date(contact.calledAt).toLocaleString() : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {contacts.length > 100 && (
                <p className="text-center text-sm text-muted-foreground mt-4">
                  Showing first 100 of {contacts.length} contacts
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calls" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Call Records</CardTitle>
              <CardDescription>History of all calls made in this campaign</CardDescription>
            </CardHeader>
            <CardContent>
              {calls.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Phone className="h-12 w-12 text-muted-foreground/50 mb-4" />
                  <h3 className="text-lg font-semibold">No Calls Yet</h3>
                  <p className="text-muted-foreground">
                    Call records will appear here once the campaign starts.
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Cost</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Recording</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {calls.map(call => (
                      <TableRow key={call.id}>
                        <TableCell>
                          <Badge variant="outline" className={contactStatusColors[call.status]}>
                            {call.status}
                          </Badge>
                        </TableCell>
                        <TableCell>{call.outcome || '-'}</TableCell>
                        <TableCell>
                          {call.duration
                            ? `${Math.floor(call.duration / 60)}:${(call.duration % 60).toString().padStart(2, '0')}`
                            : '-'}
                        </TableCell>
                        <TableCell>
                          {call.cost ? `$${Number(call.cost).toFixed(4)}` : '-'}
                        </TableCell>
                        <TableCell>{new Date(call.startedAt).toLocaleString()}</TableCell>
                        <TableCell>
                          {call.recordingUrl ? (
                            <Button variant="ghost" size="sm" asChild>
                              <a href={call.recordingUrl} target="_blank" rel="noopener noreferrer">
                                <Download className="h-4 w-4" />
                              </a>
                            </Button>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Campaign Settings</CardTitle>
              <CardDescription>Template-based configuration for this AI campaign</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Vertical</label>
                  <p className="text-lg">
                    <Badge variant="outline" className="text-sm">
                      {campaign.vertical === 'ACA'
                        ? 'ACA Health'
                        : campaign.vertical === 'FINAL_EXPENSE'
                          ? 'Final Expense'
                          : campaign.vertical}
                    </Badge>
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Direction</label>
                  <p className="text-lg">{campaign.direction}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">VOIP Carrier</label>
                  <p className="text-lg">
                    <Badge
                      variant="outline"
                      className={campaign.carrier === 'signalwire'
                        ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                        : 'text-sm'}
                    >
                      {campaign.carrier === 'signalwire' ? 'SignalWire' : 'BulkVS / FreeSWITCH'}
                    </Badge>
                  </p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Agency Name</label>
                  <p className="text-lg">{campaign.agencyName}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Transfer Number
                  </label>
                  <p className="text-lg">{campaign.transferNumber}</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">
                    Max Concurrent
                  </label>
                  <p className="text-lg">{campaign.maxConcurrent} calls</p>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground">Rate Limit</label>
                  <p className="text-lg">{campaign.callsPerMinute} calls/min</p>
                </div>
              </div>
              {/* Filters */}
              <div>
                <label className="text-sm font-medium text-muted-foreground">Active Filters</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {campaign.filters &&
                    Object.entries(campaign.filters)
                      .filter(([, v]) => v)
                      .map(([key]) => (
                        <Badge key={key} variant="secondary" className="text-xs">
                          {key.replace(/_/g, ' ')}
                        </Badge>
                      ))}
                  {(!campaign.filters ||
                    Object.values(campaign.filters).filter(Boolean).length === 0) && (
                    <span className="text-sm text-muted-foreground">
                      No optional filters enabled
                    </span>
                  )}
                </div>
              </div>
              {/* Vapi Status */}
              <div>
                <label className="text-sm font-medium text-muted-foreground">
                  AI Assistant Status
                </label>
                <p className="mt-1">
                  {campaign.vapiAssistantId ? (
                    <Badge className="bg-green-500/20 text-green-400 border-green-500/30">
                      Provisioned
                    </Badge>
                  ) : (
                    <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                      Pending
                    </Badge>
                  )}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
