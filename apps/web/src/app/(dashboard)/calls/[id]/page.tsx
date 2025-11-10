'use client';

import { use } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPhoneNumber, formatDate, formatDuration } from '@/lib/utils';
import { Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Mock data
const mockCall = {
  id: 'call_1',
  from: '+12125551234',
  to: '+13105551234',
  status: 'completed',
  duration: 245,
  asr: 0.65,
  createdAt: new Date().toISOString(),
  transcript: {
    fullText: 'Hello, this is a sample transcript of the call. The caller was interested in our services.',
    segments: [
      { start: 0, end: 5, speaker: 'SPEAKER_00', text: 'Hello, this is a sample transcript.' },
      { start: 5, end: 10, speaker: 'SPEAKER_01', text: 'Yes, I am interested in your services.' },
    ],
  },
};

export default function CallDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const call = mockCall; // In real app, fetch by id

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Call Details</h1>
        <p className="text-muted-foreground">Call ID: {id}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Call Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm text-muted-foreground">From</div>
              <div className="text-lg font-medium">{formatPhoneNumber(call.from)}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">To</div>
              <div className="text-lg font-medium">{formatPhoneNumber(call.to)}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Status</div>
              <Badge variant={call.status === 'completed' ? 'success' : 'warning'}>
                {call.status}
              </Badge>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Duration</div>
              <div className="text-lg font-medium">{formatDuration(call.duration)}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Time</div>
              <div className="text-lg font-medium">{formatDate(call.createdAt)}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Audio Player</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-center h-32 bg-muted rounded-lg">
                <div className="text-center">
                  <div className="text-sm text-muted-foreground mb-2">Waveform Player</div>
                  <Button>
                    <Play className="h-4 w-4 mr-2" />
                    Play Recording
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Transcript</CardTitle>
          <CardDescription>Full call transcript with speaker labels</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm">{call.transcript.fullText}</p>
            </div>
            <div className="space-y-2">
              {call.transcript.segments.map((segment, idx) => (
                <div key={idx} className="flex gap-4 p-2 hover:bg-muted rounded">
                  <div className="text-xs text-muted-foreground w-20">
                    {formatDuration(segment.start)}
                  </div>
                  <div className="flex-1">
                    <Badge variant="outline" className="mb-1">
                      {segment.speaker}
                    </Badge>
                    <p className="text-sm">{segment.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

