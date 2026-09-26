'use client';

import {
  BarChart3,
  Check,
  Copy,
  Edit,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { pct } from '@/components/delivery/ledger';
import {
  EmptyState,
  Panel,
  PanelBody,
  Toolbar,
  ToolbarActions,
  ToolbarSearch,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { PortalAccess } from '@/components/portal-access/portal-access';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Publisher {
  id: string;
  name: string;
  code: string;
  email: string | null;
  accessToRecordings: boolean;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
}

interface PublisherStats {
  publisherId: string;
  name: string;
  code: string;
  status: string;
  totalCalls: number;
  billableCalls: number;
  missedCalls: number;
  conversionRate: number;
}

interface PublishersResponse {
  data: Publisher[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface StatsResponse {
  data: PublisherStats[];
}

function PublishersPage() {
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [stats, setStats] = useState<Map<string, PublisherStats>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedPublisher, setSelectedPublisher] = useState<Publisher | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    accessToRecordings: false,
  });
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchPublishers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '50' });
      const response = await apiClient.get<PublishersResponse>(
        `/api/v1/publishers?${params.toString()}`
      );
      if (response.data) {
        setPublishers(response.data.data);
        setTotalPages(response.data.meta.totalPages);
      }
    } catch (error) {
      console.error('Failed to fetch publishers:', error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchStats = useCallback(async () => {
    try {
      const response = await apiClient.get<StatsResponse>('/api/v1/publishers/stats');
      if (response.data) {
        const statsMap = new Map(response.data.data.map(s => [s.publisherId, s]));
        setStats(statsMap);
      }
    } catch (error) {
      console.error('Failed to fetch publisher stats:', error);
    }
  }, []);

  useEffect(() => {
    void fetchPublishers();
    void fetchStats();
  }, [fetchPublishers, fetchStats]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const response = await apiClient.post('/api/v1/publishers', {
        name: formData.name,
        email: formData.email || undefined,
        accessToRecordings: formData.accessToRecordings,
      });
      if (response.data) {
        setCreateDialogOpen(false);
        resetForm();
        void fetchPublishers();
        void fetchStats();
        toast.success('Publisher Created', `${formData.name} has been added successfully.`);
      } else if (response.error) {
        toast.error('Failed to Create', response.error.message);
      }
    } catch (error) {
      console.error('Failed to create publisher:', error);
      toast.error('Error', 'Failed to create publisher.');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedPublisher) return;
    setSaving(true);
    try {
      const response = await apiClient.patch(`/api/v1/publishers/${selectedPublisher.id}`, {
        name: formData.name,
        email: formData.email || null,
        accessToRecordings: formData.accessToRecordings,
      });
      if (response.data) {
        setEditDialogOpen(false);
        resetForm();
        void fetchPublishers();
        toast.success('Publisher Updated', `${formData.name} has been updated.`);
      } else if (response.error) {
        toast.error('Failed to Update', response.error.message);
      }
    } catch (error) {
      console.error('Failed to update publisher:', error);
      toast.error('Error', 'Failed to update publisher.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPublisher) return;
    const publisherName = selectedPublisher.name;
    setSaving(true);
    try {
      await apiClient.delete(`/api/v1/publishers/${selectedPublisher.id}`);
      setDeleteDialogOpen(false);
      setSelectedPublisher(null);
      void fetchPublishers();
      void fetchStats();
      toast.success('Publisher Deleted', `${publisherName} has been removed.`);
    } catch (error) {
      console.error('Failed to delete publisher:', error);
      toast.error('Error', 'Failed to delete publisher.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (publisher: Publisher) => {
    try {
      const newStatus = publisher.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await apiClient.patch(`/api/v1/publishers/${publisher.id}`, { status: newStatus });
      void fetchPublishers();
      toast.success(
        'Status Updated',
        `${publisher.name} is now ${newStatus === 'ACTIVE' ? 'active' : 'paused'}.`
      );
    } catch (error) {
      console.error('Failed to toggle publisher status:', error);
      toast.error('Error', 'Failed to update status.');
    }
  };

  const resetForm = () => {
    setFormData({ name: '', email: '', accessToRecordings: false });
    setSelectedPublisher(null);
  };

  const openEditDialog = (publisher: Publisher) => {
    setSelectedPublisher(publisher);
    setFormData({
      name: publisher.name,
      email: publisher.email || '',
      accessToRecordings: publisher.accessToRecordings,
    });
    setEditDialogOpen(true);
  };

  const openDeleteDialog = (publisher: Publisher) => {
    setSelectedPublisher(publisher);
    setDeleteDialogOpen(true);
  };

  const copyToClipboard = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedId(code);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredPublishers = publishers.filter(
    pub =>
      pub.name.toLowerCase().includes(search.toLowerCase()) ||
      pub.code.toLowerCase().includes(search.toLowerCase()) ||
      (pub.email && pub.email.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="page-canvas">
      <PageHeader
        description="Configure publisher accounts and track performance"
        actions={
          <Button onClick={() => setCreateDialogOpen(true)} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            Add Publisher
          </Button>
        }
      />

      <Toolbar>
        <ToolbarSearch value={search} onChange={setSearch} placeholder="Search publishers..." />
        <ToolbarActions>
          <Tooltip content="Refresh" align="end">
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh"
              className="h-8 w-8 p-0"
              onClick={() => {
                void fetchPublishers();
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
          {!loading && filteredPublishers.length === 0 ? (
            search ? (
              <EmptyState
                variant="filtered"
                headline="No publishers match your search"
                secondaryAction={{ label: 'Clear search', onClick: () => setSearch('') }}
              />
            ) : (
              <EmptyState
                headline="No publishers yet"
                action={{ label: 'Add publisher', onClick: () => setCreateDialogOpen(true) }}
              />
            )
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Name</TableHead>
                  <TableHead>Publisher ID</TableHead>
                  <TableHead className="text-right">Total Calls</TableHead>
                  <TableHead className="text-right">Billable</TableHead>
                  <TableHead className="text-right">Conversion %</TableHead>
                  <TableHead className="text-right">Missed</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="pr-5 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      <RefreshCw className="h-5 w-5 animate-spin mx-auto text-ink-3" />
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPublishers.map(publisher => {
                    const pubStats = stats.get(publisher.id);
                    return (
                      <TableRow key={publisher.id}>
                        {/* Name */}
                        <TableCell className="pl-5">
                          <button
                            onClick={() => openEditDialog(publisher)}
                            className="font-medium text-brand-ink hover:opacity-80 hover:underline"
                          >
                            {publisher.name}
                          </button>
                        </TableCell>

                        {/* Publisher ID (monospace, copyable) */}
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {/* The full id is 32 hex characters; eight tell rows
                              apart, the tooltip and the copy button carry the rest. */}
                            <Tooltip content={publisher.code}>
                              <code
                                tabIndex={0}
                                className="t-data rounded bg-sunken px-1.5 py-0.5 text-ink-2"
                              >
                                {publisher.code.length > 8
                                  ? `${publisher.code.slice(0, 8)}…`
                                  : publisher.code}
                              </code>
                            </Tooltip>
                            <button
                              onClick={() => {
                                void copyToClipboard(publisher.code);
                              }}
                              className="text-ink-3 hover:text-ink transition-colors"
                              title="Copy to clipboard"
                              aria-label={`Copy publisher ID for ${publisher.name}`}
                            >
                              {copiedId === publisher.code ? (
                                <Check className="h-3.5 w-3.5 text-live-ink" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </TableCell>

                        {/* Total Calls */}
                        <TableCell className="text-right tabular-nums">
                          {pubStats?.totalCalls.toLocaleString() ?? 0}
                        </TableCell>

                        {/* Billable Calls */}
                        <TableCell className="text-right tabular-nums">
                          {pubStats?.billableCalls.toLocaleString() ?? 0}
                        </TableCell>

                        {/* Conversion % -- no calls, no rate: a dash, not 0.0%. */}
                        <TableCell className="text-right tabular-nums">
                          {pct(pubStats?.totalCalls ? pubStats.conversionRate : null, 1)}
                        </TableCell>

                        {/* Missed Calls */}
                        <TableCell className="text-right tabular-nums">
                          {pubStats?.missedCalls.toLocaleString() ?? 0}
                        </TableCell>

                        {/* Status */}
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <span
                              className={cn(
                                'h-2 w-2 rounded-full',
                                publisher.status === 'ACTIVE' ? 'bg-live' : 'bg-ringing'
                              )}
                            />
                            <span className="text-xs text-ink-3">
                              {publisher.status === 'ACTIVE' ? 'Active' : 'Paused'}
                            </span>
                          </div>
                        </TableCell>

                        {/* Actions */}
                        <TableCell className="pr-5 text-right">
                          <div className="flex items-center justify-end gap-0.5">
                            <Tooltip content="Edit publisher" align="end">
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                aria-label={`Edit ${publisher.name}`}
                                onClick={() => openEditDialog(publisher)}
                              >
                                <Edit className="h-3.5 w-3.5 text-ink-3" />
                              </Button>
                            </Tooltip>
                            <DropdownMenu modal={false}>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-7 w-7"
                                  aria-label={`More actions for ${publisher.name}`}
                                >
                                  <MoreHorizontal className="h-4 w-4 text-ink-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-[10rem]">
                                <DropdownMenuItem
                                  onSelect={() =>
                                    (window.location.href = `/dashboard?publisherId=${publisher.id}`)
                                  }
                                >
                                  <BarChart3 className="mr-2 h-3.5 w-3.5 text-ink-3" />
                                  View stats
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() => void handleToggleStatus(publisher)}
                                >
                                  {publisher.status === 'ACTIVE' ? (
                                    <Pause className="mr-2 h-3.5 w-3.5 text-ink-3" />
                                  ) : (
                                    <Play className="mr-2 h-3.5 w-3.5 text-ink-3" />
                                  )}
                                  {publisher.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  className="text-dropped-ink focus:text-dropped-ink"
                                  onSelect={() => openDeleteDialog(publisher)}
                                >
                                  <Trash2 className="mr-2 h-3.5 w-3.5" />
                                  Delete
                                </DropdownMenuItem>
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

      {/* Create Publisher Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Publisher</DialogTitle>
            <DialogDescription>Create a new publisher account</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                placeholder="Publisher name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                placeholder="publisher@example.com"
              />
              <p className="text-xs text-ink-3">A welcome email will be sent to this address</p>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="recordings">Access to Recordings</Label>
                <p className="text-xs text-ink-3">Allow publisher to access call recordings</p>
              </div>
              <Switch
                id="recordings"
                checked={formData.accessToRecordings}
                onCheckedChange={checked =>
                  setFormData(f => ({ ...f, accessToRecordings: checked }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={saving || !formData.name.trim()}>
              {saving ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Publisher Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Publisher</DialogTitle>
            <DialogDescription>Update publisher settings</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name *</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={formData.email}
                onChange={e => setFormData(f => ({ ...f, email: e.target.value }))}
                placeholder="publisher@example.com"
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="edit-recordings">Access to Recordings</Label>
                <p className="text-xs text-ink-3">Allow publisher to access call recordings</p>
              </div>
              <Switch
                id="edit-recordings"
                checked={formData.accessToRecordings}
                onCheckedChange={checked =>
                  setFormData(f => ({ ...f, accessToRecordings: checked }))
                }
              />
            </div>
            {selectedPublisher && (
              <div className="text-xs text-ink-3 border-t border-rule pt-4 mt-2">
                <p>
                  <strong>Publisher ID:</strong>{' '}
                  <code className="font-mono bg-sunken px-1 rounded text-ink-2">
                    {selectedPublisher.code}
                  </code>
                </p>
              </div>
            )}
            {selectedPublisher && (
              <div className="border-t border-rule pt-4">
                <PortalAccess
                  kind="publisher"
                  entityId={selectedPublisher.id}
                  entityName={selectedPublisher.name}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleEdit()} disabled={saving || !formData.name.trim()}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{selectedPublisher?.name}”?</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selectedPublisher?.name}</strong>? This
              action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={saving}>
              {saving ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function PublishersView() {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <PublishersPage />
    </RoleGuard>
  );
}
