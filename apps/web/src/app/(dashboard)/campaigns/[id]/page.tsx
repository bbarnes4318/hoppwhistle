'use client';

import { 
  ArrowLeft, 
  Check, 
  Edit, 
  Eye, 
  Loader2, 
  Play, 
  Plus, 
  RefreshCw, 
  Save, 
  Trash2, 
  X,
  Phone,
  UserPlus,
  ShieldAlert,
  ArrowUpRight
} from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Publisher {
  id: string;
  name: string;
  code: string;
}

interface Buyer {
  id: string;
  name: string;
  code: string;
}

interface BuyerEndpoint {
  id: string;
  name: string;
  destination: string;
  basePrice: string;
}

interface CampaignPublisher {
  id: string;
  publisherId: string;
  publisher: Publisher;
  payoutPerBillableCall: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

interface CampaignBuyer {
  id: string;
  buyerId: string;
  buyer: Buyer;
  buyerEndpointId: string | null;
  buyerEndpoint: BuyerEndpoint | null;
  destinationNumber: string;
  pricePerBillableCall: string | null;
  priority: number;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

interface DidRoute {
  id: string;
  did: string;
  destination: string;
  label: string | null;
  createdAt: string;
  phoneNumber: {
    number: string;
    provider: string;
  };
}

interface CampaignDetails {
  id: string;
  name: string;
  offerName: string | null;
  country: string;
  recordingEnabled: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  publisherId: string | null;
  publisher: Publisher | null;
  flowId: string | null;
  flow: { id: string; name: string } | null;
  billableDurationSeconds: number;
  publisherPayoutPerBillableCall: string;
  buyerPricePerBillableCall: string;
  calls: number;
  phoneNumbers: number;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [activeTab, setActiveTab] = useState('settings');

  // Core Campaign Data
  const [campaign, setCampaign] = useState<CampaignDetails | null>(null);

  // Settings form state
  const [settingsForm, setSettingsForm] = useState({
    name: '',
    offerName: '',
    country: 'US',
    recordingEnabled: true,
    status: 'PAUSED' as 'ACTIVE' | 'PAUSED' | 'ARCHIVED',
    billableDurationSeconds: 60,
    publisherPayoutPerBillableCall: 0,
    buyerPricePerBillableCall: 0,
  });

  // Sub-resource lists
  const [campaignPublishers, setCampaignPublishers] = useState<CampaignPublisher[]>([]);
  const [campaignBuyers, setCampaignBuyers] = useState<CampaignBuyer[]>([]);
  const [didRoutes, setDidRoutes] = useState<DidRoute[]>([]);

  // Selection list options (for assignment dialogs)
  const [allPublishers, setAllPublishers] = useState<Publisher[]>([]);
  const [allBuyers, setAllBuyers] = useState<Buyer[]>([]);
  const [buyerEndpoints, setBuyerEndpoints] = useState<BuyerEndpoint[]>([]);

  // Dialog States
  const [pubDialogOpen, setPubDialogOpen] = useState(false);
  const [buyerDialogOpen, setBuyerDialogOpen] = useState(false);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);

