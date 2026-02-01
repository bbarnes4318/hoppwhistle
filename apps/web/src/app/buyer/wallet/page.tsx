'use client';

import {
  ArrowDownLeft,
  ArrowUpRight,
  CreditCard,
  DollarSign,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Transaction {
  id: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  description: string;
  createdAt: string;
}

interface WalletData {
  balance: number;
  pendingCharges: number;
  billingType: 'UPFRONT' | 'TERMS';
  lastTopUp: string | null;
  transactions: Transaction[];
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchWallet = async () => {
      setLoading(true);
      try {
        // In production, fetch from /api/v1/buyers/:buyerId/transactions
        await new Promise(r => setTimeout(r, 500));
        setWallet({
          balance: 1250,
          pendingCharges: 45,
          billingType: 'UPFRONT',
          lastTopUp: new Date(Date.now() - 86400000 * 3).toISOString(),
          transactions: [
            {
              id: '1',
              type: 'DEBIT',
              amount: -1,
              description: 'Call from +15551234567 (FL)',
              createdAt: new Date(Date.now() - 3600000).toISOString(),
            },
            {
              id: '2',
              type: 'DEBIT',
              amount: -1,
              description: 'Call from +15559876543 (GA)',
              createdAt: new Date(Date.now() - 7200000).toISOString(),
            },
            {
              id: '3',
              type: 'CREDIT',
              amount: 100,
              description: 'Admin credit - Top up',
              createdAt: new Date(Date.now() - 86400000).toISOString(),
            },
            {
              id: '4',
              type: 'DEBIT',
              amount: -1,
              description: 'Call from +15555551212 (CA)',
              createdAt: new Date(Date.now() - 172800000).toISOString(),
            },
            {
              id: '5',
              type: 'CREDIT',
              amount: 500,
              description: 'Admin credit - Initial deposit',
              createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
            },
          ],
        });
      } catch (error) {
        console.error('Failed to fetch wallet:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchWallet();
  }, []);

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Wallet className="h-6 w-6" />
          Wallet
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your lead balance and view transaction history
        </p>
      </div>

      {/* Balance Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Current Balance */}
        <Card className="col-span-2 bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardHeader>
            <CardTitle className="text-lg">Lead Balance</CardTitle>
            <CardDescription>Your current available leads</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-12 w-32" />
            ) : (
              <div className="flex items-baseline gap-2">
                <span className="text-5xl font-bold text-primary">
                  {wallet?.balance.toLocaleString()}
                </span>
                <span className="text-lg text-muted-foreground">leads</span>
              </div>
            )}
            {wallet?.pendingCharges && wallet.pendingCharges > 0 && (
              <p className="text-sm text-muted-foreground mt-2">
                {wallet.pendingCharges} leads pending
              </p>
            )}
          </CardContent>
        </Card>

        {/* Billing Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Account Type</CardTitle>
            <CardDescription>Your billing arrangement</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <Badge
                  variant="outline"
                  className={
                    wallet?.billingType === 'UPFRONT'
                      ? 'bg-blue-500/10 text-blue-500 border-blue-500/30'
                      : 'bg-amber-500/10 text-amber-500 border-amber-500/30'
                  }
                >
                  <CreditCard className="h-3 w-3 mr-1" />
                  {wallet?.billingType === 'UPFRONT' ? 'Prepaid' : 'Net Terms'}
                </Badge>
                {wallet?.lastTopUp && (
                  <p className="text-xs text-muted-foreground mt-3">
                    Last top-up: {new Date(wallet.lastTopUp).toLocaleDateString()}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Need More Leads CTA */}
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-between p-6">
          <div>
            <h3 className="font-semibold">Need more leads?</h3>
            <p className="text-sm text-muted-foreground">
              Contact your account manager to top up your balance.
            </p>
          </div>
          <Button variant="outline" asChild>
            <a href="mailto:support@hopwhistle.com">
              <DollarSign className="h-4 w-4 mr-2" />
              Request Top-Up
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Transaction History */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Transaction History</CardTitle>
              <CardDescription>Your recent credits and debits</CardDescription>
            </div>
            <Button variant="outline" size="icon">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]"></TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-8 w-8 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-48" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                  </TableRow>
                ))
              ) : wallet?.transactions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                    <Wallet className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No transactions yet.</p>
                  </TableCell>
                </TableRow>
              ) : (
                wallet?.transactions.map(tx => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full ${
                          tx.type === 'CREDIT'
                            ? 'bg-green-500/10 text-green-500'
                            : 'bg-red-500/10 text-red-500'
                        }`}
                      >
                        {tx.type === 'CREDIT' ? (
                          <ArrowDownLeft className="h-4 w-4" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4" />
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="font-medium">{tx.description}</p>
                      <p className="text-xs text-muted-foreground">
                        {tx.type === 'CREDIT' ? 'Credit' : 'Debit'}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="text-sm">{new Date(tx.createdAt).toLocaleDateString()}</p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(tx.createdAt).toLocaleTimeString()}
                      </p>
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={`font-mono font-medium ${
                          tx.amount > 0 ? 'text-green-500' : 'text-red-500'
                        }`}
                      >
                        {tx.amount > 0 ? '+' : ''}
                        {tx.amount}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
