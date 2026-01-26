'use client';

import { AlertTriangle, Edit, Plus, RefreshCw, Search, Wallet } from 'lucide-react';
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
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Publisher {
  id: string;
  name: string;
}

interface Buyer {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
  billingType: 'TERMS' | 'UPFRONT';
  leadsRemaining: number;
  billableDuration: number;
  publisher: { id: string; name: string };
  callCount: number;
  transactionCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BuyersResponse {
  data: Buyer[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface PublishersResponse {
  data: Publisher[];
}

export default function BuyersPage() {
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [creditsDialogOpen, setCreditsDialogOpen] = useState(false);
  const [selectedBuyer, setSelectedBuyer] = useState<Buyer | null>(null);

  // Form states
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    publisherId: '',
    billingType: 'TERMS' as 'TERMS' | 'UPFRONT',
    billableDuration: 60,
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE' | 'PAUSED',
  });
  const [creditsAmount, setCreditsAmount] = useState(100);
  const [saving, setSaving] = useState(false);

  const fetchBuyers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: page.toString(), limit: '20' });
      const response = await apiClient.get<BuyersResponse>(`/api/v1/buyers?${params.toString()}`);
      if (response.data) {
        setBuyers(response.data.data);
        setTotalPages(response.data.meta.totalPages);
      }
    } catch (error) {
      console.error('Failed to fetch buyers:', error);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchPublishers = useCallback(async () => {
    try {
      const response = await apiClient.get<PublishersResponse>('/api/v1/publishers');
      if (response.data) {
        setPublishers(response.data.data);
      }
    } catch (error) {
      console.error('Failed to fetch publishers:', error);
    }
  }, []);

  useEffect(() => {
    void fetchBuyers();
    void fetchPublishers();
  }, [fetchBuyers, fetchPublishers]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      const response = await apiClient.post('/api/v1/buyers', formData);
      if (response.data) {
        setCreateDialogOpen(false);
        resetForm();
        void fetchBuyers();
      }
    } catch (error) {
      console.error('Failed to create buyer:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!selectedBuyer) return;
    setSaving(true);
    try {
      const response = await apiClient.patch(`/api/v1/buyers/${selectedBuyer.id}`, formData);
      if (response.data) {
        setEditDialogOpen(false);
        resetForm();
        void fetchBuyers();
      }
    } catch (error) {
      console.error('Failed to update buyer:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleAddCredits = async () => {
    if (!selectedBuyer) return;
    setSaving(true);
    try {
      const response = await apiClient.post(`/api/v1/buyers/${selectedBuyer.id}/credits`, {
        amount: creditsAmount,
      });
      if (response.data) {
        setCreditsDialogOpen(false);
        setCreditsAmount(100);
        void fetchBuyers();
      }
    } catch (error) {
      console.error('Failed to add credits:', error);
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      code: '',
      publisherId: '',
      billingType: 'TERMS',
      billableDuration: 60,
      status: 'ACTIVE',
    });
    setSelectedBuyer(null);
  };

  const openEditDialog = (buyer: Buyer) => {
    setSelectedBuyer(buyer);
    setFormData({
      name: buyer.name,
      code: buyer.code,
      publisherId: buyer.publisher.id,
      billingType: buyer.billingType,
      billableDuration: buyer.billableDuration,
      status: buyer.status,
    });
    setEditDialogOpen(true);
  };

  const openCreditsDialog = (buyer: Buyer) => {
    setSelectedBuyer(buyer);
    setCreditsDialogOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20">Active</Badge>
        );
      case 'PAUSED':
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Paused</Badge>;
      case 'INACTIVE':
        return <Badge variant="secondary">Inactive</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getBillingTypeBadge = (billingType: string) => {
    switch (billingType) {
      case 'UPFRONT':
        return (
          <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20">Upfront</Badge>
        );
      case 'TERMS':
        return <Badge variant="outline">Terms</Badge>;
      default:
        return <Badge variant="outline">{billingType}</Badge>;
    }
  };

  const filteredBuyers = buyers.filter(
    buyer =>
      buyer.name.toLowerCase().includes(search.toLowerCase()) ||
      buyer.code.toLowerCase().includes(search.toLowerCase()) ||
      buyer.publisher.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-3xl font-bold">Manage Buyers</h1>
          <p className="text-muted-foreground">Configure buyer billing and track lead wallets</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Buyer
        </Button>
      </div>

      {/* Content */}
      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Buyers</CardTitle>
              <CardDescription>Manage buyer accounts and billing settings</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search buyers..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="pl-9 w-64"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => void fetchBuyers()}
                disabled={loading}
              >
                <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Buyer</TableHead>
                <TableHead>Publisher</TableHead>
                <TableHead>Billing Type</TableHead>
                <TableHead className="text-right">Leads Remaining</TableHead>
                <TableHead className="text-right">Billable Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                  </TableCell>
                </TableRow>
              ) : filteredBuyers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No buyers found
                  </TableCell>
                </TableRow>
              ) : (
                filteredBuyers.map(buyer => (
                  <TableRow
                    key={buyer.id}
                    className={cn(
                      buyer.billingType === 'UPFRONT' && buyer.leadsRemaining < 10 && 'bg-red-500/5'
                    )}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {buyer.billingType === 'UPFRONT' && buyer.leadsRemaining < 10 && (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        )}
                        <div>
                          <div className="font-medium">{buyer.name}</div>
                          <div className="text-xs text-muted-foreground">{buyer.code}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{buyer.publisher.name}</TableCell>
                    <TableCell>{getBillingTypeBadge(buyer.billingType)}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono',
                        buyer.billingType === 'UPFRONT' &&
                          buyer.leadsRemaining < 10 &&
                          'text-red-600 font-semibold'
                      )}
                    >
                      {buyer.billingType === 'UPFRONT'
                        ? buyer.leadsRemaining.toLocaleString()
                        : '—'}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {buyer.billableDuration}s
                    </TableCell>
                    <TableCell>{getStatusBadge(buyer.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {buyer.billingType === 'UPFRONT' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openCreditsDialog(buyer)}
                            title="Add Credits"
                          >
                            <Wallet className="h-4 w-4 text-purple-500" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEditDialog(buyer)}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 mt-4">
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

      {/* Create Buyer Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add New Buyer</DialogTitle>
            <DialogDescription>Create a new buyer account with billing settings</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
                placeholder="Buyer name"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="code">Code</Label>
              <Input
                id="code"
                value={formData.code}
                onChange={e => setFormData(f => ({ ...f, code: e.target.value }))}
                placeholder="BUYER001"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="publisher">Publisher</Label>
              <Select
                value={formData.publisherId}
                onValueChange={value => setFormData(f => ({ ...f, publisherId: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select publisher" />
                </SelectTrigger>
                <SelectContent>
                  {publishers.map(pub => (
                    <SelectItem key={pub.id} value={pub.id}>
                      {pub.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="billingType">Billing Type</Label>
              <Select
                value={formData.billingType}
                onValueChange={value =>
                  setFormData(f => ({ ...f, billingType: value as 'TERMS' | 'UPFRONT' }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TERMS">Terms (Post-pay)</SelectItem>
                  <SelectItem value="UPFRONT">Upfront (Pre-pay)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="billableDuration">Billable Duration (seconds)</Label>
              <Input
                id="billableDuration"
                type="number"
                value={formData.billableDuration}
                onChange={e =>
                  setFormData(f => ({ ...f, billableDuration: parseInt(e.target.value) || 60 }))
                }
                min={0}
              />
              <p className="text-xs text-muted-foreground">
                Calls must be connected for at least this many seconds to be billable
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !formData.name || !formData.code || !formData.publisherId}
            >
              {saving ? 'Creating...' : 'Create Buyer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Buyer Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Buyer</DialogTitle>
            <DialogDescription>Update buyer settings and billing configuration</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={formData.name}
                onChange={e => setFormData(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-code">Code</Label>
              <Input
                id="edit-code"
                value={formData.code}
                onChange={e => setFormData(f => ({ ...f, code: e.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-status">Status</Label>
              <Select
                value={formData.status}
                onValueChange={value =>
                  setFormData(f => ({ ...f, status: value as 'ACTIVE' | 'INACTIVE' | 'PAUSED' }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="PAUSED">Paused</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-billingType">Billing Type</Label>
              <Select
                value={formData.billingType}
                onValueChange={value =>
                  setFormData(f => ({ ...f, billingType: value as 'TERMS' | 'UPFRONT' }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TERMS">Terms (Post-pay)</SelectItem>
                  <SelectItem value="UPFRONT">Upfront (Pre-pay)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-billableDuration">Billable Duration (seconds)</Label>
              <Input
                id="edit-billableDuration"
                type="number"
                value={formData.billableDuration}
                onChange={e =>
                  setFormData(f => ({ ...f, billableDuration: parseInt(e.target.value) || 60 }))
                }
                min={0}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleEdit} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Credits Dialog */}
      <Dialog open={creditsDialogOpen} onOpenChange={setCreditsDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Credits</DialogTitle>
            <DialogDescription>Add leads to {selectedBuyer?.name}&apos;s wallet</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="text-center py-4">
              <div className="text-sm text-muted-foreground mb-1">Current Balance</div>
              <div className="text-3xl font-bold">
                {selectedBuyer?.leadsRemaining.toLocaleString() ?? 0}
                <span className="text-lg font-normal text-muted-foreground ml-2">leads</span>
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="credits">Leads to Add</Label>
              <Input
                id="credits"
                type="number"
                value={creditsAmount}
                onChange={e => setCreditsAmount(parseInt(e.target.value) || 0)}
                min={1}
              />
            </div>
            <div className="text-center text-sm text-muted-foreground">
              New balance will be:{' '}
              <span className="font-semibold text-foreground">
                {((selectedBuyer?.leadsRemaining ?? 0) + creditsAmount).toLocaleString()} leads
              </span>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddCredits} disabled={saving || creditsAmount < 1}>
              {saving ? 'Adding...' : `Add ${creditsAmount} Credits`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