  // Dialog Form States
  const [pubForm, setPubForm] = useState({
    publisherId: '',
    payoutPerBillableCall: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  const [buyerForm, setBuyerForm] = useState({
    buyerId: '',
    buyerEndpointId: '',
    destinationNumber: '',
    pricePerBillableCall: '',
    priority: 0,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  // Action states
  const [submittingPub, setSubmittingPub] = useState(false);
  const [submittingBuyer, setSubmittingBuyer] = useState(false);

  // Load Campaign and Sub-resources
  const fetchCampaignData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<CampaignDetails>(`/api/v1/campaigns/${id}`);
      if (response.data) {
        setCampaign(response.data);
        setSettingsForm({
          name: response.data.name,
          offerName: response.data.offerName || '',
          country: response.data.country,
          recordingEnabled: response.data.recordingEnabled,
          status: response.data.status,
          billableDurationSeconds: response.data.billableDurationSeconds,
          publisherPayoutPerBillableCall: Number(response.data.publisherPayoutPerBillableCall),
          buyerPricePerBillableCall: Number(response.data.buyerPricePerBillableCall),
        });
      }

      // Fetch Publisher assignments
      const pubRes = await apiClient.get<CampaignPublisher[]>(`/api/v1/campaigns/${id}/publishers`);
      if (pubRes.data) setCampaignPublishers(pubRes.data);

      // Fetch Buyer assignments
      const buyerRes = await apiClient.get<CampaignBuyer[]>(`/api/v1/campaigns/${id}/buyers`);
      if (buyerRes.data) setCampaignBuyers(buyerRes.data);

      // Fetch DID routes and filter by campaign
      const didRes = await apiClient.get<{ data: DidRoute[] }>('/api/v1/did-routes');
      if (didRes.data?.data) {
        const filtered = didRes.data.data.filter((route: any) => route.campaignId === id);
        setDidRoutes(filtered);
      }

    } catch (err) {
      console.error('Failed to load campaign data:', err);
      toast.error('Error', 'Failed to retrieve campaign details.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Load dropdown lists (Publishers & Buyers)
  const fetchDropdowns = useCallback(async () => {
    try {
      const pubRes = await apiClient.get<{ data: Publisher[] }>('/api/v1/publishers?limit=100');
      if (pubRes.data) setAllPublishers(pubRes.data.data);

      const buyerRes = await apiClient.get<{ data: Buyer[] }>('/api/v1/buyers?limit=100');
      if (buyerRes.data) setAllBuyers(buyerRes.data.data);
    } catch (err) {
      console.error('Failed to load dropdown lists:', err);
    }
  }, []);

  useEffect(() => {
    void fetchCampaignData();
    void fetchDropdowns();
  }, [fetchCampaignData, fetchDropdowns]);

  // Fetch Buyer Endpoints when a buyer is selected in Assign Buyer form
  useEffect(() => {
    if (!buyerForm.buyerId) {
      setBuyerEndpoints([]);
      return;
    }

    const fetchEndpoints = async () => {
      setLoadingEndpoints(true);
      try {
        const res = await apiClient.get<{ data: BuyerEndpoint[] }>(
          `/api/v1/buyers/${buyerForm.buyerId}/endpoints`
        );
        if (res.data?.data) {
          setBuyerEndpoints(res.data.data);
        } else {
          setBuyerEndpoints([]);
        }
      } catch (err) {
        console.error('Failed to load buyer endpoints:', err);
      } finally {
        setLoadingEndpoints(false);
      }
    };

    void fetchEndpoints();
  }, [buyerForm.buyerId]);

  // When buyer endpoint is selected, auto-populate destination
  const handleEndpointChange = (endpointId: string) => {
    const ep = buyerEndpoints.find(e => e.id === endpointId);
    setBuyerForm(prev => ({
      ...prev,
      buyerEndpointId: endpointId,
      destinationNumber: ep ? ep.destination : prev.destinationNumber
    }));
  };

  // Save Settings
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    try {
      const res = await apiClient.patch(`/api/v1/campaigns/${id}`, {
        name: settingsForm.name.trim(),
        offerName: settingsForm.offerName.trim() || null,
        country: settingsForm.country,
        recordingEnabled: settingsForm.recordingEnabled,
        status: settingsForm.status,
        billableDurationSeconds: Number(settingsForm.billableDurationSeconds),
        publisherPayoutPerBillableCall: Number(settingsForm.publisherPayoutPerBillableCall),
        buyerPricePerBillableCall: Number(settingsForm.buyerPricePerBillableCall),
      });

      if (res.error) {
        toast.error('Save Failed', res.error.message);
      } else {
        toast.success('Settings Saved', 'Campaign settings have been successfully updated.');
        void fetchCampaignData();
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      toast.error('Error', 'An unexpected error occurred while saving.');
    } finally {
      setSavingSettings(false);
    }
  };

  // Submit Publisher Assignment
  const handleAssignPublisher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pubForm.publisherId) return;

    setSubmittingPub(true);
    try {
      const res = await apiClient.post(`/api/v1/campaigns/${id}/publishers`, {
        publisherId: pubForm.publisherId,
        payoutPerBillableCall: pubForm.payoutPerBillableCall ? Number(pubForm.payoutPerBillableCall) : null,
        status: pubForm.status,
      });

      if (res.error) {
        toast.error('Assignment Failed', res.error.message);
      } else {
        toast.success('Publisher Assigned', 'Publisher has been assigned to this campaign.');
        setPubDialogOpen(false);
        setPubForm({ publisherId: '', payoutPerBillableCall: '', status: 'ACTIVE' });
        void fetchCampaignData();
      }
    } catch (err) {
      console.error('Failed to assign publisher:', err);
    } finally {
      setSubmittingPub(false);
    }
  };

  // Remove Publisher Assignment
  const handleRemovePublisher = async (assignmentId: string) => {
    if (!confirm('Are you sure you want to remove this publisher from the campaign?')) return;

    try {
      const res = await apiClient.delete(`/api/v1/campaigns/${id}/publishers/${assignmentId}`);
      if (res.error) {
        toast.error('Removal Failed', res.error.message);
      } else {
        toast.success('Publisher Removed', 'The publisher assignment was successfully removed.');
        void fetchCampaignData();
      }
    } catch (err) {
      console.error('Failed to remove publisher:', err);
    }
  };

  // Submit Buyer Assignment
  const handleAssignBuyer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!buyerForm.buyerId || !buyerForm.destinationNumber) return;

    // Basic E.164 regex check for PSTN
    const dest = buyerForm.destinationNumber.trim();
    if (!dest.startsWith('+')) {
      toast.error('Validation Error', 'Destination number must be in E.164 format (starting with +). e.g., +18652637582');
      return;
    }

    setSubmittingBuyer(true);
    try {
      const res = await apiClient.post(`/api/v1/campaigns/${id}/buyers`, {
        buyerId: buyerForm.buyerId,
        buyerEndpointId: buyerForm.buyerEndpointId || null,
        destinationNumber: dest,
        pricePerBillableCall: buyerForm.pricePerBillableCall ? Number(buyerForm.pricePerBillableCall) : null,
        priority: Number(buyerForm.priority) || 0,
        status: buyerForm.status,
      });

      if (res.error) {
        toast.error('Assignment Failed', res.error.message);
      } else {
        toast.success('Buyer Assigned', 'Buyer destination has been assigned to this campaign.');
        setBuyerDialogOpen(false);
        setBuyerForm({
          buyerId: '',
          buyerEndpointId: '',
          destinationNumber: '',
          pricePerBillableCall: '',
          priority: 0,
          status: 'ACTIVE',
        });
        void fetchCampaignData();
      }
    } catch (err) {
      console.error('Failed to assign buyer:', err);
    } finally {
      setSubmittingBuyer(false);
    }
  };

  // Remove Buyer Assignment
  const handleRemoveBuyer = async (assignmentId: string) => {
    if (!confirm('Are you sure you want to remove this buyer routing from the campaign?')) return;

    try {
      const res = await apiClient.delete(`/api/v1/campaigns/${id}/buyers/${assignmentId}`);
      if (res.error) {
        toast.error('Removal Failed', res.error.message);
      } else {
        toast.success('Buyer Removed', 'The buyer assignment was successfully removed.');
        void fetchCampaignData();
      }
    } catch (err) {
      console.error('Failed to remove buyer:', err);
    }
  };

  if (loading && !campaign) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-[300px] border border-dashed rounded-lg p-6 bg-muted/20">
        <ShieldAlert className="h-10 w-10 text-rose-500 mb-4" />
        <h3 className="text-lg font-medium">Campaign Not Found</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          This campaign does not exist or you do not have permission to view it.
        </p>
        <Button onClick={() => router.push('/campaigns')} variant="outline">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Campaigns
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <button 
            onClick={() => router.push('/campaigns')}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1 group"
          >
            <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-1" />
            Back to Campaigns
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight">{campaign.name}</h1>
            <Badge className={cn(
              campaign.status === 'ACTIVE' && 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20',
              campaign.status === 'PAUSED' && 'bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border-amber-500/20',
              campaign.status === 'ARCHIVED' && 'bg-slate-500/10 text-slate-400 hover:bg-slate-500/20 border-slate-500/20',
            )}>
              {campaign.status}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Offer: {campaign.offerName || '—'} | Region: {campaign.country}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={fetchCampaignData} 
            disabled={loading}
          >
            <RefreshCw className={cn("h-4 w-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => router.push(`/dashboard?campaignId=${campaign.id}`)}
          >
            <Eye className="h-4 w-4 mr-2" />
            View Reports
          </Button>
        </div>
      </div>

      {/* Tabs list */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid grid-cols-5 w-full max-w-2xl bg-muted/50 p-1">
          <TabsTrigger value="settings">Settings</TabsTrigger>
          <TabsTrigger value="publishers">Publishers</TabsTrigger>
          <TabsTrigger value="buyers">Buyers</TabsTrigger>
          <TabsTrigger value="numbers">Numbers (DIDs)</TabsTrigger>
          <TabsTrigger value="flow">Flow Builder</TabsTrigger>
        </TabsList>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <form onSubmit={handleSaveSettings} className="space-y-6">
            <Card className="border border-border">
              <CardHeader>
                <CardTitle>Basic Campaign Configuration</CardTitle>
                <CardDescription>
                  Configure campaign identifiers, status, and call recording behaviors.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="camp-name">Campaign Name</Label>
                  <Input 
                    id="camp-name"
                    value={settingsForm.name}
                    onChange={(e) => setSettingsForm({ ...settingsForm, name: e.target.value })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="camp-offer">Offer Name</Label>
                  <Input 
                    id="camp-offer"
                    placeholder="e.g. Health Insurance ACA"
                    value={settingsForm.offerName}
                    onChange={(e) => setSettingsForm({ ...settingsForm, offerName: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="camp-country">Country Code</Label>
                  <Select 
                    value={settingsForm.country} 
                    onValueChange={(val) => setSettingsForm({ ...settingsForm, country: val })}
                  >
                    <SelectTrigger id="camp-country">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="US">United States (US)</SelectItem>
                      <SelectItem value="CA">Canada (CA)</SelectItem>
                      <SelectItem value="GB">United Kingdom (GB)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="camp-status">Campaign Status</Label>
                  <Select 
                    value={settingsForm.status} 
                    onValueChange={(val: any) => setSettingsForm({ ...settingsForm, status: val })}
                  >
                    <SelectTrigger id="camp-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">Active (Routing Live)</SelectItem>
                      <SelectItem value="PAUSED">Paused (Temporary Stopped)</SelectItem>
                      <SelectItem value="ARCHIVED">Setup (Under Configuration)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between sm:col-span-2 py-3 border-t">
                  <div className="space-y-0.5">
                    <Label htmlFor="camp-recording">Enable Call Recording</Label>
                    <p className="text-xs text-muted-foreground">
                      Record all inbound calls handled by this campaign.
                    </p>
                  </div>
                  <Switch 
                    id="camp-recording"
                    checked={settingsForm.recordingEnabled}
                    onCheckedChange={(checked) => setSettingsForm({ ...settingsForm, recordingEnabled: checked })}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border border-border">
              <CardHeader>
                <CardTitle>Billable Call & Payout Configuration</CardTitle>
                <CardDescription>
                  Define the duration rules and default pricing rates for routing and financial reporting.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="camp-threshold">Billable Threshold (Seconds)</Label>
                  <Input 
                    id="camp-threshold"
                    type="number"
                    min={0}
                    value={settingsForm.billableDurationSeconds}
                    onChange={(e) => setSettingsForm({ ...settingsForm, billableDurationSeconds: parseInt(e.target.value) || 0 })}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Call must exceed this duration to be billable.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="camp-payout">Default Publisher Payout ($)</Label>
                  <Input 
                    id="camp-payout"
                    type="number"
                    step="0.0001"
                    min={0}
                    value={settingsForm.publisherPayoutPerBillableCall}
                    onChange={(e) => setSettingsForm({ ...settingsForm, publisherPayoutPerBillableCall: parseFloat(e.target.value) || 0 })}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Amount paid to publisher per billable call.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="camp-price">Default Buyer Price ($)</Label>
                  <Input 
                    id="camp-price"
                    type="number"
                    step="0.0001"
                    min={0}
                    value={settingsForm.buyerPricePerBillableCall}
                    onChange={(e) => setSettingsForm({ ...settingsForm, buyerPricePerBillableCall: parseFloat(e.target.value) || 0 })}
                    required
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Amount billed to buyer per billable call.
                  </p>
                </div>
              </CardContent>
              <CardFooter className="flex justify-end border-t px-6 py-4">
                <Button type="submit" disabled={savingSettings}>
                  {savingSettings ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving Settings...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Campaign Settings
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </form>
        </TabsContent>

        {/* Publishers Assignment Tab */}
        <TabsContent value="publishers" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Publisher Assignments</CardTitle>
                <CardDescription>
                  List of publishers authorized to send traffic to this campaign. Custom payouts override campaign defaults.
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setPubDialogOpen(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                Assign Publisher
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Publisher Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payout Rate</TableHead>
                    <TableHead>Assigned On</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignPublishers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                        No publishers assigned to this campaign yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    campaignPublishers.map((cp) => (
                      <TableRow key={cp.id}>
                        <TableCell>
                          <span className="font-semibold text-foreground">{cp.publisher.name}</span>
                          <span className="ml-2 text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {cp.publisher.code}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={cp.status === 'ACTIVE' ? 'outline' : 'secondary'} className={cn(
                            cp.status === 'ACTIVE' && 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
                            cp.status === 'INACTIVE' && 'text-muted-foreground'
                          )}>
                            {cp.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {cp.payoutPerBillableCall ? (
                            <span className="text-amber-400 font-medium">
                              ${Number(cp.payoutPerBillableCall).toFixed(2)} (Override)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              ${Number(campaign.publisherPayoutPerBillableCall).toFixed(2)} (Campaign Default)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(cp.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                            onClick={() => handleRemovePublisher(cp.id)}
                            title="Remove Publisher Assignment"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Buyers Assignment Tab */}
        <TabsContent value="buyers" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Buyer Routing & Assignments</CardTitle>
                <CardDescription>
                  Configure buyer target numbers and destination routing rules. Priority controls routing order (lower = higher priority).
                </CardDescription>
              </div>
              <Button size="sm" onClick={() => setBuyerDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add Buyer Destination
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Destination DID</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Price Rate</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignBuyers.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground text-sm">
                        No buyers or destination numbers assigned to this campaign yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    campaignBuyers.map((cb) => (
                      <TableRow key={cb.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">{cb.buyer.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {cb.buyerEndpoint?.name || 'Ad-Hoc Endpoint'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm font-semibold">
                          {cb.destinationNumber}
                        </TableCell>
                        <TableCell className="font-mono">
                          {cb.priority}
                        </TableCell>
                        <TableCell>
                          <Badge variant={cb.status === 'ACTIVE' ? 'outline' : 'secondary'} className={cn(
                            cb.status === 'ACTIVE' && 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5',
                            cb.status === 'INACTIVE' && 'text-muted-foreground'
                          )}>
                            {cb.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {cb.pricePerBillableCall ? (
                            <span className="text-amber-400 font-medium">
                              ${Number(cb.pricePerBillableCall).toFixed(2)} (Override)
                            </span>
                          ) : cb.buyerEndpoint?.basePrice ? (
                            <span className="text-muted-foreground">
                              ${Number(cb.buyerEndpoint.basePrice).toFixed(2)} (Endpoint Default)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              ${Number(campaign.buyerPricePerBillableCall).toFixed(2)} (Campaign Default)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-7 w-7 text-rose-500 hover:text-rose-400 hover:bg-rose-500/10"
                            onClick={() => handleRemoveBuyer(cb.id)}
                            title="Remove Buyer Assignment"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Numbers/DIDs Tab */}
        <TabsContent value="numbers" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Inbound Tracking Numbers</CardTitle>
              <CardDescription>
                Phone numbers (DIDs) configured to route calls to this campaign. Manage routes in the Inbound Numbers section.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Inbound DID</TableHead>
                    <TableHead>Destination/Default Routing</TableHead>
                    <TableHead>DID Label</TableHead>
                    <TableHead>Assigned On</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {didRoutes.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground text-sm">
                        No phone numbers currently routed to this campaign.
                      </TableCell>
                    </TableRow>
                  ) : (
                    didRoutes.map((route) => (
                      <TableRow key={route.id}>
                        <TableCell className="font-mono font-semibold text-primary">
                          {route.phoneNumber?.number || route.did}
                        </TableCell>
                        <TableCell className="font-mono text-sm text-muted-foreground">
                          {route.destination}
                        </TableCell>
                        <TableCell className="text-sm">
                          {route.label || '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(route.createdAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button 
                            variant="ghost" 
                            size="sm"
                            onClick={() => router.push('/numbers')}
                          >
                            Manage Routes
                            <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Flow Builder Mock Tab */}
        <TabsContent value="flow">
          <Card>
            <CardHeader>
              <CardTitle>Visual Flow Builder</CardTitle>
              <CardDescription>Drag and drop nodes to build your call flow routing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[500px] border-2 border-dashed rounded-lg flex items-center justify-center bg-muted/30">
                <div className="text-center">
                  <p className="text-lg font-semibold mb-2">Flow Canvas Placeholder</p>
                  <p className="text-sm text-muted-foreground">
                    Flow Builder visual programming blocks will render here in a future update.
                  </p>
                  <div className="mt-4 flex gap-2 justify-center">
                    <Badge variant="outline">Entry</Badge>
                    <Badge variant="outline">IVR Menu</Badge>
                    <Badge variant="outline">Queue Routing</Badge>
                    <Badge variant="outline">Buyer Forward</Badge>
                    <Badge variant="outline">Record Call</Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Assign Publisher Dialog */}
      <Dialog open={pubDialogOpen} onOpenChange={setPubDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <form onSubmit={handleAssignPublisher} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Assign Publisher to Campaign</DialogTitle>
              <DialogDescription>
                Assign a publisher to this campaign. You may optionally specify a payout rate override.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="pub-select">Select Publisher *</Label>
                <Select
                  value={pubForm.publisherId}
                  onValueChange={(val) => setPubForm({ ...pubForm, publisherId: val })}
                  required
                >
                  <SelectTrigger id="pub-select">
                    <SelectValue placeholder="Choose a publisher" />
                  </SelectTrigger>
                  <SelectContent>
                    {allPublishers.map((pub) => (
                      <SelectItem key={pub.id} value={pub.id}>
                        {pub.name} ({pub.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pub-override">Payout Override ($ per Billable Call)</Label>
                <Input
                  id="pub-override"
                  type="number"
                  step="0.0001"
                  min={0}
                  placeholder={`Default: $${Number(campaign.publisherPayoutPerBillableCall).toFixed(2)}`}
                  value={pubForm.payoutPerBillableCall}
                  onChange={(e) => setPubForm({ ...pubForm, payoutPerBillableCall: e.target.value })}
                />
                <p className="text-[10px] text-muted-foreground">
                  Leave blank to use the campaign default publisher payout rate.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pub-status">Assignment Status</Label>
                <Select
                  value={pubForm.status}
                  onValueChange={(val: any) => setPubForm({ ...pubForm, status: val })}
                >
                  <SelectTrigger id="pub-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active (Accepting Calls)</SelectItem>
                    <SelectItem value="INACTIVE">Inactive (Disabled)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setPubDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submittingPub || !pubForm.publisherId}>
                {submittingPub && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Assign Publisher
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Buyer Dialog */}
      <Dialog open={buyerDialogOpen} onOpenChange={setBuyerDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <form onSubmit={handleAssignBuyer} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add Buyer Routing Assignment</DialogTitle>
              <DialogDescription>
                Configure a destination phone number and routing rules for a buyer.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="buyer-select">Select Buyer *</Label>
                  <Select
                    value={buyerForm.buyerId}
                    onValueChange={(val) => setBuyerForm({ ...buyerForm, buyerId: val, buyerEndpointId: '' })}
                    required
                  >
                    <SelectTrigger id="buyer-select">
                      <SelectValue placeholder="Choose buyer" />
                    </SelectTrigger>
                    <SelectContent>
                      {allBuyers.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} ({b.code})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="endpoint-select">Buyer Endpoint (Optional)</Label>
                  <Select
                    value={buyerForm.buyerEndpointId}
                    onValueChange={handleEndpointChange}
                    disabled={!buyerForm.buyerId || loadingEndpoints}
                  >
                    <SelectTrigger id="endpoint-select">
                      <SelectValue placeholder={loadingEndpoints ? "Loading..." : "Choose endpoint"} />
                    </SelectTrigger>
                    <SelectContent>
                      {buyerEndpoints.map((ep) => (
                        <SelectItem key={ep.id} value={ep.id}>
                          {ep.name} (${Number(ep.basePrice).toFixed(2)})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="buyer-dest">Destination Phone Number (E.164 Format) *</Label>
                <Input
                  id="buyer-dest"
                  placeholder="e.g., +18652637582"
                  value={buyerForm.destinationNumber}
                  onChange={(e) => setBuyerForm({ ...buyerForm, destinationNumber: e.target.value })}
                  required
                />
                <p className="text-[10px] text-muted-foreground">
                  Must be formatted as a valid E.164 number starting with + and country code.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="buyer-priority">Priority (lower = higher priority)</Label>
                  <Input
                    id="buyer-priority"
                    type="number"
                    min={0}
                    value={buyerForm.priority}
                    onChange={(e) => setBuyerForm({ ...buyerForm, priority: parseInt(e.target.value) || 0 })}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="buyer-override">Price Override ($ per Billable Call)</Label>
                  <Input
                    id="buyer-override"
                    type="number"
                    step="0.0001"
                    min={0}
                    placeholder="Campaign Default"
                    value={buyerForm.pricePerBillableCall}
                    onChange={(e) => setBuyerForm({ ...buyerForm, pricePerBillableCall: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="buyer-status">Assignment Status</Label>
                <Select
                  value={buyerForm.status}
                  onValueChange={(val: any) => setBuyerForm({ ...buyerForm, status: val })}
                >
                  <SelectTrigger id="buyer-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active (Enabled)</SelectItem>
                    <SelectItem value="INACTIVE">Inactive (Disabled)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBuyerDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submittingBuyer || !buyerForm.buyerId || !buyerForm.destinationNumber}>
                {submittingBuyer && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Assignment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
