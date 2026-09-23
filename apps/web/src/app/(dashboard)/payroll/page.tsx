'use client';

import { Clock, DollarSign, Calendar, Loader2, Lock, Plus, Edit2, Save, X } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import {
  EmptyState,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  StatTile,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { useReadOnlyPreview } from '@/hooks/use-read-only-preview';
import { apiClient } from '@/lib/api';

interface TimeEntry {
  id: string;
  date: string;
  hoursWorked: number;
  notes: string | null;
  isLocked: boolean;
  payrollPayoutId: string | null;
}

interface EarningsSummary {
  totalHours: number;
  pendingHours: number;
  paidHours: number;
  payRate: number;
  estimatedEarnings: number;
  pendingEarnings: number;
  paidEarnings: number;
}

interface BankingInfo {
  hasBankingInfo: boolean;
  maskedAccountNumber: string | null;
  bankName: string | null;
  routingNumber: string | null;
  accountNumber: string | null;
  payRate: number;
}

interface Payout {
  id: string;
  startDate: string;
  endDate: string;
  totalHours: number;
  totalAmount: number;
  status: string;
  paidAt: string | null;
  entriesCount: number;
}

function PayrollPage() {
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [summary, setSummary] = useState<EarningsSummary | null>(null);
  const [banking, setBanking] = useState<BankingInfo | null>(null);
  const [payouts, setPayouts] = useState<Payout[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // A read-only role preview cannot clock hours or save bank details. Disabled
  // with a reason, so the operator is not told by a 403. See the hook.
  const { readOnly, disabledProps: readOnlyProps } = useReadOnlyPreview();

  // New entry form
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newHours, setNewHours] = useState('8');
  const [newNotes, setNewNotes] = useState('');

  // Banking form
  const [editingBanking, setEditingBanking] = useState(false);
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [entriesRes, summaryRes, bankingRes, payoutsRes] = await Promise.all([
        apiClient.get<{ data: TimeEntry[] }>('/api/v1/time-entries/me'),
        apiClient.get<EarningsSummary>('/api/v1/time-entries/me/summary'),
        apiClient.get<BankingInfo>('/api/v1/user/banking'),
        apiClient.get<{ data: Payout[] }>('/api/v1/user/payouts'),
      ]);

      if (entriesRes.data?.data) setTimeEntries(entriesRes.data.data);
      if (summaryRes.data) setSummary(summaryRes.data);
      if (bankingRes.data) {
        setBanking(bankingRes.data);
        if (bankingRes.data.bankName) setBankName(bankingRes.data.bankName);
      }
      if (payoutsRes.data?.data) setPayouts(payoutsRes.data.data);
    } catch (err) {
      console.error('Failed to load payroll data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleLogHours = async () => {
    if (!newHours || parseFloat(newHours) <= 0) {
      toast.warning('Invalid Hours', 'Please enter a valid number of hours');
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.post('/api/v1/time-entries', {
        date: newDate,
        hoursWorked: parseFloat(newHours),
        notes: newNotes || undefined,
      });

      if (response.error) {
        toast.error('Failed to Log Hours', response.error.message);
      } else {
        toast.success(
          'Hours Logged',
          `${newHours} hours logged for ${new Date(newDate).toLocaleDateString()}`
        );
        setNewHours('8');
        setNewNotes('');
        await loadData();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Error', message);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBanking = async () => {
    if (!bankName || !accountNumber || !routingNumber) {
      toast.warning('Missing Information', 'All banking fields are required');
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.put('/api/v1/user/banking', {
        bankName,
        accountNumber,
        routingNumber,
      });

      if (response.error) {
        toast.error('Failed to Save', response.error.message);
      } else {
        toast.success(
          'Banking Info Saved',
          'Your banking information has been securely encrypted and saved.'
        );
        setEditingBanking(false);
        await loadData();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error('Error', message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-canvas min-h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-ink-3" />
      </div>
    );
  }

  return (
    <div className="page-canvas">
      <PageHeader description="Track your hours and manage your earnings" />

      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label="Pay Rate"
          icon={DollarSign}
          figure={<>${summary?.payRate?.toFixed(2) || '0.00'}/hr</>}
        />
        <StatTile
          label="Hours This Period"
          icon={Clock}
          figure={summary?.totalHours?.toFixed(1) || '0'}
          sub={
            <>
              {summary?.pendingHours?.toFixed(1) || '0'} pending,{' '}
              {summary?.paidHours?.toFixed(1) || '0'} paid
            </>
          }
        />
        <StatTile
          label="Pending Earnings"
          icon={DollarSign}
          figure={
            <span className="text-ringing-ink">
              {summary?.pendingEarnings?.toFixed(2) || '0.00'}
            </span>
          }
        />
        <StatTile
          label="Total Earned"
          icon={DollarSign}
          tone="money"
          figure={summary?.paidEarnings?.toFixed(2) || '0.00'}
        />
      </div>

      <Tabs defaultValue="log-hours" className="min-w-0">
        <TabsList>
          <TabsTrigger value="log-hours">Log Hours</TabsTrigger>
          <TabsTrigger value="history">Time History</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
          <TabsTrigger value="banking">Banking Info</TabsTrigger>
        </TabsList>

        {/* Log Hours Tab */}
        <TabsContent value="log-hours">
          <Panel>
            <PanelHeader>
              <PanelTitle>Log Your Hours</PanelTitle>
              <PanelDescription>Record your work hours for a specific date</PanelDescription>
            </PanelHeader>
            <PanelBody>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Date</Label>
                  <Input
                    id="date"
                    type="date"
                    value={newDate}
                    onChange={e => setNewDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="hours">Hours Worked</Label>
                  <Input
                    id="hours"
                    type="number"
                    min="0.25"
                    max="24"
                    step="0.25"
                    value={newHours}
                    onChange={e => setNewHours(e.target.value)}
                    placeholder="8.0"
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="notes">Notes (optional)</Label>
                  <Input
                    id="notes"
                    value={newNotes}
                    onChange={e => setNewNotes(e.target.value)}
                    placeholder="Project or task description"
                  />
                </div>
              </div>
              <Button
                onClick={() => void handleLogHours()}
                disabled={saving || readOnly}
                title={readOnlyProps.title}
                className="mt-5"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                Log Hours
              </Button>
            </PanelBody>
          </Panel>
        </TabsContent>

        {/* History Tab */}
        <TabsContent value="history">
          <Panel className="min-w-0">
            <PanelHeader>
              <PanelTitle>Time Entry History</PanelTitle>
              <PanelDescription>View all your logged hours</PanelDescription>
            </PanelHeader>
            <PanelBody flush className="overflow-x-auto">
              {timeEntries.length === 0 ? (
                <EmptyState
                  icon={Calendar}
                  headline="No time entries found. Start logging your hours!"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {timeEntries.map(entry => (
                      <TableRow key={entry.id}>
                        <TableCell className="whitespace-nowrap font-medium text-ink">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-ink-3" />
                            {new Date(entry.date).toLocaleDateString()}
                          </div>
                        </TableCell>
                        <TableCell className="t-num text-ink">
                          {entry.hoursWorked.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-ink-2">{entry.notes || '—'}</TableCell>
                        <TableCell>
                          {entry.isLocked ? (
                            <Badge variant="secondary" className="gap-1">
                              <Lock className="h-3 w-3" />
                              Finalized
                            </Badge>
                          ) : (
                            <Badge variant="outline">Pending</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PanelBody>
          </Panel>
        </TabsContent>

        {/* Payouts Tab */}
        <TabsContent value="payouts">
          <Panel className="min-w-0">
            <PanelHeader>
              <PanelTitle>Payout History</PanelTitle>
              <PanelDescription>View your completed and pending payouts</PanelDescription>
            </PanelHeader>
            <PanelBody flush className="overflow-x-auto">
              {payouts.length === 0 ? (
                <EmptyState
                  icon={DollarSign}
                  headline="No payouts yet. Your payouts will appear here once processed."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Hours</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Paid Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payouts.map(payout => (
                      <TableRow key={payout.id}>
                        <TableCell className="t-data whitespace-nowrap text-ink">
                          {new Date(payout.startDate).toLocaleDateString()} -{' '}
                          {new Date(payout.endDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="t-num text-ink">
                          {payout.totalHours.toFixed(1)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-medium tabular-nums text-money-ink">
                          ${payout.totalAmount.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              payout.status === 'PAID'
                                ? 'success'
                                : payout.status === 'PROCESSING'
                                  ? 'default'
                                  : 'secondary'
                            }
                          >
                            {payout.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="t-data whitespace-nowrap text-ink-2">
                          {payout.paidAt ? new Date(payout.paidAt).toLocaleDateString() : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PanelBody>
          </Panel>
        </TabsContent>

        {/* Banking Tab */}
        <TabsContent value="banking">
          <Panel>
            <PanelHeader
              action={
                !editingBanking && (
                  <Button
                    variant="outline"
                    onClick={() => setEditingBanking(true)}
                    disabled={readOnly}
                    title={readOnlyProps.title}
                  >
                    <Edit2 className="h-4 w-4" />
                    {banking?.hasBankingInfo ? 'Update' : 'Add'} Banking Info
                  </Button>
                )
              }
            >
              <PanelTitle>Banking Information</PanelTitle>
              <PanelDescription>
                Your banking details for receiving payments (securely encrypted)
              </PanelDescription>
            </PanelHeader>
            <PanelBody>
              {editingBanking ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="bankName">Bank Name</Label>
                      <Input
                        id="bankName"
                        value={bankName}
                        onChange={e => setBankName(e.target.value)}
                        placeholder="Chase, Bank of America, etc."
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="routingNumber">Routing Number</Label>
                      <Input
                        id="routingNumber"
                        value={routingNumber}
                        onChange={e => setRoutingNumber(e.target.value)}
                        placeholder="9-digit routing number"
                        maxLength={9}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="accountNumber">Account Number</Label>
                      <Input
                        id="accountNumber"
                        value={accountNumber}
                        onChange={e => setAccountNumber(e.target.value)}
                        placeholder="Your account number"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => void handleSaveBanking()}
                      disabled={saving || readOnly}
                      title={readOnlyProps.title}
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
                      Save Banking Info
                    </Button>
                    <Button variant="outline" onClick={() => setEditingBanking(false)}>
                      <X className="h-4 w-4" />
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : banking?.hasBankingInfo ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div className="min-w-0">
                    <p className="t-label text-ink-3">Bank Name</p>
                    <p className="mt-1 font-medium text-ink">{banking.bankName}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="t-label text-ink-3">Routing Number</p>
                    <p className="t-data mt-1 text-ink">{banking.routingNumber}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="t-label text-ink-3">Account Number</p>
                    <p className="t-data mt-1 text-ink">{banking.maskedAccountNumber}</p>
                  </div>
                </div>
              ) : (
                <EmptyState headline="No banking information on file. Add your banking details to receive payments." />
              )}
            </PanelBody>
          </Panel>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function GuardedPayrollPage() {
  return (
    <RoleGuard allowedRoles={['AGENT', 'ADMIN', 'OWNER']}>
      <PayrollPage />
    </RoleGuard>
  );
}
