'use client';

import { Clock, DollarSign, Calendar, Loader2, Lock, Plus, Edit2, Save, X } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { apiClient } from '@/lib/api';
import { RoleGuard } from '@/components/auth/role-guard';


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
 <div className="h-full flex items-center justify-center">
 <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
 </div>
 );
 }

 return (
 <div className="h-full flex flex-col overflow-hidden">
 <div className="flex-shrink-0 mb-4">
 <h1 className="text-3xl font-bold">My Payroll</h1>
 <p className="text-muted-foreground">Track your hours and manage your earnings</p>
 </div>

 {/* Summary Cards */}
 <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6 flex-shrink-0">
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-medium text-muted-foreground">Pay Rate</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold">${summary?.payRate?.toFixed(2) || '0.00'}/hr</div>
 </CardContent>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-medium text-muted-foreground">
 Hours This Period
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold flex items-center gap-2">
 <Clock className="h-5 w-5 text-primary" />
 {summary?.totalHours?.toFixed(1) || '0'}
 </div>
 <div className="text-xs text-muted-foreground mt-1">
 {summary?.pendingHours?.toFixed(1) || '0'} pending,{' '}
 {summary?.paidHours?.toFixed(1) || '0'} paid
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-medium text-muted-foreground">
 Pending Earnings
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold text-amber-500 flex items-center gap-2">
 <DollarSign className="h-5 w-5" />
 {summary?.pendingEarnings?.toFixed(2) || '0.00'}
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-medium text-muted-foreground">
 Total Earned
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold text-green-500 flex items-center gap-2">
 <DollarSign className="h-5 w-5" />
 {summary?.paidEarnings?.toFixed(2) || '0.00'}
 </div>
 </CardContent>
 </Card>
 </div>

 <Tabs defaultValue="log-hours" className="flex-1 flex flex-col overflow-hidden min-h-0">
 <TabsList className="flex-shrink-0">
 <TabsTrigger value="log-hours">Log Hours</TabsTrigger>
 <TabsTrigger value="history">Time History</TabsTrigger>
 <TabsTrigger value="payouts">Payouts</TabsTrigger>
 <TabsTrigger value="banking">Banking Info</TabsTrigger>
 </TabsList>

 {/* Log Hours Tab */}
 <TabsContent value="log-hours" className="flex-1 overflow-auto">
 <Card>
 <CardHeader>
 <CardTitle>Log Your Hours</CardTitle>
 <CardDescription>Record your work hours for a specific date</CardDescription>
 </CardHeader>
 <CardContent>
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
 <Button onClick={() => void handleLogHours()} disabled={saving} className="mt-4">
 {saving ? (
 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
 ) : (
 <Plus className="mr-2 h-4 w-4" />
 )}
 Log Hours
 </Button>
 </CardContent>
 </Card>
 </TabsContent>

 {/* History Tab */}
 <TabsContent value="history" className="flex-1 overflow-auto">
 <Card className="h-full flex flex-col">
 <CardHeader className="flex-shrink-0">
 <CardTitle>Time Entry History</CardTitle>
 <CardDescription>View all your logged hours</CardDescription>
 </CardHeader>
 <CardContent className="flex-1 overflow-auto">
 {timeEntries.length === 0 ? (
 <div className="text-center py-12 text-muted-foreground">
 No time entries found. Start logging your hours!
 </div>
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
 <TableCell className="font-medium">
 <div className="flex items-center gap-2">
 <Calendar className="h-4 w-4 text-muted-foreground" />
 {new Date(entry.date).toLocaleDateString()}
 </div>
 </TableCell>
 <TableCell>{entry.hoursWorked.toFixed(2)}</TableCell>
 <TableCell className="text-muted-foreground">
 {entry.notes || '—'}
 </TableCell>
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
 </CardContent>
 </Card>
 </TabsContent>

 {/* Payouts Tab */}
 <TabsContent value="payouts" className="flex-1 overflow-auto">
 <Card className="h-full flex flex-col">
 <CardHeader className="flex-shrink-0">
 <CardTitle>Payout History</CardTitle>
 <CardDescription>View your completed and pending payouts</CardDescription>
 </CardHeader>
 <CardContent className="flex-1 overflow-auto">
 {payouts.length === 0 ? (
 <div className="text-center py-12 text-muted-foreground">
 No payouts yet. Your payouts will appear here once processed.
 </div>
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
 <TableCell className="font-medium">
 {new Date(payout.startDate).toLocaleDateString()} -{' '}
 {new Date(payout.endDate).toLocaleDateString()}
 </TableCell>
 <TableCell>{payout.totalHours.toFixed(1)}</TableCell>
 <TableCell className="font-medium">
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
 <TableCell>
 {payout.paidAt ? new Date(payout.paidAt).toLocaleDateString() : '—'}
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>
 )}
 </CardContent>
 </Card>
 </TabsContent>

 {/* Banking Tab */}
 <TabsContent value="banking" className="flex-1 overflow-auto">
 <Card>
 <CardHeader>
 <div className="flex items-center justify-between">
 <div>
 <CardTitle>Banking Information</CardTitle>
 <CardDescription>
 Your banking details for receiving payments (securely encrypted)
 </CardDescription>
 </div>
 {!editingBanking && (
 <Button variant="outline" onClick={() => setEditingBanking(true)}>
 <Edit2 className="mr-2 h-4 w-4" />
 {banking?.hasBankingInfo ? 'Update' : 'Add'} Banking Info
 </Button>
 )}
 </div>
 </CardHeader>
 <CardContent>
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
 <Button onClick={() => void handleSaveBanking()} disabled={saving}>
 {saving ? (
 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
 ) : (
 <Save className="mr-2 h-4 w-4" />
 )}
 Save Banking Info
 </Button>
 <Button variant="outline" onClick={() => setEditingBanking(false)}>
 <X className="mr-2 h-4 w-4" />
 Cancel
 </Button>
 </div>
 </div>
 ) : banking?.hasBankingInfo ? (
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <div>
 <p className="text-sm text-muted-foreground">Bank Name</p>
 <p className="font-medium">{banking.bankName}</p>
 </div>
 <div>
 <p className="text-sm text-muted-foreground">Routing Number</p>
 <p className="font-medium font-mono">{banking.routingNumber}</p>
 </div>
 <div>
 <p className="text-sm text-muted-foreground">Account Number</p>
 <p className="font-medium font-mono">{banking.maskedAccountNumber}</p>
 </div>
 </div>
 ) : (
 <div className="text-center py-8 text-muted-foreground">
 No banking information on file. Add your banking details to receive payments.
 </div>
 )}
 </CardContent>
 </Card>
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
