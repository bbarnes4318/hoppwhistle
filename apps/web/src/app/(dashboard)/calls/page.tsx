'use client';

import { Play, Search } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiClient } from '@/lib/api';
import { formatDuration, formatPhoneNumber } from '@/lib/utils';

interface CallRecord {
 id: string;
 callSid?: string;
 callerId?: string;
 did?: string;
 toNumber?: string;
 targetNumber?: string;
 status: string;
 duration?: number;
 connectedDuration?: number;
 converted?: boolean;
 paidOut?: boolean;
 missedCall?: boolean;
 recordingUrl?: string | null;
 recordingStatus?: string | null;
 primaryRecordingId?: string | null;
 disposition?: string | null;
 dispositionNotes?: string | null;
 callSource?: string | null;
 followUpAt?: string | null;
 followUpStatus?: string | null;
 createdAt: string;
 campaign?: { name: string } | null;
 fromNumber?: { number: string } | null;
}

import {
  DISPOSITION_LABELS,
  DISPOSITION_COLORS,
  CALL_SOURCE_LABELS,
  getDispositionLabel,
} from '@hopwhistle/shared';

function getCallResult(call: CallRecord): string {
 if (call.disposition) {
 return DISPOSITION_LABELS[call.disposition] || call.disposition;
 }
 if (call.missedCall) return 'No Answer';
 if (call.status === 'COMPLETED') return 'Completed';
 if (call.status === 'NO_ANSWER') return 'No Answer';
 if (call.status === 'BUSY') return 'Busy';
 if (call.status === 'FAILED') return 'Failed';
 return call.status || 'Unknown';
}

function getResultBadgeClass(call: CallRecord): string {
 if (call.disposition && DISPOSITION_COLORS[call.disposition as keyof typeof DISPOSITION_COLORS]) {
 return DISPOSITION_COLORS[call.disposition as keyof typeof DISPOSITION_COLORS];
 }
 switch (call.status) {
 case 'COMPLETED':
 return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
 case 'FAILED':
 case 'BUSY':
 return 'bg-red-500/10 text-red-400 border-red-500/30';
 default:
 return 'bg-secondary text-muted-foreground border-border';
 }
}

