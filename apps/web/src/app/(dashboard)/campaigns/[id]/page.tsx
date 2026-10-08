'use client';

import {
  ArrowLeft,
  Edit,
  Eye,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  UserPlus,
  ShieldAlert,
  ArrowUpRight,
} from 'lucide-react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { AnswerOrderControl } from '@/components/campaigns/answer-order-control';
import { CampaignAgentsTab } from '@/components/campaigns/campaign-agents-tab';
import { CampaignBillingNotice } from '@/components/campaigns/campaign-billing-notice';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useWhiteLabelView } from '@/hooks/use-white-label-view';
import { answerOrderOf } from '@/lib/answer-order';
import { apiClient } from '@/lib/api';
import {
  clampRingSeconds,
  DEFAULT_AGENT_RING_SECONDS,
  DEFAULT_BUYER_RING_SECONDS,
  MAX_RING_SECONDS,
  MIN_RING_SECONDS,
  ringTimesOf,
} from '@/lib/ring-times';
import { cn } from '@/lib/utils';

/** The tabs a campaign has; which of them a viewer sees depends on who they are. */
const CAMPAIGN_TABS = ['settings', 'agents', 'publishers', 'buyers', 'numbers', 'flow'] as const;
type CampaignTab = (typeof CAMPAIGN_TABS)[number];

/**
 * The tab `?tab=` asks for, when this viewer can see it; otherwise Settings.
 * A link to `?tab=buyers` opens Buyers, and a link to a tab this viewer does
 * not have opens where everybody starts rather than on nothing.
 */
function initialCampaignTab(
  requested: string | null,
  visible: { canManage: boolean; canBuildFlows: boolean }
): CampaignTab {
  const tab = CAMPAIGN_TABS.find(key => key === requested);
  if (!tab) return 'settings';
  if ((tab === 'agents' || tab === 'numbers') && !visible.canManage) return 'settings';
  if (tab === 'flow' && !visible.canBuildFlows) return 'settings';
  return tab;
}

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
  type?: 'SIP' | 'PSTN' | 'WEBRTC';
  destination: string;
  basePrice: string;
}

interface CampaignPublisher {
  id: string;
  publisherId: string;
  publisher: Publisher;
  payoutPerBillableCall: string | null;
  payoutPerApplication: string | null;
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
  pricePerApplication: string | null;
  priority: number;
  weight: number;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
}

interface DidRoute {
  id: string;
  campaignId?: string | null;
  did: string;
  destination: string;
  label: string | null;
  createdAt: string;
  phoneNumber: {
    number: string;
    provider: string;
  };
}

/** How a campaign charges its buyers and pays its publishers. Exclusive. */
type BillingModel = 'PER_CALL' | 'PER_APPLICATION';

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
  billingModel: BillingModel;
  buyerPricePerApplication: string;
  publisherPayoutPerApplication: string;
  calls: number;
  phoneNumbers: number;
  /** Free-form settings. `answerOrder` is "who answers first"; see lib/answer-order. */
  metadata?: Record<string, unknown> | null;
}

