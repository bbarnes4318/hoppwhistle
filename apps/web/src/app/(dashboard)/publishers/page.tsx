'use client';

import { BarChart3, Check, Copy, Edit, Pause, Play, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { Panel, PanelBody, Toolbar, ToolbarActions, ToolbarSearch } from '@/components/domain';
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
              ) : filteredPublishers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-ink-3">
                    No publishers found
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
                          <code className="font-mono text-xs text-ink-2 bg-sunken px-1.5 py-0.5 rounded">
                            {publisher.code}
                          </code>
                          <button
                            onClick={() => {
                              void copyToClipboard(publisher.code);
                            }}
                            className="text-ink-3 hover:text-ink transition-colors"
                            title="Copy to clipboard"
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

                      {/* Conversion % */}
                      <TableCell className="text-right tabular-nums">
                        {pubStats?.conversionRate.toFixed(1) ?? '0.0'}%
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
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEditDialog(publisher)}
                            title="Edit"
                          >
                            <Edit className="h-3.5 w-3.5 text-ink-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() =>
                              (window.location.href = `/dashboard?publisherId=${publisher.id}`)
                            }
                            title="View Reports"
                          >
                            <BarChart3 className="h-3.5 w-3.5 text-ink-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => void handleToggleStatus(publisher)}
                            title={publisher.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                          >
                            {publisher.status === 'ACTIVE' ? (
                              <Pause className="h-3.5 w-3.5 text-ringing-ink" />
                            ) : (
                              <Play className="h-3.5 w-3.5 text-live-ink" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openDeleteDialog(publisher)}
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-dropped-ink" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
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
        <DialogContent className="max-w-md">
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
            <DialogTitle>Delete Publisher?</DialogTitle>
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

export default function GuardedPublishersPage() {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <PublishersPage />
    </RoleGuard>
  );
}