export default function CallLogsPage() {
 const [calls, setCalls] = useState<CallRecord[]>([]);
 const [loading, setLoading] = useState(true);
 const [search, setSearch] = useState('');
 const [page, setPage] = useState(1);
 const [totalPages, setTotalPages] = useState(1);

 const fetchCalls = useCallback(async () => {
 setLoading(true);
 try {
 const response = await apiClient.get<{ data: CallRecord[]; meta: { totalPages: number } }>(
 `/api/v1/calls?page=${page}&limit=50`
 );
 if (response.data) {
 setCalls(response.data.data || []);
 setTotalPages(response.data.meta?.totalPages || 1);
 }
 } catch (error) {
 console.error('Failed to fetch calls:', error);
 } finally {
 setLoading(false);
 }
 }, [page]);

 useEffect(() => {
 void fetchCalls();
 }, [fetchCalls]);

 const filteredCalls = calls.filter(
 c =>
 (c.callerId || '').includes(search) ||
 (c.toNumber || '').includes(search) ||
 (c.callSid || '').toLowerCase().includes(search.toLowerCase()) ||
 c.id.toLowerCase().includes(search.toLowerCase())
 );

 return (
 <div className="h-full flex flex-col overflow-hidden">
 <div className="flex items-center justify-between flex-shrink-0 mb-4">
 <div>
 <h1 className="text-2xl font-semibold">Call Logs</h1>
 <p className="text-sm text-muted-foreground">
 View call history and disposition outcomes
 </p>
 </div>
 <div className="relative w-64">
 <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 id="call-logs-search"
 name="call-logs-search"
 placeholder="Search calls..."
 value={search}
 onChange={e => setSearch(e.target.value)}
 className="pl-10"
 />
 </div>
 </div>

 <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
 <CardHeader className="flex-shrink-0">
 <CardTitle>Call History</CardTitle>
 <CardDescription>Recent calls and disposition details</CardDescription>
 </CardHeader>
 <CardContent className="flex-1 overflow-y-auto min-h-0">
 <Table>
 <TableHeader>
 <TableRow>
 <TableHead>Time</TableHead>
 <TableHead>Call ID</TableHead>
 <TableHead>From</TableHead>
 <TableHead>To</TableHead>
 <TableHead>Status</TableHead>
 <TableHead>Duration</TableHead>
 <TableHead>Disposition</TableHead>
 <TableHead>Source</TableHead>
 <TableHead className="text-right">Recording</TableHead>
 </TableRow>
 </TableHeader>
 <TableBody>
 {loading ? (
 <TableRow>
 <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
 Loading calls...
 </TableCell>
 </TableRow>
 ) : filteredCalls.length === 0 ? (
 <TableRow>
 <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
 No calls found
 </TableCell>
 </TableRow>
 ) : (
 filteredCalls.map(call => {
 const result = getCallResult(call);
 return (
 <TableRow key={call.id}>
 <TableCell className="font-mono text-xs">
 {new Date(call.createdAt).toLocaleString('en-US', {
 month: 'short',
 day: 'numeric',
 hour: '2-digit',
 minute: '2-digit',
 })}
 </TableCell>
 <TableCell className="font-mono text-sm">
 {call.callSid || call.id.slice(0, 12)}
 </TableCell>
 <TableCell>
 {formatPhoneNumber(call.callerId || call.fromNumber?.number || '—')}
 </TableCell>
 <TableCell>
 {formatPhoneNumber(call.toNumber || call.targetNumber || call.did || '—')}
 </TableCell>
 <TableCell>
 <Badge
 variant="outline"
 className={
 call.status === 'COMPLETED'
 ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
 : call.status === 'IN_PROGRESS'
 ? 'bg-blue-500/10 text-blue-400 border-blue-500/30'
 : 'bg-secondary text-muted-foreground border-border'
 }
 >
 {call.status}
 </Badge>
 </TableCell>
 <TableCell>
 {call.duration ? formatDuration(call.duration) : '—'}
 </TableCell>
 <TableCell>
 <Badge variant="outline" className={getResultBadgeClass(call)}>
 {result}
 </Badge>
 </TableCell>
 <TableCell>
 {call.callSource ? (
 <span className="text-xs font-mono text-muted-foreground uppercase tracking-widest">
 {CALL_SOURCE_LABELS[call.callSource] || call.callSource}
 </span>
 ) : (
 <span className="text-xs text-muted-foreground/50">—</span>
 )}
 </TableCell>
 <TableCell className="text-right">
 {call.recordingStatus === 'READY' && call.recordingUrl ? (
 <a
 href={call.recordingUrl}
 target="_blank"
 rel="noopener noreferrer"
 >
 <Button variant="ghost" size="sm">
 <Play className="h-4 w-4" />
 </Button>
 </a>
 ) : call.recordingStatus === 'PENDING' || call.recordingStatus === 'RECORDING' || call.recordingStatus === 'PROCESSING' ? (
 <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
 <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
 <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
 <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
 </svg>
 {call.recordingStatus === 'PENDING' ? 'Pending' : call.recordingStatus === 'RECORDING' ? 'Recording' : 'Processing'}
 </span>
 ) : call.recordingStatus === 'FAILED' ? (
 <span className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-400" title="Recording failed">
 ✕ Failed
 </span>
 ) : call.recordingUrl ? (
 <a
 href={call.recordingUrl}
 target="_blank"
 rel="noopener noreferrer"
 >
 <Button variant="ghost" size="sm">
 <Play className="h-4 w-4" />
 </Button>
 </a>
 ) : (
 <span className="text-xs text-muted-foreground">—</span>
 )}
 </TableCell>
 </TableRow>
 );
 })
 )}
 </TableBody>
 </Table>

 {/* Pagination */}
 {totalPages > 1 && (
 <div className="flex items-center justify-center gap-2 py-3 border-t">
 <Button
 variant="outline"
 size="sm"
 onClick={() => setPage(p => Math.max(1, p - 1))}
 disabled={page === 1}
 >
 Previous
 </Button>
 <span className="text-sm text-muted-foreground">
 Page {page} of {totalPages}
 </span>
 <Button
 variant="outline"
 size="sm"
 onClick={() => setPage(p => Math.min(totalPages, p + 1))}
 disabled={page === totalPages}
 >
 Next
 </Button>
 </div>
 )}
 </CardContent>
 </Card>
 </div>
 );
}

