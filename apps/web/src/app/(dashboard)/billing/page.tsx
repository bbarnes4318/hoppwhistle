'use client';

import {
  ArrowDownCircle,
  ArrowUpCircle,
  DollarSign,
  Download,
  Loader2,
  RefreshCw,
  TrendingUp,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
import { cn, formatCurrency, formatDate } from '@/lib/utils';

interface Invoice {
  id: string;
  invoiceNumber: string;
  status: string;
  period: { start: string; end: string };
  total: string;
  dueDate: string;
  paidAt: string | null;
}

interface Balance {
  billingAccountId: string | null;
  currency: string;
  available: string;
  pending: string;
  held: string;
  total: string;
}

interface BuyerOption {
  id: string;
  name: string;
  code: string;
  billingType: string;
}

interface BuyerTransaction {
  id: string;
  amount: number;
  type: 'CREDIT' | 'DEBIT';
  description: string;
  callId: string | null;
  createdByEmail?: string;
  createdAt: string;
}

interface TransactionsResponse {
  buyer: {
    id: string;
    name: string;
    code: string;
    publisherName: string;
    billingType: string;
    leadsRemaining: number;
    status: string;
  };
  data: BuyerTransaction[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface BuyersResponse {
  data: BuyerOption[];
}

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Transaction ledger state
  const [buyers, setBuyers] = useState<BuyerOption[]>([]);
  const [selectedBuyerId, setSelectedBuyerId] = useState<string>('');
  const [transactions, setTransactions] = useState<BuyerTransaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionTotalPages, setTransactionTotalPages] = useState(1);
  const [buyerInfo, setBuyerInfo] = useState<TransactionsResponse['buyer'] | null>(null);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');

  const loadBillingData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invoicesResponse, balanceResponse, buyersResponse] = await Promise.all([
        apiClient.get<{ data: Invoice[]; meta: { page: number; limit: number; total: number } }>(
          '/api/v1/billing/invoices'
        ),
        apiClient.get<Balance>('/api/v1/billing/balance'),
        apiClient.get<BuyersResponse>('/api/v1/buyers?billingType=UPFRONT&limit=100'),
      ]);

      if (invoicesResponse.data) {
        setInvoices(invoicesResponse.data.data || []);
      }
      if (balanceResponse.data) {
        setBalance(balanceResponse.data);
      }
      if (buyersResponse.data) {
        setBuyers(buyersResponse.data.data || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTransactions = useCallback(async () => {
    if (!selectedBuyerId) {
      setTransactions([]);
      setBuyerInfo(null);
      return;
    }

    setTransactionsLoading(true);
    try {
      const params = new URLSearchParams({
        page: transactionPage.toString(),
        limit: '25',
      });
      if (startDate) params.append('startDate', new Date(startDate).toISOString());
      if (endDate) params.append('endDate', new Date(endDate).toISOString());

      const response = await apiClient.get<TransactionsResponse>(
        `/api/v1/buyers/${selectedBuyerId}/transactions?${params.toString()}`
      );
      if (response.data) {
        setTransactions(response.data.data);
        setBuyerInfo(response.data.buyer);
        setTransactionTotalPages(response.data.meta.totalPages);
      }
    } catch (err) {
      console.error('Failed to load transactions:', err);
    } finally {
      setTransactionsLoading(false);
    }
  }, [selectedBuyerId, transactionPage, startDate, endDate]);

  useEffect(() => {
    void loadBillingData();
  }, [loadBillingData]);

  useEffect(() => {
    void loadTransactions();
  }, [loadTransactions]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Billing</h1>
          <p className="text-muted-foreground">Manage invoices, balances, and payouts</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Billing</h1>
        <p className="text-muted-foreground">Manage invoices, balances, and payouts</p>
      </div>

      {error && (
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-destructive">Error: {error}</div>
          </CardContent>
        </Card>
      )}

      {/* Balance Cards */}
      {balance && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Available Balance</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(parseFloat(balance.available))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatCurrency(parseFloat(balance.pending))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Held</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(parseFloat(balance.held))}</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Buyer Transaction Ledger */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Buyer Transaction Ledger</CardTitle>
              <CardDescription>View credit and debit history for Upfront buyers</CardDescription>
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => void loadTransactions()}
              disabled={transactionsLoading || !selectedBuyerId}
            >
              <RefreshCw className={cn('h-4 w-4', transactionsLoading && 'animate-spin')} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-4">
            <div className="w-64">
              <Select
                value={selectedBuyerId}
                onValueChange={id => {
                  setSelectedBuyerId(id);
                  setTransactionPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a buyer..." />
                </SelectTrigger>
                <SelectContent>
                  {buyers.map(buyer => (
                    <SelectItem key={buyer.id} value={buyer.id}>
                      {buyer.name} ({buyer.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                value={startDate}
                onChange={e => setStartDate(e.target.value)}
                className="w-40"
                placeholder="Start Date"
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={e => setEndDate(e.target.value)}
                className="w-40"
                placeholder="End Date"
              />
            </div>
          </div>

          {/* Buyer Info */}
          {buyerInfo && (
            <div className="flex items-center gap-6 mb-4 p-3 bg-muted/30 rounded-lg">
              <div>
                <div className="text-sm text-muted-foreground">Buyer</div>
                <div className="font-semibold">{buyerInfo.name}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Publisher</div>
                <div>{buyerInfo.publisherName}</div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Current Balance</div>
                <div className="font-mono font-semibold">
                  {buyerInfo.leadsRemaining.toLocaleString()} leads
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Status</div>
                <Badge variant={buyerInfo.status === 'ACTIVE' ? 'default' : 'secondary'}>
                  {buyerInfo.status}
                </Badge>
              </div>
            </div>
          )}

          {/* Transactions Table */}
          {!selectedBuyerId ? (
            <div className="text-center py-8 text-muted-foreground">
              Select a buyer to view their transaction history
            </div>
          ) : transactionsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No transactions found</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Created By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map(tx => (
                    <TableRow key={tx.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(tx.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {tx.type === 'CREDIT' ? (
                            <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <ArrowDownCircle className="h-4 w-4 text-red-500" />
                          )}
                          <Badge
                            variant="outline"
                            className={cn(
                              tx.type === 'CREDIT'
                                ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                                : 'bg-red-500/10 text-red-600 border-red-500/20'
                            )}
                          >
                            {tx.type}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          'text-right font-mono font-semibold',
                          tx.type === 'CREDIT' ? 'text-emerald-600' : 'text-red-600'
                        )}
                      >
                        {tx.type === 'CREDIT' ? '+' : ''}
                        {tx.amount}
                      </TableCell>
                      <TableCell>{tx.description}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {tx.createdByEmail || 'System'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Pagination */}
              {transactionTotalPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTransactionPage(p => Math.max(1, p - 1))}
                    disabled={transactionPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {transactionPage} of {transactionTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTransactionPage(p => Math.min(transactionTotalPages, p + 1))}
                    disabled={transactionPage === transactionTotalPages}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
          <CardDescription>View and download your invoices</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">No invoices found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice Number</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map(invoice => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoiceNumber}</TableCell>
                    <TableCell>
                      {formatDate(invoice.period.start)} - {formatDate(invoice.period.end)}
                    </TableCell>
                    <TableCell>{formatCurrency(parseFloat(invoice.total))}</TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === 'paid' ? 'success' : 'warning'}>
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        <Download className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
