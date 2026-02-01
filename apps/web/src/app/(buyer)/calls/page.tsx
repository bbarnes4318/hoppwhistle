'use client';

import { Calendar, Clock, DollarSign, History, Phone, RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Call {
  id: string;
  callerId: string;
  destination: string;
  status: 'COMPLETED' | 'NO_ANSWER' | 'BUSY' | 'FAILED';
  duration: number; // seconds
  amount: number;
  startTime: string;
  endTime: string | null;
  state?: string;
  targetName?: string;
}

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export default function CallHistoryPage() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchCalls = async () => {
      setLoading(true);
      try {
        // In production, this would fetch from /api/v1/buyers/:buyerId/calls
        // For now, using demo data
        await new Promise(r => setTimeout(r, 500));
        setCalls([
          {
            id: '1',
            callerId: '+15551234567',
            destination: '+18881234567',
            status: 'COMPLETED',
            duration: 245,
            amount: 35.0,
            startTime: new Date(Date.now() - 3600000).toISOString(),
            endTime: new Date(Date.now() - 3600000 + 245000).toISOString(),
            state: 'FL',
            targetName: 'Primary Call Center',
          },
          {
            id: '2',
            callerId: '+15559876543',
            destination: '+18881234567',
            status: 'COMPLETED',
            duration: 189,
            amount: 30.0,
            startTime: new Date(Date.now() - 7200000).toISOString(),
            endTime: new Date(Date.now() - 7200000 + 189000).toISOString(),
            state: 'GA',
            targetName: 'Primary Call Center',
          },
          {
            id: '3',
            callerId: '+15555551212',
            destination: '+18881234567',
            status: 'NO_ANSWER',
            duration: 0,
            amount: 0,
            startTime: new Date(Date.now() - 10800000).toISOString(),
            endTime: null,
            state: 'CA',
            targetName: 'Florida Office',
          },
        ]);
      } catch (error) {
        console.error('Failed to fetch calls:', error);
      } finally {
        setLoading(false);
      }
    };

    void fetchCalls();
  }, []);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Badge className="bg-green-500/10 text-green-500">Completed</Badge>;
      case 'NO_ANSWER':
        return <Badge variant="secondary">No Answer</Badge>;
      case 'BUSY':
        return <Badge variant="outline">Busy</Badge>;
      case 'FAILED':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredCalls = calls.filter(
    call =>
      call.callerId.includes(searchTerm) ||
      call.targetName?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Calculate summary stats
  const totalCalls = calls.length;
  const completedCalls = calls.filter(c => c.status === 'COMPLETED').length;
  const totalSpend = calls.reduce((sum, c) => sum + c.amount, 0);
  const avgDuration =
    completedCalls > 0
      ? Math.round(
          calls.filter(c => c.status === 'COMPLETED').reduce((sum, c) => sum + c.duration, 0) /
            completedCalls
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <History className="h-6 w-6" />
          Call History
        </h1>
        <p className="text-sm text-muted-foreground">Review your recent calls and performance</p>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Calls</CardTitle>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCalls}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedCalls}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Spend</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalSpend.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatDuration(avgDuration)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Calls Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Recent Calls</CardTitle>
              <CardDescription>Your call log from the past 30 days</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search calls..."
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  className="pl-8 w-64"
                />
              </div>
              <Button variant="outline" size="icon">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Caller ID</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Duration</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-28" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-20" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                  </TableRow>
                ))
              ) : filteredCalls.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                    <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No calls found.</p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredCalls.map(call => (
                  <TableRow key={call.id}>
                    <TableCell>
                      <div>
                        <p className="text-sm">{new Date(call.startTime).toLocaleDateString()}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(call.startTime).toLocaleTimeString()}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {call.callerId}
                      </code>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{call.state || 'N/A'}</Badge>
                    </TableCell>
                    <TableCell>{call.targetName || '-'}</TableCell>
                    <TableCell>{getStatusBadge(call.status)}</TableCell>
                    <TableCell className="text-right font-mono">
                      {call.duration > 0 ? formatDuration(call.duration) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {call.amount > 0 ? `$${call.amount.toFixed(2)}` : '-'}
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
