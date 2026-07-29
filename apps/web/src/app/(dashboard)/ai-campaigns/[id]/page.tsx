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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiClient } from '@/lib/api';


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
  DRAFT: 'bg-secondary text-muted-foreground border-border',
  READY: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  RUNNING: 'bg-green-500/20 text-green-400 border-green-500/30 animate-pulse',
  PAUSED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  COMPLETED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const contactStatusColors: Record<string, string> = {
  PENDING: 'bg-secondary text-muted-foreground',
  CALLING: 'bg-blue-500/20 text-blue-400 animate-pulse',
  COMPLETED: 'bg-green-500/20 text-green-400',
  FAILED: 'bg-red-500/20 text-red-400',
  SKIPPED: 'bg-secondary text-muted-foreground',
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

  // Restart Unreached modal state
  const [isRestartModalOpen, setIsRestartModalOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restartLoading, setRestartLoading] = useState(false);
  const [previewData, setPreviewData] = useState<any | null>(null);

  const fetchCampaign = useCallback(async () => {
    try {
      const res = await apiClient.get<Campaign>(`/api/v1/ai-campaigns/${campaignId}`);
      if (res.error) throw new Error(res.error.message);
      setCampaign(res.data || null);
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
      const res = await apiClient.get<CampaignStats>(`/api/v1/ai-campaigns/${campaignId}/stats`);
      if (res.error) return;
      setStats(res.data || null);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, [campaignId]);

  const fetchContacts = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: Contact[] }>(`/api/v1/ai-campaigns/${campaignId}/contacts`);
      if (res.error) return;
      setContacts(res.data?.data || []);
    } catch (error) {
      console.error('Error fetching contacts:', error);
    }
  }, [campaignId]);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await apiClient.get<{ data: CallRecord[] }>(`/api/v1/ai-campaigns/${campaignId}/calls`);
      if (res.error) return;
      setCalls(res.data?.data || []);
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
      const res = await apiClient.post<Campaign>(`/api/v1/ai-campaigns/${campaignId}/start`);
      if (res.error) throw new Error(res.error.message || 'Failed to start');
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
      const res = await apiClient.post<Campaign>(`/api/v1/ai-campaigns/${campaignId}/pause`);
      if (res.error) throw new Error(res.error.message || 'Failed to pause');
      toast({ title: 'Campaign Paused' });
      void fetchCampaign();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to pause campaign',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const fetchRestartPreview = async () => {
    setPreviewLoading(true);
    try {
      const res = await apiClient.get<any>(`/api/v1/ai-campaigns/${campaignId}/restart-unreached/preview`);
      if (res.error) throw new Error(res.error.message);
      setPreviewData(res.data);
    } catch (error) {
      console.error('Error fetching restart preview:', error);
      toast({
        title: 'Error',
        description: 'Failed to load restart preview data',
        variant: 'destructive',
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleOpenRestartModal = async () => {
    setIsRestartModalOpen(true);
    await fetchRestartPreview();
  };

  const handleExecuteRestart = async () => {
    setRestartLoading(true);
    try {
      const res = await apiClient.post<any>(`/api/v1/ai-campaigns/${campaignId}/restart-unreached`);
      if (res.error) throw new Error(res.error.message);
      toast({
        title: 'Campaign Restarted',
        description: `Successfully reset ${res.data?.totalEligible || 0} unreached contacts.`,
      });
      setIsRestartModalOpen(false);
      await fetchCampaign();
      await Promise.all([fetchStats(), fetchContacts(), fetchCalls()]);
    } catch (error) {
      console.error('Error executing restart:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to restart unreached contacts',
        variant: 'destructive',
      });
    } finally {
      setRestartLoading(false);
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

      const res = await apiClient.post<any>(`/api/v1/ai-campaigns/${campaignId}/contacts`, {
        contacts: parsedContacts,
      });

      if (res.error) throw new Error(res.error.message || 'Upload failed');

      toast({
        title: 'Contacts Uploaded',
        description: `Imported ${res.data?.imported || 0} contacts (${res.data?.skipped || 0} skipped)`,
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
          {(campaign.status === 'PAUSED' || campaign.status === 'COMPLETED') && (
            <Button
              onClick={() => void handleOpenRestartModal()}
              variant="outline"
              className="border-primary/30 hover:border-primary/60 text-primary"
              disabled={actionLoading}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Restart Unreached
            </Button>
          )}
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
        <Card className="bg-card border-primary/20">
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
        <Card className="bg-card border-green-500/20">
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

      {/* Restart Unreached Preview & Confirmation Modal */}
      <Dialog open={isRestartModalOpen} onOpenChange={setIsRestartModalOpen}>
        <DialogContent className="max-w-md bg-card border border-border">
          <DialogHeader>
            <DialogTitle>Restart Unreached Contacts</DialogTitle>
            <DialogDescription>
              This will reset unreached contacts back to PENDING status so they can be dialed again.
            </DialogDescription>
          </DialogHeader>

          {previewLoading ? (
            <div className="flex flex-col items-center justify-center py-6 space-y-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Calculating eligibility...</span>
            </div>
          ) : previewData ? (
            <div className="space-y-4 my-2">
              <div className="grid grid-cols-2 gap-2 text-sm border border-border p-3 rounded-md bg-muted/20">
                <span className="text-muted-foreground">Total Contacts:</span>
                <span className="font-semibold text-right">{previewData.totalContacts}</span>
                
                <span className="text-muted-foreground">Customer Reached (Excluded):</span>
                <span className="font-semibold text-destructive text-right">-{previewData.humanReachedExcluded}</span>
                
                <span className="text-muted-foreground">Assistant Ended (Excluded):</span>
                <span className="font-semibold text-destructive text-right">-{previewData.assistantEndedExcluded || 0}</span>

                <span className="text-muted-foreground">Ambiguous / Unknown (Excluded):</span>
                <span className="font-semibold text-destructive text-right">-{previewData.unknownExcluded || 0}</span>
                
                <span className="text-muted-foreground">DNC (Excluded):</span>
                <span className="font-semibold text-destructive text-right">-{previewData.dncExcluded}</span>
                
                <span className="text-muted-foreground">Wrong Number (Excluded):</span>
                <span className="font-semibold text-destructive text-right">-{previewData.wrongNumberExcluded}</span>
                
                <span className="text-muted-foreground">Active Call (Excluded):</span>
                <span className="font-semibold text-destructive text-right">-{previewData.activeCallExcluded}</span>
                
                <div className="col-span-2 border-t border-border my-1" />

                <span className="text-muted-foreground">Never Attempted (Eligible):</span>
                <span className="font-semibold text-green-500 text-right">+{previewData.neverAttemptedEligible}</span>

                <span className="text-muted-foreground">No Answer (Eligible):</span>
                <span className="font-semibold text-green-500 text-right">+{previewData.noAnswerEligible}</span>

                <span className="text-muted-foreground">Busy (Eligible):</span>
                <span className="font-semibold text-green-500 text-right">+{previewData.busyEligible}</span>

                <span className="text-muted-foreground font-medium">Voicemail (Eligible):</span>
                <span className="font-semibold text-green-500 text-right">+{previewData.voicemailEligible}</span>

                <span className="text-muted-foreground">Failed/Silence (Eligible):</span>
                <span className="font-semibold text-green-500 text-right">+{previewData.failedOrSilenceEligible}</span>
                
                <div className="col-span-2 border-t border-border my-1" />

                <span className="font-semibold text-primary">Total to Restart:</span>
                <span className="font-bold text-primary text-right">{previewData.totalEligible}</span>
              </div>

              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-3 text-xs text-yellow-500 space-y-1">
                <p className="font-medium">⚠️ Important Compliance Note:</p>
                <p>Contacts previously reached by a customer, assistant-ended calls, ambiguous completions, wrong numbers, or numbers placed on the Do Not Call list are strictly excluded because human contact cannot be verified. The campaign status will reset to READY; calling will not begin automatically.</p>
              </div>

            </div>
          ) : (
            <div className="text-center py-4 text-sm text-destructive">
              Failed to load preview data.
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setIsRestartModalOpen(false)}
              disabled={restartLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleExecuteRestart()}
              disabled={previewLoading || !previewData || previewData.totalEligible === 0 || restartLoading}
            >
              {restartLoading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Restart Contacts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

