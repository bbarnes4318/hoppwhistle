'use client';

import {
 DollarSign,
 Loader2,
 AlertCircle,
 CheckCircle,
 Users,
 Clock,
 Save,
 Calendar,
 Play,
 Pencil,
} from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
 Dialog,
 DialogContent,
 DialogDescription,
 DialogHeader,
 DialogTitle,
 DialogFooter,
} from '@/components/ui/dialog';
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
import { toast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';

interface PayrollEntry {
 userId: string;
 userName: string;
 userEmail: string;
 totalHours: number;
 payRate: number;
 totalDue: number;
 hasBankingInfo: boolean;
}

interface PayrollReport {
 period: {
 startDate: string;
 endDate: string;
 };
 summary: {
 totalEmployees: number;
 totalHours: number;
 totalLiability: number;
 };
 data: PayrollEntry[];
}

interface ValidationResult {
 valid: boolean;
 errors: string[];
}

export default function AdminPayrollPage() {
 const [report, setReport] = useState<PayrollReport | null>(null);
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);

 // Date range filters (default to current month)
 const now = new Date();
 const [startDate, setStartDate] = useState(
 new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
 );
 const [endDate, setEndDate] = useState(
 new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]
 );

 // Pay rate editing
 const [editingUserId, setEditingUserId] = useState<string | null>(null);
 const [editPayRate, setEditPayRate] = useState('');

 // Payout creation dialog
 const [payoutDialogOpen, setPayoutDialogOpen] = useState(false);
 const [selectedUser, setSelectedUser] = useState<PayrollEntry | null>(null);
 const [validation, setValidation] = useState<ValidationResult | null>(null);
 const [creating, setCreating] = useState(false);

 const loadReport = useCallback(async () => {
 setLoading(true);
 try {
 const response = await apiClient.get<PayrollReport>(
 `/api/v1/admin/payroll-report?startDate=${startDate}&endDate=${endDate}`
 );
 if (response.data) {
 setReport(response.data);
 }
 } catch (err) {
 console.error('Failed to load payroll report:', err);
 } finally {
 setLoading(false);
 }
 }, [startDate, endDate]);

 useEffect(() => {
 void loadReport();
 }, [loadReport]);

 const handleSavePayRate = async (userId: string) => {
 const rate = parseFloat(editPayRate);
 if (isNaN(rate) || rate < 0) {
 toast.warning('Invalid Rate', 'Please enter a valid pay rate');
 return;
 }

 setSaving(true);
 try {
 const response = await apiClient.post('/api/v1/admin/set-pay-rate', {
 userId,
 payRate: rate,
 });

 if (response.error) {
 toast.error('Failed to Save', response.error.message);
 } else {
 toast.success('Pay Rate Updated', `New rate: $${rate.toFixed(2)}/hr`);
 setEditingUserId(null);
 await loadReport();
 }
 } catch (err) {
 toast.error('Error', err instanceof Error ? err.message : 'Unknown error');
 } finally {
 setSaving(false);
 }
 };

 const handleOpenPayoutDialog = async (entry: PayrollEntry) => {
 setSelectedUser(entry);
 setPayoutDialogOpen(true);

 // Validate the user
 try {
 const response = await apiClient.post<ValidationResult>('/api/v1/admin/validate-payroll', {
 userIds: [entry.userId],
 });
 if (response.data) {
 setValidation(response.data);
 }
 } catch (err) {
 setValidation({ valid: false, errors: ['Failed to validate user'] });
 }
 };

 const handleCreatePayout = async () => {
 if (!selectedUser) return;

 setCreating(true);
 try {
 const response = await apiClient.post('/api/v1/admin/payouts', {
 userId: selectedUser.userId,
 startDate,
 endDate,
 });

 if (response.error) {
 toast.error('Failed to Create Payout', response.error.message);
 } else {
 setPayoutDialogOpen(false);
 setSelectedUser(null);
 await loadReport();
 toast.success(
 'Payout Created',
 `$${selectedUser.totalDue.toFixed(2)} payout created for ${selectedUser.userName}. Time entries have been locked.`
 );
 }
 } catch (err) {
 toast.error('Error', err instanceof Error ? err.message : 'Unknown error');
 } finally {
 setCreating(false);
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
 <h1 className="text-3xl font-bold">Payroll Administration</h1>
 <p className="text-muted-foreground">
 Manage contractor payments and view payroll liability
 </p>
 </div>

 {/* Summary Cards */}
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6 flex-shrink-0">
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-medium text-muted-foreground">
 Active Contractors
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold flex items-center gap-2">
 <Users className="h-5 w-5 text-primary" />
 {report?.summary.totalEmployees || 0}
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-medium text-muted-foreground">Total Hours</CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold flex items-center gap-2">
 <Clock className="h-5 w-5 text-blue-500" />
 {report?.summary.totalHours?.toFixed(1) || '0'}
 </div>
 </CardContent>
 </Card>
 <Card>
 <CardHeader className="pb-2">
 <CardTitle className="text-sm font-medium text-muted-foreground">
 Total Liability
 </CardTitle>
 </CardHeader>
 <CardContent>
 <div className="text-2xl font-bold text-amber-500 flex items-center gap-2">
 <DollarSign className="h-5 w-5" />
 {report?.summary.totalLiability?.toFixed(2) || '0.00'}
 </div>
 </CardContent>
 </Card>
 </div>

 {/* Date Range Filter */}
 <Card className="flex-shrink-0 mb-4">
 <CardHeader className="py-3">
 <div className="flex items-center gap-4">
 <div className="flex items-center gap-2">
 <Calendar className="h-4 w-4 text-muted-foreground" />
 <Label>Pay Period:</Label>
 </div>
 <div className="flex items-center gap-2">
 <Input
 type="date"
 value={startDate}
 onChange={e => setStartDate(e.target.value)}
 className="w-40"
 />
 <span className="text-muted-foreground">to</span>
 <Input
 type="date"
 value={endDate}
 onChange={e => setEndDate(e.target.value)}
 className="w-40"
 />
 </div>
 <Button variant="outline" onClick={() => void loadReport()}>
 Refresh
 </Button>
 </div>
 </CardHeader>
 </Card>

 {/* Payroll Table */}
 <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
 <CardHeader className="flex-shrink-0">
 <CardTitle>Contractor Payroll</CardTitle>
 <CardDescription>
 View and manage pay rates for all contractors with logged hours
 </CardDescription>
 </CardHeader>
 <CardContent className="flex-1 overflow-auto">
 {report?.data.length === 0 ? (
 <div className="text-center py-12 text-muted-foreground">
 No contractors with logged hours in this period.
 </div>
 ) : (
 <Table>
 <TableHeader>
 <TableRow>
 <TableHead>Contractor</TableHead>
 <TableHead>Email</TableHead>
 <TableHead className="text-right">Hours</TableHead>
 <TableHead className="text-right">Pay Rate</TableHead>
 <TableHead className="text-right">Total Due</TableHead>
 <TableHead>Banking</TableHead>
 <TableHead className="text-right">Actions</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {report?.data.map(entry => (
 <TableRow key={entry.userId}>
 <TableCell className="font-medium">{entry.userName}</TableCell>
 <TableCell className="text-muted-foreground">{entry.userEmail}</TableCell>
 <TableCell className="text-right">{entry.totalHours.toFixed(1)}</TableCell>
 <TableCell className="text-right">
 {editingUserId === entry.userId ? (
 <div className="flex items-center justify-end gap-2">
 <span>$</span>
 <Input
 type="number"
 min="0"
 step="0.01"
 value={editPayRate}
 onChange={e => setEditPayRate(e.target.value)}
 className="w-24"
 autoFocus
 />
 <Button
 size="sm"
 onClick={() => void handleSavePayRate(entry.userId)}
 disabled={saving}
 >
 {saving ? (
 <Loader2 className="h-4 w-4 animate-spin" />
 ) : (
 <Save className="h-4 w-4" />
 )}
 </Button>
 <Button size="sm" variant="ghost" onClick={() => setEditingUserId(null)}>
 ✕
 </Button>
 </div>
 ) : (
 <div className="flex items-center justify-end gap-2">
 {entry.payRate === 0 ? (
 <Badge variant="destructive" className="gap-1">
 <AlertCircle className="h-3 w-3" />
 Not Set
 </Badge>
 ) : (
 <span className="font-medium">${entry.payRate.toFixed(2)}/hr</span>
 )}
 <Button
 size="sm"
 variant="ghost"
 className="h-7 w-7 p-0"
 onClick={() => {
 setEditingUserId(entry.userId);
 setEditPayRate(entry.payRate.toString());
 }}
 title="Edit pay rate"
 >
 <Pencil className="h-3 w-3" />
 </Button>
 </div>
 )}
 </TableCell>
 <TableCell className="text-right font-medium">
 ${entry.totalDue.toFixed(2)}
 </TableCell>
 <TableCell>
 {entry.hasBankingInfo ? (
 <Badge variant="success" className="gap-1">
 <CheckCircle className="h-3 w-3" />
 On File
 </Badge>
 ) : (
 <Badge variant="destructive" className="gap-1">
 <AlertCircle className="h-3 w-3" />
 Missing
 </Badge>
 )}
 </TableCell>
 <TableCell className="text-right">
 <Button
 size="sm"
 variant={!entry.hasBankingInfo || entry.payRate === 0 ? 'ghost' : 'outline'}
 onClick={() => void handleOpenPayoutDialog(entry)}
 disabled={!entry.hasBankingInfo || entry.payRate === 0}
 title={
 entry.payRate === 0
 ? 'Set pay rate first'
 : !entry.hasBankingInfo
 ? 'User must add banking info'
 : 'Create payout for this contractor'
 }
 >
 <Play className="h-4 w-4 mr-1" />
 Create Payout
 </Button>
 </TableCell>
 </TableRow>
 ))}
 </TableBody>
 </Table>
 )}
 </CardContent>
 </Card>

 {/* Payout Creation Dialog */}
 <Dialog open={payoutDialogOpen} onOpenChange={setPayoutDialogOpen}>
 <DialogContent>
 <DialogHeader>
 <DialogTitle>Create Payout</DialogTitle>
 <DialogDescription>
 This will finalize and lock all time entries for the selected period.
 </DialogDescription>
 </DialogHeader>

 {selectedUser && (
 <div className="space-y-4">
 <div className="grid grid-cols-2 gap-4 p-4 bg-muted rounded-lg">
 <div>
 <p className="text-sm text-muted-foreground">Contractor</p>
 <p className="font-medium">{selectedUser.userName}</p>
 </div>
 <div>
 <p className="text-sm text-muted-foreground">Period</p>
 <p className="font-medium">
 {new Date(startDate).toLocaleDateString()} -{' '}
 {new Date(endDate).toLocaleDateString()}
 </p>
 </div>
 <div>
 <p className="text-sm text-muted-foreground">Total Hours</p>
 <p className="font-medium">{selectedUser.totalHours.toFixed(1)}</p>
 </div>
 <div>
 <p className="text-sm text-muted-foreground">Total Amount</p>
 <p className="font-medium text-lg">${selectedUser.totalDue.toFixed(2)}</p>
 </div>
 </div>

 {validation && (
 <div
 className={`p-4 rounded-lg ${
 validation.valid
 ? 'bg-green-500/10 text-green-600'
 : 'bg-red-500/10 text-red-600'
 }`}
 >
 {validation.valid ? (
 <div className="flex items-center gap-2">
 <CheckCircle className="h-5 w-5" />
 <span>Validation passed. Ready to create payout.</span>
 </div>
 ) : (
 <div>
 <div className="flex items-center gap-2 mb-2">
 <AlertCircle className="h-5 w-5" />
 <span className="font-medium">Validation failed:</span>
 </div>
 <ul className="list-disc list-inside">
 {validation.errors.map((error, i) => (
 <li key={i}>{error}</li>
 ))}
 </ul>
 </div>
 )}
 </div>
 )}
 </div>
 )}

 <DialogFooter>
 <Button variant="outline" onClick={() => setPayoutDialogOpen(false)}>
 Cancel
 </Button>
 <Button
 onClick={() => void handleCreatePayout()}
 disabled={creating || !validation?.valid}
 >
 {creating ? (
 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
 ) : (
 <DollarSign className="mr-2 h-4 w-4" />
 )}
 Create Payout
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 </div>
 );
}

