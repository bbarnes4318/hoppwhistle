'use client';

import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Calendar,
  CreditCard,
  DollarSign,
  FileText,
  Loader2,
  Receipt,
  Wallet,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { toast } from '@/components/ui/use-toast';
import { RoleGuard } from '@/components/auth/role-guard';

interface BuyerProfile {
  id: string;
  name: string;
  billingType: 'TERMS' | 'UPFRONT';
  walletBalance: number;
}

interface Transaction {
  id: string;
  amount: number;
  type: string;
  description: string;
  createdAt: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  period: { start: string; end: string };
  total: string;
  dueDate: string;
}

function BuyerWalletPage() {
  const { buyerId } = useAuth();
  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!buyerId) return;
    setLoading(true);
    try {
      // 1. Fetch Profile details
      const profileRes = await apiClient.get<BuyerProfile>(`/api/v1/buyers/${buyerId}`);
      const prof = profileRes.data;
      setProfile(prof);

      // 2. Fetch Transactions (deposits/debits)
      const txRes = await apiClient.get<{ data: Transaction[] }>(
        `/api/v1/buyers/${buyerId}/transactions?limit=25`
      );
      if (txRes.data?.data) {
        setTransactions(txRes.data.data);
      }

      // 3. Fetch Invoices (if TERMS buyer)
      if (prof?.billingType === 'TERMS') {
        const invRes = await apiClient.get<{ data: Invoice[] }>('/api/v1/billing/invoices?limit=10');
        if (invRes.data?.data) {
          setInvoices(invRes.data.data);
        }
      }
    } catch (err) {
      console.error('Failed to load billing data:', err);
      toast.error('Failed to load billing information');
    } finally {
      setLoading(false);
    }
  }, [buyerId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const isUpfront = profile?.billingType === 'UPFRONT';
  const balance = profile?.walletBalance || 0;
  const isLowBalance = isUpfront && balance < 100;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Billing & Wallet</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your account funds, view invoices, and review transaction history.
          </p>
        </div>
        <Button onClick={loadData} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      {/* Low Balance Alert */}
      {isLowBalance && (
        <Alert variant="destructive" className="bg-red-500/10 border-red-500/20 text-red-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Low Balance Warning</AlertTitle>
          <AlertDescription>
            Your wallet balance is below $100.00. Please recharge your wallet to prevent routing interruptions.
          </AlertDescription>
        </Alert>
      )}

      {/* Main KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {isUpfront ? 'Available Balance' : 'Outstanding Balance'}
            </CardTitle>
            {isUpfront ? <Wallet className="h-4 w-4 text-cyan-400" /> : <Receipt className="h-4 w-4 text-primary" />}
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold font-mono ${isUpfront ? (isLowBalance ? 'text-red-400' : 'text-cyan-400') : 'text-slate-100'}`}>
              {loading ? '...' : `$${Number(balance).toFixed(2)}`}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {isUpfront ? 'Pre-paid available call funds' : 'Current terms balance outstanding'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Billing Class</CardTitle>
            <CreditCard className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-slate-100">
              {loading ? '...' : isUpfront ? 'Upfront Wallet' : 'Terms Invoicing'}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {isUpfront ? 'Auto-debit per billable connection' : 'Periodic invoicing agreement'}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</CardTitle>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-xl font-bold text-emerald-400">
              Active
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              Authorized for campaign routing
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ledger Transactions */}
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader>
            <CardTitle>Transaction Ledger</CardTitle>
            <CardDescription>Recent debit and credit logs in your wallet.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border bg-muted/15">
                    <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Time</th>
                    <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Description</th>
                    <th className="p-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">Type</th>
                    <th className="p-4 text-right text-xs font-semibold uppercase tracking-wider text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                        <div className="flex items-center justify-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                          <span>Loading transaction history...</span>
                        </div>
                      </td>
                    </tr>
                  ) : transactions.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-12 text-center text-sm text-muted-foreground">
                        No transactions registered yet.
                      </td>
                    </tr>
                  ) : (
                    transactions.map(tx => {
                      const isDebit = tx.type === 'DEBIT';
                      return (
                        <tr key={tx.id} className="hover:bg-muted/30 transition-colors duration-150">
                          <td className="p-4 font-mono text-xs text-muted-foreground">
                            {new Date(tx.createdAt).toLocaleString()}
                          </td>
                          <td className="p-4 text-xs text-slate-200">
                            {tx.description}
                          </td>
                          <td className="p-4">
                            <Badge variant={isDebit ? 'destructive' : 'success'} className="text-[10px] font-semibold uppercase">
                              {tx.type}
                            </Badge>
                          </td>
                          <td className={`p-4 text-right font-mono text-xs font-semibold ${isDebit ? 'text-red-400' : 'text-emerald-400'}`}>
                            {isDebit ? '-' : '+'}${Number(tx.amount).toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Invoice List (Visible if TERMS) */}
        {!isUpfront && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Invoices</CardTitle>
              <CardDescription>Billed period invoice statements.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto text-primary" />
                </div>
              ) : invoices.length === 0 ? (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  No invoices available yet.
                </div>
              ) : (
                invoices.map(inv => (
                  <div key={inv.id} className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/5">
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div>
                        <div className="text-xs font-bold text-slate-200">{inv.invoiceNumber}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          Due: {new Date(inv.dueDate).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold font-mono text-slate-100">${Number(inv.total).toFixed(2)}</div>
                      <Badge variant={inv.status === 'paid' ? 'success' : 'warning'} className="text-[10px] uppercase mt-1 font-semibold">
                        {inv.status}
                      </Badge>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        )}

        {/* Quick Recharge Info (Visible if UPFRONT) */}
        {isUpfront && (
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle>Top-Up Wallet</CardTitle>
              <CardDescription>Add credits to your call balance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Alert className="bg-cyan-500/10 border-cyan-500/20 text-cyan-400">
                <Wallet className="h-4 w-4" />
                <AlertTitle>Prepaid Billing</AlertTitle>
                <AlertDescription className="text-xs">
                  Your wallet is charged in real-time. To recharge, please coordinate with your platform account manager.
                </AlertDescription>
              </Alert>
              <div className="text-xs text-muted-foreground leading-relaxed">
                Recharges are processed via credit card or bank wire and credit instantly to your transaction ledger.
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function GuardedBuyerWalletPage() {
  return (
    <RoleGuard allowedRoles={['BUYER']}>
      <BuyerWalletPage />
    </RoleGuard>
  );
}
