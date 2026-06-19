'use client';

import {
  AlertTriangle,
  FileWarning,
  Gavel,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from 'lucide-react';
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
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { RoleGuard } from '@/components/auth/role-guard';

interface BuyerProfile {
  id: string;
  name: string;
  canDisputeConversions: boolean;
}

interface CallRecord {
  id: string;
  callerId?: string;
  toNumber?: string;
  targetNumber?: string;
  duration?: number;
  connectedDuration?: number;
  billable: boolean;
  buyerBillableAmount?: number;
  disputeStatus?: string | null;
  metadata?: {
    disputeReason?: string;
    disputedAt?: string;
  } | null;
  createdAt: string;
}

function BuyerDisputesPage() {
  const { buyerId } = useAuth();
  
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [disputedCalls, setDisputedCalls] = useState<CallRecord[]>([]);
  const [recentCalls, setRecentCalls] = useState<CallRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [recentCallsLoading, setRecentCallsLoading] = useState(false);

  // Dialog State
  const [newDisputeOpen, setNewDisputeOpen] = useState(false);
  const [selectedCallId, setSelectedCallId] = useState<string>('');
  const [disputeReason, setDisputeReason] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const loadDisputes = useCallback(async () => {
    if (!buyerId) return;
    setLoading(true);
    try {
      // 1. Fetch Profile for permission checking
      const profileRes = await apiClient.get<BuyerProfile>(`/api/v1/buyers/${buyerId}`);
      if (profileRes.data) setProfile(profileRes.data);

      // 2. Fetch Disputed Calls
      const disputesRes = await apiClient.get<{ data: CallRecord[] }>(
        `/api/v1/calls?buyerId=${buyerId}&disputeStatus=DISPUTED&limit=50`
      );
      if (disputesRes.data?.data) {
        setDisputedCalls(disputesRes.data.data);
      }
    } catch (err) {
      console.error('Failed to load disputes:', err);
      toast.error('Failed to load disputes');
    } finally {
      setLoading(false);
    }
  }, [buyerId]);

  const loadRecentCallsForDispute = async () => {
    if (!buyerId) return;
    setRecentCallsLoading(true);
    try {
      // Fetch recent calls (limit 20) that are billable and not already disputed
      const res = await apiClient.get<{ data: CallRecord[] }>(
        `/api/v1/calls?buyerId=${buyerId}&limit=50`
      );
      if (res.data?.data) {
        const undisputed = res.data.data.filter(c => c.billable && !c.disputeStatus);
        setRecentCalls(undisputed);
      }
    } catch (err) {
      console.error('Failed to load calls for dispute selection:', err);
      toast.error('Failed to load recent calls');
    } finally {
      setRecentCallsLoading(false);
    }
  };

  useEffect(() => {
    void loadDisputes();
  }, [loadDisputes]);

  const handleOpenDisputeDialog = () => {
    if (!profile?.canDisputeConversions) {
      toast.error('Your account is not permitted to file disputes. Please contact support.');
      return;
    }
    setSelectedCallId('');
    setDisputeReason('');
    setNewDisputeOpen(true);
    void loadRecentCallsForDispute();
  };

  const handleSubmitDispute = async () => {
    if (!selectedCallId || !disputeReason.trim()) {
      toast.error('Please select a call and enter a reason');
      return;
    }
    setSubmitting(true);
    try {
      await apiClient.post(`/api/v1/calls/${selectedCallId}/dispute`, {
        reason: disputeReason,
      });
      toast.success('Dispute submitted successfully');
      setNewDisputeOpen(false);
      void loadDisputes();
    } catch (err) {
      console.error('Failed to submit dispute:', err);
      toast.error('Failed to file dispute');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Disputes & Reconciliation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            View active disputes, review resolutions, and submit new call billing disputes.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={loadDisputes} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
          {profile?.canDisputeConversions && (
            <Button onClick={handleOpenDisputeDialog} size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              File Dispute
            </Button>
          )}
        </div>
      </div>

      {/* Permissions Check banner */}
      {!profile?.canDisputeConversions && (
        <Card className="bg-yellow-500/5 border-yellow-500/20 text-yellow-500">
          <CardContent className="flex items-start gap-3 pt-6">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <strong>Read-Only Dispute Access:</strong> Your account is currently not configured to initiate disputes. 
              If you believe a call connection was billed in error, please contact your account manager directly.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Dispute Summary Card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Active Disputes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold font-mono text-yellow-500">
              {loading ? '...' : disputedCalls.filter(c => c.disputeStatus === 'DISPUTED').length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">Pending administrative review</p>
          </CardContent>
        </Card>
      </div>

      {/* Disputes Table */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Disputed Connections</CardTitle>
          <CardDescription>History of connection charges disputed by your account.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/15">
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground w-[180px]">Dispute Date</th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Call Date</th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Caller ID</th>
                  <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Reason</th>
                  <th className="p-4 text-center text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                  <th className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                      <div className="flex items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span>Loading disputes...</span>
                      </div>
                    </td>
                  </tr>
                ) : disputedCalls.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                      No disputed connections registered.
                    </td>
                  </tr>
                ) : (
                  disputedCalls.map(call => (
                    <tr key={call.id} className="hover:bg-muted/30 transition-colors duration-150">
                      <td className="p-4 font-mono text-xs text-muted-foreground">
                        {call.metadata?.disputedAt
                          ? new Date(call.metadata.disputedAt).toLocaleString()
                          : 'Pending'}
                      </td>
                      <td className="p-4 font-mono text-xs text-muted-foreground">
                        {new Date(call.createdAt).toLocaleString()}
                      </td>
                      <td className="p-4 font-mono text-xs text-foreground">
                        {formatPhoneNumber(call.callerId || '—')}
                      </td>
                      <td className="p-4 text-xs text-slate-200">
                        {call.metadata?.disputeReason || 'No reason specified'}
                      </td>
                      <td className="p-4 text-center">
                        <Badge variant="warning" className="text-[10px] font-semibold uppercase">
                          {call.disputeStatus || 'DISPUTED'}
                        </Badge>
                      </td>
                      <td className="p-4 text-right font-mono text-xs text-emerald-400 font-semibold">
                        ${Number(call.buyerBillableAmount || 0).toFixed(2)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* New Dispute Dialog */}
      <Dialog open={newDisputeOpen} onOpenChange={setNewDisputeOpen}>
        <DialogContent className="sm:max-w-[450px] bg-card border-border">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-yellow-500" />
              File Call Dispute
            </DialogTitle>
            <DialogDescription>
              Select a billed connection from your recent calls and explain the billing discrepancy.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label className="text-xs">Select Billed Connection</Label>
              <Select value={selectedCallId} onValueChange={setSelectedCallId} disabled={recentCallsLoading}>
                <SelectTrigger className="border-border bg-background">
                  <SelectValue placeholder={recentCallsLoading ? "Loading calls..." : "Choose call..."} />
                </SelectTrigger>
                <SelectContent className="max-h-[200px]">
                  {recentCalls.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {new Date(c.createdAt).toLocaleDateString()} {new Date(c.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {formatPhoneNumber(c.callerId || '')} (${Number(c.buyerBillableAmount).toFixed(2)})
                    </SelectItem>
                  ))}
                  {recentCalls.length === 0 && !recentCallsLoading && (
                    <div className="py-2 px-3 text-xs text-muted-foreground text-center">No undisputed billable calls found</div>
                  )}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="reason" className="text-xs">Reason for Dispute</Label>
              <textarea
                id="reason"
                rows={4}
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                placeholder="Explain why this call was billed in error (e.g. wrong caller location, incorrect duration calculation, dead line, spam call...)"
                className="w-full rounded-md border border-border bg-background text-sm p-3 text-slate-100 placeholder-muted-foreground focus:border-primary outline-none transition-all"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewDisputeOpen(false)} disabled={submitting}>Cancel</Button>
            <Button onClick={handleSubmitDispute} disabled={submitting || !selectedCallId || !disputeReason.trim()}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Dispute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function GuardedBuyerDisputesPage() {
  return (
    <RoleGuard allowedRoles={['BUYER']}>
      <BuyerDisputesPage />
    </RoleGuard>
  );
}
