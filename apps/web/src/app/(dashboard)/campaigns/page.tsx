'use client';

import {
  BarChart3,
  Copy,
  Edit,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { CreateCampaignWizard } from '@/components/campaigns/create-campaign-wizard';
import {
  EmptyState,
  Panel,
  PanelBody,
  StatusChip,
  Toolbar,
  ToolbarActions,
  ToolbarSearch,
  type StatusTone,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Campaign {
  id: string;
  name: string;
  offerName: string | null;
  country: string;
  recordingEnabled: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
  publisherId: string;
  publisher: { id: string; name: string; code: string } | null;
  flowId: string | null;
  flow: { id: string; name: string } | null;
  calls: number;
  phoneNumbers: number;
  createdAt: string;
  updatedAt: string;
}

interface CampaignStats {
  campaignId: string;
  liveCount: number;
  hourCount: number;
  dayCount: number;
  monthCount: number;
  totalCount: number;
}

interface CampaignsResponse {
  data: Campaign[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface StatsResponse {
  data: CampaignStats[];
}

/*
 * CampaignStatus is not in the StatusChip tone map, and the by-name default
 * for PAUSED is `blocked`; a hand-paused campaign has always read amber here,
 * so the tone is passed explicitly.
 */
function campaignStatusChip(status: Campaign['status']): { label: string; tone: StatusTone } {
  if (status === 'ACTIVE') return { label: 'Live', tone: 'live' };
  if (status === 'PAUSED') return { label: 'Paused', tone: 'ringing' };
  return { label: 'Setup', tone: 'neutral' };
}

function CampaignsPage() {
  /*
   * Staff manage campaigns; an agency reads its own.
   *
   * `/campaigns` left STAFF_ONLY_ROUTES so an agency principal can see which
   * campaigns send it calls and how many. Every write under
   * `/api/v1/campaigns` is still refused to anybody who is not staff
   * (STAFF_ONLY_AREAS on the API side), so for them the controls that would
   * only ever answer 403 are not drawn at all: create, edit, duplicate,
   * pause/activate and delete.
   *
   * A white-label agency's OWNER and ADMIN are the exception: they run a call
   * network of their own, the API lets their campaign writes through
   * (WHITE_LABEL_ALLOWED), and they get every control staff do.
   */
  const { isPlatformAdmin, isWhiteLabel } = useAuth();
  const canManage = isPlatformAdmin || isWhiteLabel;

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [stats, setStats] = useState<Map<string, CampaignStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Dialog states
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Polling ref
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '50' });
      const response = await apiClient.get<CampaignsResponse>(
        `/api/v1/campaigns?${params.toString()}`
      );
      if (response.data) {
        setCampaigns(response.data.data);
        setTotalPages(response.data.meta.totalPages);
      }
    } catch (error) {
      console.error('Failed to fetch campaigns:', error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await apiClient.get<StatsResponse>('/api/v1/campaigns/stats');
      if (response.data) {
        const statsMap = new Map(response.data.data.map(s => [s.campaignId, s]));
        setStats(statsMap);
      }
    } catch (error) {
      console.error('Failed to fetch campaign stats:', error);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchCampaigns();
    void fetchStats();
  }, [fetchCampaigns, fetchStats]);

  // Poll stats every 10 seconds for live counts
  useEffect(() => {
    pollIntervalRef.current = setInterval(() => {
      void fetchStats();
    }, 10000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchStats]);

  const handleToggleStatus = async (campaign: Campaign) => {
    // Optimistic update
    const newStatus = campaign.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE';
    setCampaigns(prev =>
      prev.map(c => (c.id === campaign.id ? { ...c, status: newStatus as Campaign['status'] } : c))
    );

    try {
      await apiClient.patch(`/api/v1/campaigns/${campaign.id}`, { status: newStatus });
      toast.success(
        'Status Updated',
        `${campaign.name} is now ${newStatus === 'ACTIVE' ? 'active' : 'paused'}.`
      );
    } catch (error) {
      console.error('Failed to toggle campaign status:', error);
      // Revert on error
      setCampaigns(prev =>
        prev.map(c => (c.id === campaign.id ? { ...c, status: campaign.status } : c))
      );
      toast.error('Error', 'Failed to update campaign status.');
    }
  };

  const handleDuplicate = async (campaign: Campaign) => {
    try {
      const response = await apiClient.post<Campaign>(`/api/v1/campaigns/${campaign.id}/duplicate`);
      if (response.data) {
        void fetchCampaigns();
        void fetchStats();
        toast.success('Campaign Duplicated', `Copy of ${campaign.name} created.`);
      } else if (response.error) {
        toast.error('Failed to Duplicate', response.error.message);
      }
    } catch (error) {
      console.error('Failed to duplicate campaign:', error);
      toast.error('Error', 'Failed to duplicate campaign.');
    }
  };

  const handleDelete = async () => {
    if (!selectedCampaign) return;
    const campaignName = selectedCampaign.name;
    setDeleting(true);
    try {
      await apiClient.delete(`/api/v1/campaigns/${selectedCampaign.id}`);
      setDeleteDialogOpen(false);
      setSelectedCampaign(null);
      void fetchCampaigns();
      void fetchStats();
      toast.success('Campaign Deleted', `${campaignName} has been removed.`);
    } catch (error) {
      console.error('Failed to delete campaign:', error);
      toast.error('Error', 'Failed to delete campaign.');
    } finally {
      setDeleting(false);
    }
  };

  const openDeleteDialog = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setDeleteDialogOpen(true);
  };

  const filteredCampaigns = campaigns.filter(
    c =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      (c.offerName && c.offerName.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="page-canvas">
      <PageHeader
        description={
          canManage
            ? 'Configure campaigns and track performance'
            : 'The campaigns sending your agency calls, and how many each is sending'
        }
        actions={
          canManage ? (
            <Button onClick={() => setWizardOpen(true)} size="sm">
              <Plus className="mr-2 h-4 w-4" />
              Create Campaign
            </Button>
          ) : null
        }
      />

      <Toolbar>
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Search campaigns..." />
        <ToolbarActions>
          <Tooltip content="Refresh" align="end">
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh"
              className="h-8 w-8 p-0"
              onClick={() => {
                void fetchCampaigns();
                void fetchStats();
              }}
              disabled={loading}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
            </Button>
          </Tooltip>
        </ToolbarActions>
      </Toolbar>

      <Panel className="min-w-0 overflow-hidden">
        <PanelBody flush>
          {!loading && filteredCampaigns.length === 0 ? (
            search ? (
              <EmptyState
                variant="filtered"
                headline="No campaigns match your search"
                secondaryAction={{ label: 'Clear search', onClick: () => setSearch('') }}
              />
            ) : (
              <EmptyState
                headline="No campaigns yet"
                action={
                  canManage
                    ? { label: 'Create campaign', onClick: () => setWizardOpen(true) }
                    : undefined
                }
              />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Offer Name</TableHead>
                  <TableHead className="text-center">Country</TableHead>
                  <TableHead className="text-center">Recording</TableHead>
                  <TableHead className="text-right">Live</TableHead>
                  <TableHead className="text-right">Hour</TableHead>
                  <TableHead className="text-right">Day</TableHead>
                  <TableHead className="text-right">Month</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto text-ink-3" />
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredCampaigns.map(campaign => {
                    const campaignStats = stats.get(campaign.id);
                    return (
                      <TableRow key={campaign.id}>
                        {/* Name */}
                        <TableCell className="pl-5">
                          <a
                            href={`/campaigns/${campaign.id}`}
                            className="font-medium text-brand-ink hover:opacity-80 hover:underline"
                          >
                            {campaign.name}
                          </a>
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          <StatusChip
                            value={campaign.status}
                            enumName="CampaignStatus"
                            {...campaignStatusChip(campaign.status)}
                          />
                        </TableCell>

                        {/* Offer Name */}
                        <TableCell className="text-ink-3">{campaign.offerName || '—'}</TableCell>

                        {/* Country */}
                        {/* The code, not a flag emoji: Windows renders regional
                          indicators as the bare letters. */}
                        <TableCell className="t-body text-center text-ink-2">
                          {campaign.country ? campaign.country.toUpperCase() : '—'}
                        </TableCell>

                        {/* Recording */}
                        <TableCell className="text-center text-ink-3">
                          {campaign.recordingEnabled ? 'Yes' : 'No'}
                        </TableCell>

                        {/* Live */}
                        <TableCell className="text-right tabular-nums font-medium text-live-ink">
                          {campaignStats?.liveCount ?? 0}
                        </TableCell>

                        {/* Hour */}
                        <TableCell className="text-right tabular-nums">
                          {campaignStats?.hourCount ?? 0}
                        </TableCell>

                        {/* Day */}
                        <TableCell className="text-right tabular-nums">
                          {campaignStats?.dayCount ?? 0}
                        </TableCell>

                        {/* Month */}
                        <TableCell className="text-right tabular-nums">
                          {campaignStats?.monthCount ?? 0}
                        </TableCell>

                        {/* Total */}
                        <TableCell className="text-right tabular-nums font-medium">
                          {campaignStats?.totalCount ?? 0}
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="pr-5 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            {canManage ? (
                              <Tooltip content="Edit campaign" align="end">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  aria-label={`Edit ${campaign.name}`}
                                  onClick={() =>
                                    (window.location.href = `/campaigns/${campaign.id}`)
                                  }
                                >
                                  <Edit className="h-3.5 w-3.5 text-ink-3" />
                                </Button>
                              </Tooltip>
                            ) : null}
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  aria-label={`More actions for ${campaign.name}`}
                                >
                                  <MoreHorizontal className="h-4 w-4 text-ink-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-[10rem]">
                                <DropdownMenuItem
                                  onSelect={() =>
                                    (window.location.href = `/dashboard?campaignId=${campaign.id}`)
                                  }
                                >
                                  <BarChart3 className="mr-2 h-3.5 w-3.5 text-ink-3" />
                                  View stats
                                </DropdownMenuItem>
                                {canManage ? (
                                  <>
                                    <DropdownMenuItem
                                      onSelect={() => void handleDuplicate(campaign)}
                                    >
                                      <Copy className="mr-2 h-3.5 w-3.5 text-ink-3" />
                                      Duplicate
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onSelect={() => void handleToggleStatus(campaign)}
                                    >
                                      {campaign.status === 'ACTIVE' ? (
                                        <Pause className="mr-2 h-3.5 w-3.5 text-ink-3" />
                                      ) : (
                                        <Play className="mr-2 h-3.5 w-3.5 text-ink-3" />
                                      )}
                                      {campaign.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-dropped-ink focus:text-dropped-ink"
                                      onSelect={() => openDeleteDialog(campaign)}
                                    >
                                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                                      Delete
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          )}
        </PanelBody>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2 border-t border-rule py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-ink-3">
              Page {page} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
            >
              Next
            </Button>
          </div>
        )}
      </Panel>

      {/* Create Campaign Wizard */}
      {canManage ? (
        <>
          <CreateCampaignWizard
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            onSuccess={() => {
              void fetchCampaigns();
              void fetchStats();
            }}
          />

          {/* Delete Confirmation Dialog */}
          <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Delete “{selectedCampaign?.name}”?</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete <strong>{selectedCampaign?.name}</strong>? This
                  action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleDelete()}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

export default function GuardedCampaignsPage() {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <CampaignsPage />
    </RoleGuard>
  );
}
