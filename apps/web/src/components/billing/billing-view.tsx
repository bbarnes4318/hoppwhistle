'use client';

import { ArrowDownCircle, ArrowUpCircle, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelHeader,
  PanelTitle,
  StatusChip,
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
import { apiClient, payload, type Envelope } from '@/lib/api';
import { nyDayBounds } from '@/lib/new-york-day';
import { cn, formatCurrency, formatDate } from '@/lib/utils';

/** One row of `GET /api/v1/buyers/balances`. */
export interface BuyerBalanceRow {
  id: string;
  name: string;
  code: string;
  billingType: 'UPFRONT' | 'TERMS';
  /** UPFRONT only: the wallet now. */
  walletBalance: number | null;
  /** TERMS only: billed so far this calendar month (New York). */
  billedThisMonth: number | null;
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
  pauseReason: 'WALLET_EMPTY' | 'MANUAL' | null;
  lastTopUp: { amount: number; at: string } | null;
}

const BILLING_LABEL: Record<BuyerBalanceRow['billingType'], string> = {
  UPFRONT: 'Prepaid',
  TERMS: 'Terms',
};

const PAUSE_REASON_LABEL: Record<NonNullable<BuyerBalanceRow['pauseReason']>, string> = {
  WALLET_EMPTY: 'Wallet empty',
  MANUAL: 'Paused by you',
};

function statusLabel(row: Pick<BuyerBalanceRow, 'status' | 'pauseReason'>): string {
  if (row.status === 'ACTIVE') return 'Active';
  if (row.status === 'INACTIVE') return 'Inactive';
  return row.pauseReason ? `Paused · ${PAUSE_REASON_LABEL[row.pauseReason]}` : 'Paused';
}

interface BuyerTransaction {
  id: string;
  /** Decimal on the wire: a string, or a number from an older build. */
  amount: number | string;
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
    walletBalance: number;
    status: string;
  };
  data: BuyerTransaction[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

/**
 * The transaction filter's dates as instants: from the start of the first New
 * York day to the end of the last. The endpoint reads `endDate` inclusively
 * (`lte`), so it is sent as the last millisecond of the day rather than the
 * next day's first instant.
 */
export function ledgerDateParams(
  startDate: string,
  endDate: string
): { startDate?: string; endDate?: string } {
  const start = startDate ? nyDayBounds(startDate) : null;
  const end = endDate ? nyDayBounds(endDate) : null;
  return {
    ...(start ? { startDate: start.start.toISOString() } : {}),
    ...(end ? { endDate: new Date(end.endExclusive.getTime() - 1).toISOString() } : {}),
  };
}

function BillingPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Every buyer in the agency, with its balance. Also the ledger's buyer list.
  const [buyers, setBuyers] = useState<BuyerBalanceRow[]>([]);

  // Transaction ledger state
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
      const response = await apiClient.get<Envelope<BuyerBalanceRow[]>>('/api/v1/buyers/balances');
      if (response.error) setError(response.error.message);
      setBuyers(payload(response) ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load buyer balances');
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
      for (const [name, value] of Object.entries(ledgerDateParams(startDate, endDate))) {
        params.append(name, value);
      }

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

      {/*
        Every buyer in the agency and where its money stands: a prepaid buyer's
        wallet, or what a terms buyer has been billed this month.
      */}
      <Panel className="min-w-0">
        <PanelHeader>
          <PanelTitle>Buyer balances</PanelTitle>
        </PanelHeader>
        {buyers.length === 0 ? (
          <EmptyState
            headline="No buyers yet"
            body="Buyers appear here with their balance once they are added."
          />
        ) : (
          <PanelBody flush className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Billing</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last top-up</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {buyers.map(row => (
                  <TableRow key={row.id} data-testid="buyer-balance-row">
                    <TableCell className="font-medium text-ink">{row.name}</TableCell>
                    <TableCell className="text-ink-2">{BILLING_LABEL[row.billingType]}</TableCell>
                    <TableCell className="t-num whitespace-nowrap text-right">
                      {row.billingType === 'UPFRONT' ? (
                        <span className="font-semibold text-ink">
                          {formatCurrency(row.walletBalance ?? 0)}
                        </span>
                      ) : (
                        <>
                          <span className="font-semibold text-ink">
                            {formatCurrency(row.billedThisMonth ?? 0)}
                          </span>{' '}
                          <span className="t-meta text-ink-3">billed this month</span>
                        </>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        value={row.status}
                        enumName="BuyerStatus"
                        label={statusLabel(row)}
                        size="sm"
                      />
                    </TableCell>
                    <TableCell className="t-num whitespace-nowrap text-ink-2">
                      {row.lastTopUp ? (
                        <>
                          {formatCurrency(row.lastTopUp.amount)}{' '}
                          <span className="text-ink-3">· {formatDate(row.lastTopUp.at)}</span>
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </PanelBody>
        )}
      </Panel>

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
              {buyerInfo.billingType === 'UPFRONT' ? (
                <div>
                  <div className="t-label text-ink-3">Current Balance</div>
                  <div className="t-body font-semibold tabular-nums text-ink">
                    {formatCurrency(Number(buyerInfo.walletBalance))}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="t-label text-ink-3">Billed this month</div>
                  <div className="t-body font-semibold tabular-nums text-ink">
                    {formatCurrency(buyers.find(b => b.id === buyerInfo.id)?.billedThisMonth ?? 0)}
                  </div>
                </div>
              )}
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
                        {formatCurrency(Number(tx.amount))}
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
