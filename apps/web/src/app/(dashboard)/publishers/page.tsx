'use client';

import {
  BarChart3,
  Check,
  Copy,
  Edit,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

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
import { Switch } from '@/components/ui/switch';
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

export default function PublishersPage() {
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
      }
    } catch (error) {
      console.error('Failed to create publisher:', error);
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
      }
    } catch (error) {
      console.error('Failed to update publisher:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedPublisher) return;
    setSaving(true);
    try {
      await apiClient.delete(`/api/v1/publishers/${selectedPublisher.id}`);
      setDeleteDialogOpen(false);
      setSelectedPublisher(null);
      void fetchPublishers();
      void fetchStats();
    } catch (error) {
      console.error('Failed to delete publisher:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (publisher: Publisher) => {
    try {
      const newStatus = publisher.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
      await apiClient.patch(`/api/v1/publishers/${publisher.id}`, { status: newStatus });
      void fetchPublishers();
    } catch (error) {
      console.error('Failed to toggle publisher status:', error);
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
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Manage Publishers</h1>
          <p className="text-sm text-muted-foreground">
            Configure publisher accounts and track performance
          </p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} size="sm">
          <Plus className="mr-2 h-4 w-4" />
          Add Publisher
        </Button>
      </div>

      {/* Content */}
      <Card className="flex-1 flex flex-col overflow-hidden min-h-0 border-gray-200">
        <CardHeader className="flex-shrink-0 py-3 px-4 border-b bg-gray-50/50">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-medium">Publishers</CardTitle>
              <CardDescription className="text-xs">
                View and manage all publisher accounts
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search publishers..."
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
                  void fetchPublishers();
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
                  Publisher ID
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Total Calls
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Billable
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Conversion %
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Missed
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-center">
                  Status
                </TableHead>
                <TableHead className="font-semibold text-xs uppercase text-gray-600 py-2 px-3 text-right">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8">
                    <RefreshCw className="h-5 w-5 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filteredPublishers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                    No publishers found
                  </TableCell>
                </TableRow>
              ) : (
                filteredPublishers.map(publisher => {
                  const pubStats = stats.get(publisher.id);
                  return (
                    <TableRow
                      key={publisher.id}
                      className="hover:bg-gray-50/50 border-b border-gray-100"
                    >
                      {/* Name */}
                      <TableCell className="py-2 px-3">
                        <button
                          onClick={() => openEditDialog(publisher)}
                          className="font-medium text-blue-600 hover:text-blue-800 hover:underline text-sm"
                        >
                          {publisher.name}
                        </button>
                      </TableCell>

                      {/* Publisher ID (monospace, copyable) */}
                      <TableCell className="py-2 px-3">
                        <div className="flex items-center gap-1.5">
                          <code className="font-mono text-xs text-gray-600 bg-gray-100 px-1.5 py-0.5 rounded">
                            {publisher.code}
                          </code>
                          <button
                            onClick={() => copyToClipboard(publisher.code)}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            title="Copy to clipboard"
                          >
                            {copiedId === publisher.code ? (
                              <Check className="h-3.5 w-3.5 text-green-500" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </TableCell>

                      {/* Total Calls */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums">
                        {pubStats?.totalCalls.toLocaleString() ?? 0}
                      </TableCell>

                      {/* Billable Calls */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums">
                        {pubStats?.billableCalls.toLocaleString() ?? 0}
                      </TableCell>

                      {/* Conversion % */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums">
                        {pubStats?.conversionRate.toFixed(1) ?? '0.0'}%
                      </TableCell>

                      {/* Missed Calls */}
                      <TableCell className="py-2 px-3 text-right text-sm tabular-nums">
                        {pubStats?.missedCalls.toLocaleString() ?? 0}
                      </TableCell>

                      {/* Status */}
                      <TableCell className="py-2 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span
                            className={cn(
                              'h-2 w-2 rounded-full',
                              publisher.status === 'ACTIVE' ? 'bg-green-500' : 'bg-orange-400'
                            )}
                          />
                          <span className="text-xs text-gray-600">
                            {publisher.status === 'ACTIVE' ? 'Active' : 'Paused'}
                          </span>
                        </div>
                      </TableCell>

                      {/* Actions */}
                      <TableCell className="py-2 px-3 text-right">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openEditDialog(publisher)}
                            title="Edit"
                          >
                            <Edit className="h-3.5 w-3.5 text-gray-500" />
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
                            <BarChart3 className="h-3.5 w-3.5 text-gray-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => handleToggleStatus(publisher)}
                            title={publisher.status === 'ACTIVE' ? 'Pause' : 'Activate'}
                          >
                            {publisher.status === 'ACTIVE' ? (
                              <Pause className="h-3.5 w-3.5 text-orange-500" />
                            ) : (
                              <Play className="h-3.5 w-3.5 text-green-500" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => openDeleteDialog(publisher)}
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
              <p className="text-xs text-muted-foreground">
                A welcome email will be sent to this address
              </p>
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="recordings">Access to Recordings</Label>
                <p className="text-xs text-muted-foreground">
                  Allow publisher to access call recordings
                </p>
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
            <Button onClick={handleCreate} disabled={saving || !formData.name.trim()}>
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
                <p className="text-xs text-muted-foreground">
                  Allow publisher to access call recordings
                </p>
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
              <div className="text-xs text-muted-foreground border-t pt-4 mt-2">
                <p>
                  <strong>Publisher ID:</strong>{' '}
                  <code className="font-mono bg-gray-100 px-1 rounded">
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
            <Button onClick={handleEdit} disabled={saving || !formData.name.trim()}>
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
            <Button variant="destructive" onClick={handleDelete} disabled={saving}>
              {saving ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
