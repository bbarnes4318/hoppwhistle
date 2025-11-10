'use client';

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Search, Play } from 'lucide-react';
import { formatPhoneNumber, formatDate, formatDuration } from '@/lib/utils';
import Link from 'next/link';

// Mock data
const mockCalls = [
  {
    id: 'call_1',
    from: '+12125551234',
    to: '+13105551234',
    status: 'completed',
    duration: 245,
    asr: 0.65,
    createdAt: new Date().toISOString(),
  },
  {
    id: 'call_2',
    from: '+14155551234',
    to: '+12125551234',
    status: 'answered',
    duration: 120,
    asr: 0.58,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
  },
];

export default function CallsPage() {
  const [search, setSearch] = useState('');

  const filteredCalls = mockCalls.filter(
    (c) =>
      c.from.includes(search) ||
      c.to.includes(search) ||
      c.id.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-3xl font-bold">Calls</h1>
          <p className="text-muted-foreground">View and manage call history</p>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="calls-search"
            name="calls-search"
            placeholder="Search calls..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardHeader className="flex-shrink-0">
          <CardTitle>Call History</CardTitle>
          <CardDescription>Recent calls and their details</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Call ID</TableHead>
                <TableHead>From</TableHead>
                <TableHead>To</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>ASR</TableHead>
                <TableHead>Time</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredCalls.map((call) => (
                <TableRow key={call.id}>
                  <TableCell className="font-mono text-sm">{call.id}</TableCell>
                  <TableCell>{formatPhoneNumber(call.from)}</TableCell>
                  <TableCell>{formatPhoneNumber(call.to)}</TableCell>
                  <TableCell>
                    <Badge variant={call.status === 'completed' ? 'success' : 'warning'}>
                      {call.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDuration(call.duration)}</TableCell>
                  <TableCell>{(call.asr * 100).toFixed(1)}%</TableCell>
                  <TableCell>{formatDate(call.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Link href={`/calls/${call.id}`}>
                      <Button variant="ghost" size="sm">
                        <Play className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

