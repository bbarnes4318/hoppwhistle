'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Download, DollarSign, TrendingUp, Loader2 } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import { apiClient } from '@/lib/api';

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

export default function BillingPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [balance, setBalance] = useState<Balance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBillingData();
  }, []);

  const loadBillingData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [invoicesResponse, balanceResponse] = await Promise.all([
        apiClient.get<{ data: Invoice[]; meta: any }>('/api/v1/billing/invoices'),
        apiClient.get<Balance>('/api/v1/billing/balance'),
      ]);

      if (invoicesResponse.data) {
        setInvoices(invoicesResponse.data.data || []);
      }
      if (balanceResponse.data) {
        setBalance(balanceResponse.data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data');
    } finally {
      setLoading(false);
    }
  };

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
              <div className="text-2xl font-bold">{formatCurrency(parseFloat(balance.available))}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(parseFloat(balance.pending))}</div>
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
                {invoices.map((invoice) => (
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

