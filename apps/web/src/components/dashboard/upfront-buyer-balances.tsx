'use client';

import { AlertTriangle, RefreshCw, Wallet } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface UpfrontBuyerBalance {
  id: string;
  name: string;
  code: string;
  publisherName: string;
  leadsRemaining: number;
  status: string;
  isLowBalance: boolean;
}

interface UpfrontBalancesResponse {
  data: UpfrontBuyerBalance[];
  meta: {
    total: number;
    lowBalanceCount: number;
  };
}

export function UpfrontBuyerBalances() {
  const [balances, setBalances] = useState<UpfrontBuyerBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [lowBalanceCount, setLowBalanceCount] = useState(0);

  const fetchBalances = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<UpfrontBalancesResponse>(
        '/api/v1/buyers/upfront-balances'
      );
      if (response.data) {
        setBalances(response.data.data);
        setLowBalanceCount(response.data.meta.lowBalanceCount);
      }
    } catch (error) {
      console.error('Failed to fetch upfront balances:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchBalances();
    const interval = setInterval(() => void fetchBalances(), 30000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600">
            Active
          </Badge>
        );
      case 'PAUSED':
        return (
          <Badge variant="outline" className="bg-amber-500/10 text-amber-600">
            Paused
          </Badge>
        );
      case 'INACTIVE':
        return (
          <Badge variant="outline" className="text-muted-foreground">
            Inactive
          </Badge>
        );
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base font-semibold">Upfront Buyer Balances</CardTitle>
          {lowBalanceCount > 0 && (
            <Badge variant="destructive" className="ml-2">
              {lowBalanceCount} low
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => void fetchBalances()}
          disabled={loading}
          className="h-8 w-8"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </CardHeader>
      <CardContent>
        {loading && balances.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : balances.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Wallet className="h-10 w-10 text-muted-foreground/50 mb-2" />
            <p className="text-sm text-muted-foreground">No Upfront buyers configured</p>
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Publisher</TableHead>
                  <TableHead className="text-right">Leads Remaining</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balances.map(buyer => (
                  <TableRow
                    key={buyer.id}
                    className={cn(
                      buyer.isLowBalance && 'bg-red-500/10 hover:bg-red-500/15',
                      buyer.status === 'PAUSED' && 'bg-amber-500/5'
                    )}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {buyer.isLowBalance && (
                          <AlertTriangle className="h-4 w-4 text-red-500 animate-pulse" />
                        )}
                        <span>{buyer.name}</span>
                        <span className="text-xs text-muted-foreground">({buyer.code})</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{buyer.publisherName}</TableCell>
                    <TableCell
                      className={cn(
                        'text-right font-mono font-semibold',
                        buyer.isLowBalance && 'text-red-600 dark:text-red-400',
                        buyer.leadsRemaining === 0 && 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {buyer.leadsRemaining.toLocaleString()}
                    </TableCell>
                    <TableCell>{getStatusBadge(buyer.status)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
