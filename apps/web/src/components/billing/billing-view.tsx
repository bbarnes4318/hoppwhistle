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

import { RoleGuard } from '@/components/auth/role-guard';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatTile,
  TOOLBAR_CELL,
  Toolbar,
  ToolbarActions,
  ToolbarClear,
  ToolbarDateRange,
  toolbarTrigger,
} from '@/components/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { Tooltip } from '@/components/ui/tooltip';
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

function BillingPage() {
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
      <div className="page-canvas">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-ink-3" />
        </div>
      </div>
    );
  }

  return (
    <div className="page-canvas">
      {/* No header row: the page title is already in the topbar. */}
      {error && <Notice tone="error">Error: {error}</Notice>}

      {/* Balance Cards */}
      {balance && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatTile
            label="Available Balance"
            icon={DollarSign}
            tone="money"
            figure={formatCurrency(parseFloat(balance.available))}
          />

          <StatTile
            label="Pending"
            icon={TrendingUp}
            figure={formatCurrency(parseFloat(balance.pending))}
          />

          <StatTile
            label="Held"
            icon={DollarSign}
            figure={formatCurrency(parseFloat(balance.held))}
          />
        </div>
      )}

      {/* Buyer Transaction Ledger */}
      <Panel className="min-w-0">
        {/*
          The ledger's title, filters and refresh share one flat toolbar row
          across the top of the panel. The buyer select has no "all" entry:
          the endpoint is per buyer, so it reads "Buyer" until one is picked.
        */}
        <Toolbar className="rounded-none border-0 shadow-none">
          <PanelTitle className="shrink-0 px-1">Buyer Transaction Ledger</PanelTitle>
          <div className={TOOLBAR_CELL}>
            <Select
              value={selectedBuyerId}
              onValueChange={id => {
                setSelectedBuyerId(id);
                setTransactionPage(1);
              }}
            >
              <SelectTrigger aria-label="Buyer" className={toolbarTrigger(!!selectedBuyerId)}>
                <SelectValue placeholder="Buyer" />
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
          <ToolbarDateRange
            from={startDate}
            to={endDate}
            onFromChange={value => {
              setStartDate(value);
              setTransactionPage(1);
            }}
            onToChange={value => {
              setEndDate(value);
              setTransactionPage(1);
            }}
          />
          <ToolbarActions>
            {(startDate || endDate) && (
              <ToolbarClear
                onClick={() => {
                  setStartDate('');
                  setEndDate('');
                  setTransactionPage(1);
                }}
              />
            )}
            <Tooltip content="Refresh transactions" align="end">
              <Button
                variant="outline"
                size="sm"
                aria-label="Refresh transactions"
                className="h-8 w-8 p-0"
                onClick={() => void loadTransactions()}
                disabled={transactionsLoading || !selectedBuyerId}
              >
                <RefreshCw className={cn('h-4 w-4', transactionsLoading && 'animate-spin')} />
              </Button>
            </Tooltip>
          </ToolbarActions>
        </Toolbar>

        {/* Buyer Info */}
        {buyerInfo && (
          <PanelBody>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-control border border-rule bg-sunken p-3">
              <div>
                <div className="t-label text-ink-3">Buyer</div>
                <div className="t-body font-semibold text-ink">{buyerInfo.name}</div>
              </div>
              <div>
                <div className="t-label text-ink-3">Publisher</div>
                <div className="t-body text-ink">{buyerInfo.publisherName}</div>
              </div>
              <div>
                <div className="t-label text-ink-3">Current Balance</div>
                <div className="t-body font-semibold tabular-nums text-ink">
                  {buyerInfo.leadsRemaining.toLocaleString()} leads
                </div>
              </div>
              <div>
                <div className="t-label text-ink-3">Status</div>
                <Badge variant={buyerInfo.status === 'ACTIVE' ? 'default' : 'secondary'}>
                  {buyerInfo.status}
                </Badge>
              </div>
            </div>
          </PanelBody>
        )}

        {/* Transactions Table */}
        {!selectedBuyerId ? (
          <div className="t-body border-t border-rule py-8 text-center text-ink-3">
            Select a buyer to view their transaction history
          </div>
        ) : transactionsLoading ? (
          <div className="flex items-center justify-center border-t border-rule py-8">
            <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="t-body border-t border-rule py-8 text-center text-ink-3">
            No transactions found
          </div>
        ) : (
          <>
            <PanelBody flush className="overflow-x-auto border-t border-rule">
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
                      <TableCell className="t-num whitespace-nowrap text-ink-3">
                        {formatDate(tx.createdAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {tx.type === 'CREDIT' ? (
                            <ArrowUpCircle className="h-4 w-4 text-live-ink" />
                          ) : (
                            <ArrowDownCircle className="h-4 w-4 text-dropped-ink" />
                          )}
                          <Badge variant={tx.type === 'CREDIT' ? 'success' : 'destructive'}>
                            {tx.type}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell
                        className={cn(
                          't-num text-right font-semibold',
                          tx.type === 'CREDIT' ? 'text-live-ink' : 'text-dropped-ink'
                        )}
                      >
                        {tx.type === 'CREDIT' ? '+' : ''}
                        {tx.amount}
                      </TableCell>
                      <TableCell className="text-ink">{tx.description}</TableCell>
                      <TableCell className="text-ink-3">{tx.createdByEmail || 'System'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </PanelBody>

            {/* Pagination */}
            {transactionTotalPages > 1 && (
              <div className="flex flex-wrap items-center justify-center gap-2 border-t border-rule px-5 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTransactionPage(p => Math.max(1, p - 1))}
                  disabled={transactionPage === 1}
                >
                  Previous
                </Button>
                <span className="t-meta tabular-nums text-ink-3">
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
      </Panel>

      {/* Invoices */}
      <Panel className="min-w-0">
        <PanelHeader>
          <PanelTitle>Invoices</PanelTitle>
        </PanelHeader>
        {invoices.length === 0 ? (
          <EmptyState
            headline="No invoices found"
            body="Invoices appear here once charging is turned on."
          />
        ) : (
          <PanelBody flush className="overflow-x-auto">
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
                    <TableCell className="t-data font-medium text-ink">
                      {invoice.invoiceNumber}
                    </TableCell>
                    <TableCell className="t-num whitespace-nowrap text-ink-2">
                      {formatDate(invoice.period.start)} - {formatDate(invoice.period.end)}
                    </TableCell>
                    <TableCell className="t-num font-medium text-ink">
                      {formatCurrency(parseFloat(invoice.total))}
                    </TableCell>
                    <TableCell>
                      <Badge variant={invoice.status === 'paid' ? 'success' : 'warning'}>
                        {invoice.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="t-num whitespace-nowrap text-ink-2">
                      {formatDate(invoice.dueDate)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Tooltip content="Download invoice" align="end">
                        <Button variant="ghost" size="sm">
                          <Download className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        )}
      </Panel>
    </div>
  );
}

export function BillingView() {
  return (
    <RoleGuard allowedRoles={['ADMIN', 'OWNER']}>
      <BillingPage />
    </RoleGuard>
  );
}