export default function CampaignDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = params.id as string;

  /*
   * A white-label owner reaches a campaign from Routing, where Campaigns is a
   * tab; /campaigns itself redirects them there. "Back" says where it goes.
   */
  const whiteLabelView = useWhiteLabelView();
  const backHref = whiteLabelView ? '/routing' : '/campaigns';
  const backLabel = whiteLabelView ? 'Back to Routing' : 'Back to Campaigns';

  /*
   * Staff manage a campaign; an agency principal reads its own, view-only.
   *
   * Every campaign write is refused to non-staff on the API (STAFF_ONLY_AREAS),
   * so for them the settings form is disabled and every control that would
   * only answer 403 -- assign, edit and remove a publisher or buyer, the
   * buyer-target form -- is not drawn. DID routes are a staff-only area
   * outright (`/api/v1/did-routes`), so the Numbers tab is neither requested
   * nor rendered: an owner sees no section rather than an error. The flow
   * builder is the same -- flows are platform configuration.
   *
   * The dashboard layout does not render this page until the platform context
   * has settled, so `isPlatformAdmin` is already the answer on first render.
   *
   * A white-label agency's OWNER and ADMIN manage their own campaigns exactly
   * as staff do -- settings, assignments, the buyer-target form and the
   * Numbers tab, whose DID routes the API opens to them. The flow builder is
   * still staff's alone: flows stay platform configuration for everybody.
   */
  const { isPlatformAdmin, isWhiteLabel, isChild, hasFullAccess } = useAuth();
  const canManage = isPlatformAdmin || isWhiteLabel;
  // A downline (child) agency's OWNER and ADMIN may write their own campaigns'
  // settings. Assignments and DID routes are not opened to them, so only the
  // settings form is.
  const canEditSettings = canManage || (isChild && hasFullAccess);
  const canBuildFlows = isPlatformAdmin;

  const [loading, setLoading] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<string>(() =>
    initialCampaignTab(searchParams?.get('tab') ?? null, { canManage, canBuildFlows })
  );

  // The URL follows the tab, so a reload or a shared link lands on it.
  const changeTab = useCallback(
    (tab: string) => {
      setActiveTab(tab);
      router.replace(`/campaigns/${encodeURIComponent(id)}?tab=${tab}`, { scroll: false });
    },
    [id, router]
  );

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
    billingModel: 'PER_CALL' as BillingModel,
    buyerPricePerApplication: 0,
    publisherPayoutPerApplication: 0,
    agentRingSeconds: DEFAULT_AGENT_RING_SECONDS,
    buyerRingSeconds: DEFAULT_BUYER_RING_SECONDS,
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
  const [editingBuyerId, setEditingBuyerId] = useState<string | null>(null);
  const [loadingEndpoints, setLoadingEndpoints] = useState(false);

  // Dialog Form States
  const [pubForm, setPubForm] = useState({
    publisherId: '',
    payoutPerBillableCall: '',
    payoutPerApplication: '',
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  const [buyerForm, setBuyerForm] = useState({
    buyerId: '',
    buyerEndpointId: '',
    destinationNumber: '',
    pricePerBillableCall: '',
    pricePerApplication: '',
    priority: 0,
    weight: 100,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  // Action states
  const [submittingPub, setSubmittingPub] = useState(false);
  const [submittingBuyer, setSubmittingBuyer] = useState(false);

  const handleOpenBuyerDialog = (open: boolean) => {
    setBuyerDialogOpen(open);
    if (!open) {
      setEditingBuyerId(null);
      setBuyerForm({
        buyerId: '',
        buyerEndpointId: '',
        destinationNumber: '',
        pricePerBillableCall: '',
        pricePerApplication: '',
        priority: 0,
        weight: 100,
        status: 'ACTIVE',
      });
    }
  };

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
          billingModel: response.data.billingModel ?? 'PER_CALL',
          buyerPricePerApplication: Number(response.data.buyerPricePerApplication ?? 0),
          publisherPayoutPerApplication: Number(response.data.publisherPayoutPerApplication ?? 0),
          ...ringTimesOf(response.data.metadata),
        });
      }

      // Fetch Publisher assignments
      const pubRes = await apiClient.get<{ data: CampaignPublisher[] }>(
        `/api/v1/campaigns/${id}/publishers`
      );
      if (pubRes.data?.data) {
        setCampaignPublishers(pubRes.data.data);
      }

      // Fetch Buyer assignments
      const buyerRes = await apiClient.get<{ data: CampaignBuyer[] }>(
        `/api/v1/campaigns/${id}/buyers`
      );
      if (buyerRes.data?.data) {
        setCampaignBuyers(buyerRes.data.data);
      }

      // Fetch DID routes and filter by campaign. Staff only: the endpoint is.
      if (canManage) {
        const didRes = await apiClient.get<{ routes: DidRoute[] }>('/api/v1/did-routes');
        if (didRes.data?.routes) {
          const filtered = didRes.data.routes.filter(route => route.campaignId === id);
          setDidRoutes(filtered);
        }
      }
    } catch (err) {
      console.error('Failed to load campaign data:', err);
      toast({
        title: 'Error',
        description: 'Failed to retrieve campaign details.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [id, canManage]);

  // Load dropdown lists (Publishers & Buyers). Only the assignment dialogs
  // read them, and only staff get those dialogs.
  const fetchDropdowns = useCallback(async () => {
    if (!canManage) return;
    try {
      const pubRes = await apiClient.get<{ data: Publisher[] }>('/api/v1/publishers?limit=100');
      if (pubRes.data) setAllPublishers(pubRes.data.data);

      const buyerRes = await apiClient.get<{ data: Buyer[] }>('/api/v1/buyers?limit=100');
      if (buyerRes.data) setAllBuyers(buyerRes.data.data);
    } catch (err) {
      console.error('Failed to load dropdown lists:', err);
    }
  }, [canManage]);

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
          `/api/v1/buyers/${buyerForm.buyerId}/targets`
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
      destinationNumber: ep ? ep.destination : prev.destinationNumber,
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
        billingModel: settingsForm.billingModel,
        buyerPricePerApplication: Number(settingsForm.buyerPricePerApplication),
        publisherPayoutPerApplication: Number(settingsForm.publisherPayoutPerApplication),
        // Merged into campaign.metadata by the API; the routing engine reads
        // both, with the same defaults and 10-120 second bounds.
        metadata: {
          agentRingSeconds: clampRingSeconds(
            settingsForm.agentRingSeconds,
            DEFAULT_AGENT_RING_SECONDS
          ),
          buyerRingSeconds: clampRingSeconds(
            settingsForm.buyerRingSeconds,
            DEFAULT_BUYER_RING_SECONDS
          ),
        },
      });

      if (res.error) {
        toast({
          title: 'Save Failed',
          description: res.error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Settings Saved',
          description: 'Campaign settings have been successfully updated.',
          variant: 'success',
        });
        void fetchCampaignData();
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
      toast({
        title: 'Error',
        description: 'An unexpected error occurred while saving.',
        variant: 'destructive',
      });
    } finally {
      setSavingSettings(false);
    }
  };

  // Submit Publisher Assignment. The API emails the publisher and says whether it went.
  type AssignResult = { emailed?: boolean; hasEmail?: boolean };
  const handleAssignPublisher = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pubForm.publisherId) return;

    setSubmittingPub(true);
    try {
      const res = await apiClient.post<AssignResult>(`/api/v1/campaigns/${id}/publishers`, {
        publisherId: pubForm.publisherId,
        payoutPerBillableCall: pubForm.payoutPerBillableCall
          ? Number(pubForm.payoutPerBillableCall)
          : null,
        payoutPerApplication: pubForm.payoutPerApplication
          ? Number(pubForm.payoutPerApplication)
          : null,
        status: pubForm.status,
      });

      if (res.error) {
        toast({
          title: 'Assignment Failed',
          description: res.error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Publisher Assigned',
          description: res.data?.emailed
            ? 'Publisher has been assigned to this campaign and emailed.'
            : res.data?.hasEmail
              ? 'Publisher has been assigned, but the email could not be sent.'
              : 'Publisher has been assigned. They have no email on file, so none was sent.',
          variant: 'success',
        });
        setPubDialogOpen(false);
        setPubForm({
          publisherId: '',
          payoutPerBillableCall: '',
          payoutPerApplication: '',
          status: 'ACTIVE',
        });
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
        toast({
          title: 'Removal Failed',
          description: res.error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Publisher Removed',
          description: 'The publisher assignment was successfully removed.',
          variant: 'success',
        });
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

    // Determine if this is a PSTN destination (requires E.164 formatting)
    let isPstn = true;
    if (buyerForm.buyerEndpointId) {
      const ep = buyerEndpoints.find(el => el.id === buyerForm.buyerEndpointId);
      if (ep && (ep.type === 'SIP' || ep.type === 'WEBRTC')) {
        isPstn = false;
      }
    }
    // Allow short internal extensions (e.g. 4 digits) or UUIDs without requiring +
    if (
      /^\d{4}$/.test(dest) ||
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(dest)
    ) {
      isPstn = false;
    }

    if (isPstn && !dest.startsWith('+')) {
      toast({
        title: 'Validation Error',
        description:
          'Destination number must be in E.164 format (starting with +). e.g., +18652637582',
        variant: 'destructive',
      });
      return;
    }

    setSubmittingBuyer(true);
    try {
      let res;
      if (editingBuyerId) {
        res = await apiClient.patch(`/api/v1/campaigns/${id}/buyers/${editingBuyerId}`, {
          buyerEndpointId: buyerForm.buyerEndpointId || null,
          destinationNumber: dest,
          pricePerBillableCall: buyerForm.pricePerBillableCall
            ? Number(buyerForm.pricePerBillableCall)
            : null,
          pricePerApplication: buyerForm.pricePerApplication
            ? Number(buyerForm.pricePerApplication)
            : null,
          priority: Number(buyerForm.priority) || 0,
          weight: Number(buyerForm.weight) || 100,
          status: buyerForm.status,
        });
      } else {
        res = await apiClient.post(`/api/v1/campaigns/${id}/buyers`, {
          buyerId: buyerForm.buyerId,
          buyerEndpointId: buyerForm.buyerEndpointId || null,
          destinationNumber: dest,
          pricePerBillableCall: buyerForm.pricePerBillableCall
            ? Number(buyerForm.pricePerBillableCall)
            : null,
          pricePerApplication: buyerForm.pricePerApplication
            ? Number(buyerForm.pricePerApplication)
            : null,
          priority: Number(buyerForm.priority) || 0,
          weight: Number(buyerForm.weight) || 100,
          status: buyerForm.status,
        });
      }

      if (res.error) {
        toast({
          title: editingBuyerId ? 'Update Failed' : 'Assignment Failed',
          description: res.error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: editingBuyerId ? 'Buyer Updated' : 'Buyer Assigned',
          description: editingBuyerId
            ? 'Buyer routing configuration has been updated.'
            : 'Buyer destination has been assigned to this campaign.',
          variant: 'success',
        });
        handleOpenBuyerDialog(false);
        void fetchCampaignData();
      }
    } catch (err) {
      console.error('Failed to save buyer assignment:', err);
    } finally {
      setSubmittingBuyer(false);
    }
  };

  const handleEditBuyerClick = (cb: CampaignBuyer) => {
    setEditingBuyerId(cb.id);
    setBuyerForm({
      buyerId: cb.buyerId,
      buyerEndpointId: cb.buyerEndpointId || '',
      destinationNumber: cb.destinationNumber,
      pricePerBillableCall: cb.pricePerBillableCall ? String(cb.pricePerBillableCall) : '',
      pricePerApplication: cb.pricePerApplication ? String(cb.pricePerApplication) : '',
      priority: cb.priority,
      weight: cb.weight || 100,
      status: cb.status,
    });
    setBuyerDialogOpen(true);
  };

  // Remove Buyer Assignment
  const handleRemoveBuyer = async (assignmentId: string) => {
    if (!confirm('Are you sure you want to remove this buyer routing from the campaign?')) return;

    try {
      const res = await apiClient.delete(`/api/v1/campaigns/${id}/buyers/${assignmentId}`);
      if (res.error) {
        toast({
          title: 'Removal Failed',
          description: res.error.message,
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Buyer Removed',
          description: 'The buyer assignment was successfully removed.',
          variant: 'success',
        });
        void fetchCampaignData();
      }
    } catch (err) {
      console.error('Failed to remove buyer:', err);
    }
  };

  if (loading && !campaign) {
    return (
      <div className="page-canvas">
        <div className="flex h-[400px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="page-canvas">
        <div className="flex flex-col items-center justify-center h-[300px] border border-dashed rounded-lg p-6 bg-sunken">
          <ShieldAlert className="h-10 w-10 text-dropped-ink mb-4" />
          <h3 className="text-lg font-medium">Campaign Not Found</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            This campaign does not exist or you do not have permission to view it.
          </p>
          <Button onClick={() => router.push(backHref)} variant="outline">
            <ArrowLeft className="mr-2 h-4 w-4" /> {backLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-canvas">
      {/* The campaign's name is the page's title, in the topbar; the way back,
          its status, offer and region sit under it, its actions at the right. */}
      <PageHeader
        title={campaign.name}
        description={
          <span className="inline-flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push(backHref)}
              className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink"
            >
              <ArrowLeft aria-hidden className="h-3.5 w-3.5" />
              {backLabel}
            </button>
            <span aria-hidden className="text-ink-3">
              ·
            </span>
            <Badge
              className={cn(
                'px-1.5 py-0 text-[11px]',
                campaign.status === 'ACTIVE' &&
                  'bg-live-tint text-live-ink hover:bg-live-tint border-transparent',
                campaign.status === 'PAUSED' &&
                  'bg-ringing-tint text-ringing-ink hover:bg-ringing-tint border-transparent',
                campaign.status === 'ARCHIVED' &&
                  'bg-sunken text-ink-2 hover:bg-sunken border-transparent'
              )}
            >
              {campaign.status}
            </Badge>
            <span aria-hidden className="text-ink-3">
              ·
            </span>
            <span>
              Offer: {campaign.offerName || '—'} · Region: {campaign.country}
            </span>
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void fetchCampaignData()}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4 mr-2', loading && 'animate-spin')} />
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
          </>
        }
      />

      {/* Tabs list */}
      <Tabs value={activeTab} onValueChange={changeTab} className="space-y-6">
        <TabsList
          className={cn(
            // A row that scrolls on a phone, a grid from 768px: five or six
            // labels do not fit a 390px screen side by side.
            'w-full bg-sunken p-1 md:grid',
            canBuildFlows
              ? 'md:max-w-3xl md:grid-cols-6'
              : canManage
                ? 'md:max-w-2xl md:grid-cols-5'
                : 'grid max-w-md grid-cols-3'
          )}
        >
          <TabsTrigger value="settings">Settings</TabsTrigger>
          {canManage ? <TabsTrigger value="agents">Your agents</TabsTrigger> : null}
          <TabsTrigger value="publishers">Publishers</TabsTrigger>
          <TabsTrigger value="buyers">Buyers</TabsTrigger>
          {canManage ? <TabsTrigger value="numbers">Numbers (DIDs)</TabsTrigger> : null}
          {canBuildFlows ? <TabsTrigger value="flow">Flow Builder</TabsTrigger> : null}
        </TabsList>

        {/* Settings Tab */}
        <TabsContent value="settings">
          <form onSubmit={e => void handleSaveSettings(e)} className="space-y-6">
            {/* A disabled fieldset makes every control inside it read-only. */}
            <fieldset disabled={!canEditSettings} className="space-y-6">
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
                      onChange={e => setSettingsForm({ ...settingsForm, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="camp-offer">Offer Name</Label>
                    <Input
                      id="camp-offer"
                      placeholder="e.g. Health Insurance ACA"
                      value={settingsForm.offerName}
                      onChange={e =>
                        setSettingsForm({ ...settingsForm, offerName: e.target.value })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="camp-country">Country Code</Label>
                    <Select
                      value={settingsForm.country}
                      onValueChange={val => setSettingsForm({ ...settingsForm, country: val })}
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
                      onValueChange={(val: string) =>
                        setSettingsForm({
                          ...settingsForm,
                          status: val as typeof settingsForm.status,
                        })
                      }
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
                      onCheckedChange={checked =>
                        setSettingsForm({ ...settingsForm, recordingEnabled: checked })
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border">
                <CardHeader>
                  <CardTitle>Ring Times</CardTitle>
                  <CardDescription>
                    How long each call rings before routing moves on to the next answerer.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="camp-agent-ring">Agent ring time (seconds)</Label>
                    <Input
                      id="camp-agent-ring"
                      type="number"
                      step={1}
                      min={MIN_RING_SECONDS}
                      max={MAX_RING_SECONDS}
                      value={settingsForm.agentRingSeconds}
                      onChange={e =>
                        setSettingsForm({
                          ...settingsForm,
                          agentRingSeconds: parseInt(e.target.value) || 0,
                        })
                      }
                      required
                    />
                    <p className="text-[11px] text-muted-foreground">
                      How long a call rings your agents before moving on. Between {MIN_RING_SECONDS}{' '}
                      and {MAX_RING_SECONDS}; defaults to {DEFAULT_AGENT_RING_SECONDS}.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="camp-buyer-ring">Buyer ring time (seconds)</Label>
                    <Input
                      id="camp-buyer-ring"
                      type="number"
                      step={1}
                      min={MIN_RING_SECONDS}
                      max={MAX_RING_SECONDS}
                      value={settingsForm.buyerRingSeconds}
                      onChange={e =>
                        setSettingsForm({
                          ...settingsForm,
                          buyerRingSeconds: parseInt(e.target.value) || 0,
                        })
                      }
                      required
                    />
                    <p className="text-[11px] text-muted-foreground">
                      How long a call rings a buyer before moving on. Between {MIN_RING_SECONDS} and{' '}
                      {MAX_RING_SECONDS}; defaults to {DEFAULT_BUYER_RING_SECONDS}.
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-border">
                <CardHeader>
                  <CardTitle>Billing &amp; Payout Configuration</CardTitle>
                  <CardDescription>
                    Choose whether this campaign charges its buyers and pays its publishers per
                    billable call or per submitted application, and set the default rates.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <CampaignBillingNotice billingModel={settingsForm.billingModel} />

                  <div className="max-w-sm space-y-2">
                    <Label htmlFor="camp-billing-model">Billing Model</Label>
                    <Select
                      value={settingsForm.billingModel}
                      onValueChange={val =>
                        setSettingsForm({ ...settingsForm, billingModel: val as BillingModel })
                      }
                    >
                      <SelectTrigger id="camp-billing-model">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="PER_CALL">Per billable call</SelectItem>
                        <SelectItem value="PER_APPLICATION">Per submitted application</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      {settingsForm.billingModel === 'PER_APPLICATION'
                        ? 'A call is charged and paid only when an agent submits an application on it, once per application. Call duration does not matter.'
                        : 'A call is charged and paid when it runs past the billable threshold.'}
                    </p>
                  </div>

                  {settingsForm.billingModel === 'PER_APPLICATION' ? (
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="camp-app-payout">
                          Default Publisher Payout per Application ($)
                        </Label>
                        <Input
                          id="camp-app-payout"
                          type="number"
                          step="0.0001"
                          min={0}
                          value={settingsForm.publisherPayoutPerApplication}
                          onChange={e =>
                            setSettingsForm({
                              ...settingsForm,
                              publisherPayoutPerApplication: parseFloat(e.target.value) || 0,
                            })
                          }
                          required
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Amount paid to the publisher per submitted application.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="camp-app-price">
                          Default Buyer Price per Application ($)
                        </Label>
                        <Input
                          id="camp-app-price"
                          type="number"
                          step="0.0001"
                          min={0}
                          value={settingsForm.buyerPricePerApplication}
                          onChange={e =>
                            setSettingsForm({
                              ...settingsForm,
                              buyerPricePerApplication: parseFloat(e.target.value) || 0,
                            })
                          }
                          required
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Amount billed to the buyer per submitted application.
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-6 sm:grid-cols-3">
                      <div className="space-y-2">
                        <Label htmlFor="camp-threshold">Billable Threshold (Seconds)</Label>
                        <Input
                          id="camp-threshold"
                          type="number"
                          min={0}
                          value={settingsForm.billableDurationSeconds}
                          onChange={e =>
                            setSettingsForm({
                              ...settingsForm,
                              billableDurationSeconds: parseInt(e.target.value) || 0,
                            })
                          }
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
                          onChange={e =>
                            setSettingsForm({
                              ...settingsForm,
                              publisherPayoutPerBillableCall: parseFloat(e.target.value) || 0,
                            })
                          }
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
                          onChange={e =>
                            setSettingsForm({
                              ...settingsForm,
                              buyerPricePerBillableCall: parseFloat(e.target.value) || 0,
                            })
                          }
                          required
                        />
                        <p className="text-[11px] text-muted-foreground">
                          Amount billed to buyer per billable call.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
                {canEditSettings ? (
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
                ) : null}
              </Card>
            </fieldset>
          </form>
        </TabsContent>

        {/* Publishers Assignment Tab */}
        <TabsContent value="publishers" className="space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Publisher Assignments</CardTitle>
                <CardDescription>
                  List of publishers authorized to send traffic to this campaign. Custom payouts
                  override campaign defaults.
                </CardDescription>
              </div>
              {canManage ? (
                <Button size="sm" onClick={() => setPubDialogOpen(true)}>
                  <UserPlus className="h-4 w-4 mr-2" />
                  Assign Publisher
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Publisher Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payout Rate</TableHead>
                    <TableHead>Assigned On</TableHead>
                    {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignPublishers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canManage ? 5 : 4}
                        className="text-center py-8 text-muted-foreground text-sm"
                      >
                        No publishers assigned to this campaign yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    campaignPublishers.map(cp => (
                      <TableRow key={cp.id}>
                        <TableCell>
                          <span className="font-semibold text-foreground">
                            {cp.publisher?.name || 'Unknown'}
                          </span>
                          <span className="ml-2 text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {cp.publisher?.code || '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={cp.status === 'ACTIVE' ? 'outline' : 'secondary'}
                            className={cn(
                              cp.status === 'ACTIVE' && 'text-live-ink bg-live-tint',
                              cp.status === 'INACTIVE' && 'text-muted-foreground'
                            )}
                          >
                            {cp.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {campaign.billingModel === 'PER_APPLICATION' ? (
                            cp.payoutPerApplication ? (
                              <span className="text-ringing-ink font-medium">
                                ${Number(cp.payoutPerApplication).toFixed(2)} / app (Override)
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                ${Number(campaign.publisherPayoutPerApplication).toFixed(2)} / app
                                (Campaign Default)
                              </span>
                            )
                          ) : cp.payoutPerBillableCall ? (
                            <span className="text-ringing-ink font-medium">
                              ${Number(cp.payoutPerBillableCall).toFixed(2)} (Override)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              ${Number(campaign.publisherPayoutPerBillableCall).toFixed(2)}{' '}
                              (Campaign Default)
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(cp.createdAt).toLocaleDateString()}
                        </TableCell>
                        {canManage ? (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-dropped-ink hover:opacity-80 hover:bg-dropped-tint"
                              onClick={() => void handleRemovePublisher(cp.id)}
                              title="Remove Publisher Assignment"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* The agency's own agents on this campaign. */}
        {canManage ? (
          <TabsContent value="agents" className="space-y-6">
            <CampaignAgentsTab campaignId={campaign.id} canManage={canManage} />
          </TabsContent>
        ) : null}

        {/* Buyers Assignment Tab */}
        <TabsContent value="buyers" className="space-y-6">
          {canManage ? (
            <AnswerOrderControl
              campaignId={campaign.id}
              value={answerOrderOf(campaign.metadata)}
              onChanged={() => void fetchCampaignData()}
            />
          ) : null}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle>Buyer Routing & Assignments</CardTitle>
                <CardDescription>
                  Configure buyer target numbers and destination routing rules. Priority controls
                  routing order (lower = higher priority).
                </CardDescription>
              </div>
              {canManage ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingBuyerId(null);
                    setBuyerDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Add Buyer Destination
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Buyer</TableHead>
                    <TableHead>Destination DID</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Weight</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Price Rate</TableHead>
                    {canManage ? <TableHead className="text-right">Actions</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaignBuyers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={canManage ? 7 : 6}
                        className="text-center py-8 text-muted-foreground text-sm"
                      >
                        No buyers or destination numbers assigned to this campaign yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    campaignBuyers.map(cb => (
                      <TableRow key={cb.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="font-semibold text-foreground">
                              {cb.buyer?.name || 'Unknown'}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {cb.buyerEndpoint?.name || 'Ad-Hoc Endpoint'}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm font-semibold">
                          {cb.destinationNumber}
                        </TableCell>
                        <TableCell className="font-mono">{cb.priority}</TableCell>
                        <TableCell className="font-mono">{cb.weight || 100}</TableCell>
                        <TableCell>
                          <Badge
                            variant={cb.status === 'ACTIVE' ? 'outline' : 'secondary'}
                            className={cn(
                              cb.status === 'ACTIVE' && 'text-live-ink bg-live-tint',
                              cb.status === 'INACTIVE' && 'text-muted-foreground'
                            )}
                          >
                            {cb.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {campaign.billingModel === 'PER_APPLICATION' ? (
                            cb.pricePerApplication ? (
                              <span className="text-ringing-ink font-medium">
                                ${Number(cb.pricePerApplication).toFixed(2)} / app (Override)
                              </span>
                            ) : (
                              <span className="text-muted-foreground">
                                ${Number(campaign.buyerPricePerApplication).toFixed(2)} / app
                                (Campaign Default)
                              </span>
                            )
                          ) : cb.pricePerBillableCall ? (
                            <span className="text-ringing-ink font-medium">
                              ${Number(cb.pricePerBillableCall).toFixed(2)} (Override)
                            </span>
                          ) : cb.buyerEndpoint?.basePrice ? (
                            <span className="text-muted-foreground">
                              ${Number(cb.buyerEndpoint.basePrice).toFixed(2)} (Endpoint Default)
                            </span>
                          ) : (
                            <span className="text-muted-foreground">
                              ${Number(campaign.buyerPricePerBillableCall).toFixed(2)} (Campaign
                              Default)
                            </span>
                          )}
                        </TableCell>
                        {canManage ? (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground hover:bg-muted mr-1"
                              onClick={() => handleEditBuyerClick(cb)}
                              title="Edit Buyer Assignment"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-dropped-ink hover:opacity-80 hover:bg-dropped-tint"
                              onClick={() => void handleRemoveBuyer(cb.id)}
                              title="Remove Buyer Assignment"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Numbers/DIDs Tab. Staff only -- see `canManage`. */}
        {canManage ? (
          <TabsContent value="numbers" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Inbound Tracking Numbers</CardTitle>
                <CardDescription>
                  Phone numbers (DIDs) configured to route calls to this campaign. Manage routes in
                  the Inbound Numbers section.
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
                        <TableCell
                          colSpan={5}
                          className="text-center py-8 text-muted-foreground text-sm"
                        >
                          No phone numbers currently routed to this campaign.
                        </TableCell>
                      </TableRow>
                    ) : (
                      didRoutes.map(route => (
                        <TableRow key={route.id}>
                          <TableCell className="font-mono font-semibold text-primary">
                            {route.phoneNumber?.number || route.did}
                          </TableCell>
                          <TableCell className="font-mono text-sm text-muted-foreground">
                            {route.destination}
                          </TableCell>
                          <TableCell className="text-sm">{route.label || '—'}</TableCell>
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
        ) : null}

        {/* Flow Builder Mock Tab. Staff only -- see `canBuildFlows`. */}
        {canBuildFlows ? (
          <TabsContent value="flow">
            <Card>
              <CardHeader>
                <CardTitle>Visual Flow Builder</CardTitle>
                <CardDescription>
                  Drag and drop nodes to build your call flow routing
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="h-[500px] border-2 border-dashed rounded-lg flex items-center justify-center bg-sunken">
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
        ) : null}
      </Tabs>

      {/* The assignment dialogs, including the buyer-target form. Staff only. */}
      {canManage ? (
        <>
          {/* Assign Publisher Dialog */}
          <Dialog open={pubDialogOpen} onOpenChange={setPubDialogOpen}>
            <DialogContent className="sm:max-w-[425px]">
              <form onSubmit={e => void handleAssignPublisher(e)} className="space-y-4">
                <DialogHeader>
                  <DialogTitle>Assign Publisher to Campaign</DialogTitle>
                  <DialogDescription>
                    Assign a publisher to this campaign. You may optionally specify a payout rate
                    override.
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label htmlFor="pub-select">Select Publisher *</Label>
                    <Select
                      value={pubForm.publisherId}
                      onValueChange={val => setPubForm({ ...pubForm, publisherId: val })}
                      required
                    >
                      <SelectTrigger id="pub-select">
                        <SelectValue placeholder="Choose a publisher" />
                      </SelectTrigger>
                      <SelectContent>
                        {allPublishers.map(pub => (
                          <SelectItem key={pub.id} value={pub.id}>
                            {pub.name} ({pub.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {campaign.billingModel === 'PER_APPLICATION' ? (
                    <div className="space-y-2">
                      <Label htmlFor="pub-app-override">
                        Payout Override ($ per Submitted Application)
                      </Label>
                      <Input
                        id="pub-app-override"
                        type="number"
                        step="0.0001"
                        min={0}
                        placeholder={`Default: $${Number(campaign.publisherPayoutPerApplication).toFixed(2)}`}
                        value={pubForm.payoutPerApplication}
                        onChange={e =>
                          setPubForm({ ...pubForm, payoutPerApplication: e.target.value })
                        }
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Leave blank to use the campaign default payout per application.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="pub-override">Payout Override ($ per Billable Call)</Label>
                      <Input
                        id="pub-override"
                        type="number"
                        step="0.0001"
                        min={0}
                        placeholder={`Default: $${Number(campaign.publisherPayoutPerBillableCall).toFixed(2)}`}
                        value={pubForm.payoutPerBillableCall}
                        onChange={e =>
                          setPubForm({ ...pubForm, payoutPerBillableCall: e.target.value })
                        }
                      />
                      <p className="text-[10px] text-muted-foreground">
                        Leave blank to use the campaign default publisher payout rate.
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="pub-status">Assignment Status</Label>
                    <Select
                      value={pubForm.status}
                      onValueChange={(val: string) =>
                        setPubForm({ ...pubForm, status: val as typeof pubForm.status })
                      }
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
          <Dialog open={buyerDialogOpen} onOpenChange={handleOpenBuyerDialog}>
            <DialogContent className="sm:max-w-[500px]">
              <form onSubmit={e => void handleAssignBuyer(e)} className="space-y-4">
                <DialogHeader>
                  <DialogTitle>
                    {editingBuyerId
                      ? 'Edit Buyer Routing Assignment'
                      : 'Add Buyer Routing Assignment'}
                  </DialogTitle>
                  <DialogDescription>
                    {editingBuyerId
                      ? 'Modify destination phone number and routing rules for this buyer.'
                      : 'Configure a destination phone number and routing rules for a buyer.'}
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="buyer-select">Select Buyer *</Label>
                      <Select
                        value={buyerForm.buyerId}
                        onValueChange={val =>
                          setBuyerForm({ ...buyerForm, buyerId: val, buyerEndpointId: '' })
                        }
                        required
                        disabled={editingBuyerId !== null}
                      >
                        <SelectTrigger id="buyer-select">
                          <SelectValue placeholder="Choose buyer" />
                        </SelectTrigger>
                        <SelectContent>
                          {allBuyers.map(b => (
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
                        disabled={(!buyerForm.buyerId && !editingBuyerId) || loadingEndpoints}
                      >
                        <SelectTrigger id="endpoint-select">
                          <SelectValue
                            placeholder={loadingEndpoints ? 'Loading...' : 'Choose endpoint'}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {buyerEndpoints.map(ep => (
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
                      onChange={e =>
                        setBuyerForm({ ...buyerForm, destinationNumber: e.target.value })
                      }
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
                        onChange={e =>
                          setBuyerForm({ ...buyerForm, priority: parseInt(e.target.value) || 0 })
                        }
                        required
                      />
                    </div>

                    {campaign.billingModel === 'PER_APPLICATION' ? (
                      <div className="space-y-2">
                        <Label htmlFor="buyer-app-override">
                          Price Override ($ per Submitted Application)
                        </Label>
                        <Input
                          id="buyer-app-override"
                          type="number"
                          step="0.0001"
                          min={0}
                          placeholder="Campaign Default"
                          value={buyerForm.pricePerApplication}
                          onChange={e =>
                            setBuyerForm({ ...buyerForm, pricePerApplication: e.target.value })
                          }
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <Label htmlFor="buyer-override">Price Override ($ per Billable Call)</Label>
                        <Input
                          id="buyer-override"
                          type="number"
                          step="0.0001"
                          min={0}
                          placeholder="Campaign Default"
                          value={buyerForm.pricePerBillableCall}
                          onChange={e =>
                            setBuyerForm({ ...buyerForm, pricePerBillableCall: e.target.value })
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="buyer-weight">Weight (routing probability)</Label>
                      <Input
                        id="buyer-weight"
                        type="number"
                        min={1}
                        value={buyerForm.weight}
                        onChange={e =>
                          setBuyerForm({ ...buyerForm, weight: parseInt(e.target.value) || 100 })
                        }
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="buyer-status">Assignment Status</Label>
                      <Select
                        value={buyerForm.status}
                        onValueChange={(val: string) =>
                          setBuyerForm({ ...buyerForm, status: val as typeof buyerForm.status })
                        }
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
                </div>

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenBuyerDialog(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={submittingBuyer || !buyerForm.buyerId || !buyerForm.destinationNumber}
                  >
                    {submittingBuyer && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    {editingBuyerId ? 'Save Changes' : 'Add Assignment'}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}
