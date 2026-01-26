'use client';

import { BarChart3, Copy, Edit, Pause, Play, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { CreateCampaignWizard } from '@/components/campaigns/create-campaign-wizard';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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

// Country flag emoji helper
function getCountryFlag(countryCode: string): string {
  const code = countryCode.toUpperCase();
  if (code.length !== 2) return '🌐';
  const offset = 127397;
  return String.fromCodePoint(...[...code].map(c => c.charCodeAt(0) + offset));
}

// Status badge component
function StatusBadge({ status }: { status: Campaign['status'] }) {
  const config = {
    ACTIVE: { label: 'Live', bg: 'bg-green-100', text: 'text-green-700', dot: 'bg-green-500' },
    PAUSED: { label: 'Paused', bg: 'bg-orange-100', text: 'text-orange-700', dot: 'bg-orange-500' },
    ARCHIVED: { label: 'Setup', bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' },
  };
  const c = config[status] || config.ARCHIVED;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium',
        c.bg,
        c.text
      )}
    >
      <span className={cn('h-1.5 w-1.5 rounded-full', c.dot)} />
      {c.label}
    </span>
  );
}

export default function CampaignsPage() {
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
    } catch (error) {
      console.error('Failed to toggle campaign status:', error);
      // Revert on error
      setCampaigns(prev =>
        prev.map(c => (c.id === campaign.id ? { ...c, status: campaign.status } : c))
      );
    }
  };

  const handleDuplicate = async (campaign: Campaign) => {
    try {
      const response = await apiClient.post<Campaign>(`/api/v1/campaigns/${campaign.id}/duplicate`);
      if (response.data) {
        void fetchCampaigns();
        void fetchStats();
      }
    } catch (error) {
      console.error('Failed to duplicate campaign:', error);
    }
  };

  const handleDelete = async () => {
    if (!selectedCampaign) return;
    setDeleting(true);
    try {
      await apiClient.delete(`/api/v1/campaigns/${selectedCampaign.id}`);
      setDeleteDialogOpen(false);
      setSelectedCampaign(null);
      void fetchCampaigns();
      void fetchStats();
    } catch (error) {
      console.error('Failed to delete campaign:', error);
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
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Manage Campaigns</h1>
          <p className="text-sm text-muted-foreground">Configure campaigns and track performance</p>
        </div>
        <Button onClick={() => setWizardOpen(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Create Campaign
        </Button>
      </div>

      {/* Content */}
      <Card className="flex-1 flex flex-col overflow-hidden min-h-0 border-gray-200">
        <CardHeader className="flex-shrink-0 py-3 px-4 border-b bg-gray-50/50">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium">Campaigns</CardTitle>
              <CardDescription className="text-xs">View and manage all campaigns</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search campaigns..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 w-64 h-8 text-sm"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  void fetchCampaigns();
                  void fetchStats();
                }}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-0 p-0">
          <Table>
            <TableHeader className="sticky top-0 bg-white z-10">
              <TableRow className="border-b bg-gray-50/80">
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3">
                  Name
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3">
                  Status
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3">
                  Offer Name
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-center">
                  Country
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-center">
                  Recording
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Live
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Hour
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Day
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Month
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Total
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={11} className="text-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filteredCampaigns.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={11}
                    className="text-center py-8 text-muted-foreground text-sm"
                  >
                    No campaigns found
                  </TableCell>
                </TableRow>
              ) : (
                filteredCampaigns.map(campaign => {
                  const campaignStats = stats.get(campaign.id);
                  return (
                    <TableRow
                      key={campaign.id}
                      className="hover:bg-gray-50/50 border-b border-gray-100"
                    >
                      {/* Name */}
                      <TableCell className="py-2 px-3">
                        <a
                          href={`/campaigns/${campaign.id}`}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-sm"
                        >
                          {campaign.name}
                        </a>
                      </TableCell>

                      {/* Status */}
                      <TableCell className="py-2 px-3">
                        <StatusBadge status={campaign.status} />
                      </TableCell>

                      {/* Offer Name */}
                      <TableCell className="py-2 px-3 text-sm text-gray-700">
                        {campaign.offerName || '—'}
                      </TableCell>

                      {/* Country */}
                      <TableCell className="py-2 px-3 text-center text-lg">
                        {getCountryFlag(campaign.country)}
                      </TableCell>

                      {/* Recording */}
                      <TableCell className="py-2 px-3 text-center text-sm text-gray-600">
                        {campaign.recordingEnabled ? 'Yes' : 'No'}
                      </TableCell>

                      {/* Live */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums font-medium text-green-600">
                        {campaignStats?.liveCount ?? 0}
                      </TableCell>

                      {/* Hour */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums">
                        {campaignStats?.hourCount ?? 0}
                      </TableCell>

                      {/* Day */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums">
                        {campaignStats?.dayCount ?? 0}
                      </TableCell>

                      {/* Month */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums">
                        {campaignStats?.monthCount ?? 0}
                      </TableCell>

                      {/* Total */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums font-medium">
                        {campaignStats?.totalCount ?? 0}
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-2 px-3 text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => (window.location.href = `/campaigns/${campaign.id}`)}
                            title="Edit"
                          >
                            <Edit className="h-3.5 w-3.5 text-gray-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              (window.location.href = `/dashboard?campaignId=${campaign.id}`)
                            }
                            title="View Reports"
                          >
                            <BarChart3 className="h-3.5 w-3.5 text-gray-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleDuplicate(campaign)}
                            title="Duplicate"
                          >
                            <Copy className="h-3.5 w-3.5 text-gray-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleToggleStatus(campaign)}
                            title={campaign.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                          >
                            {campaign.status === 'ACTIVE' ? (
                              <Pause className="h-3.5 w-3.5 text-orange-500" />
                            ) : (
                              <Play className="h-3.5 w-3.5 text-green-500" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openDeleteDialog(campaign)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-red-500" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-3 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                Previous
              </Button>
              <span className="text-sm text-muted-foreground">
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
        </CardContent>
      </Card>

      {/* Create Campaign Wizard */}
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
            <DialogTitle>Delete Campaign?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selectedCampaign?.name}</strong>? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
