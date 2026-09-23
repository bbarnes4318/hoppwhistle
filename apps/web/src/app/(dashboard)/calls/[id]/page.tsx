'use client';

import { Play } from 'lucide-react';
import { useParams } from 'next/navigation';

import { Panel, PanelBody, PanelDescription, PanelHeader, PanelTitle } from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatPhoneNumber, formatDate, formatDuration } from '@/lib/utils';

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
    fullText:
      'Hello, this is a sample transcript of the call. The caller was interested in our services.',
    segments: [
      { start: 0, end: 5, speaker: 'SPEAKER_00', text: 'Hello, this is a sample transcript.' },
      { start: 5, end: 10, speaker: 'SPEAKER_01', text: 'Yes, I am interested in your services.' },
    ],
  },
};

export default function CallDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const call = mockCall; // In real app, fetch by id

  return (
    <div className="page-canvas">
      <PageHeader
        description={
          <>
            Call ID: <span className="t-data text-ink">{id}</span>
          </>
        }
      />

      <div className="grid gap-6 md:grid-cols-2 [&>*]:min-w-0">
        <Panel>
          <PanelHeader>
            <PanelTitle>Call Information</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5">
              <div className="min-w-0">
                <dt className="t-label text-ink-3">From</dt>
                <dd className="t-data mt-1 text-[15px] text-ink">{formatPhoneNumber(call.from)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="t-label text-ink-3">To</dt>
                <dd className="t-data mt-1 text-[15px] text-ink">{formatPhoneNumber(call.to)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="t-label text-ink-3">Status</dt>
                <dd className="mt-1">
                  <Badge variant={call.status === 'completed' ? 'success' : 'warning'}>
                    {call.status}
                  </Badge>
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="t-label text-ink-3">Duration</dt>
                <dd className="mt-1 text-[15px] font-medium tabular-nums text-ink">
                  {formatDuration(call.duration)}
                </dd>
              </div>
              <div className="col-span-2 min-w-0">
                <dt className="t-label text-ink-3">Time</dt>
                <dd className="t-data mt-1 text-[15px] text-ink">{formatDate(call.createdAt)}</dd>
              </div>
            </dl>
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader>
            <PanelTitle>Audio Player</PanelTitle>
          </PanelHeader>
          <PanelBody>
            <div className="flex h-32 items-center justify-center rounded-control border border-rule bg-sunken">
              <div className="text-center">
                <div className="t-meta mb-3 text-ink-3">Waveform Player</div>
                <Button>
                  <Play className="h-4 w-4" />
                  Play Recording
                </Button>
              </div>
            </div>
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader>
          <PanelTitle>Transcript</PanelTitle>
          <PanelDescription>Full call transcript with speaker labels</PanelDescription>
        </PanelHeader>
        <PanelBody>
          <div className="space-y-4">
            <div className="rounded-control bg-sunken p-4">
              <p className="t-body text-ink">{call.transcript.fullText}</p>
            </div>
            <div className="divide-y divide-rule">
              {call.transcript.segments.map((segment, idx) => (
                <div
                  key={idx}
                  className="flex gap-4 rounded-control px-2 py-3 transition-colors duration-150 ease-out hover:bg-sunken"
                >
                  <div className="t-data w-16 shrink-0 pt-0.5 text-ink-3">
                    {formatDuration(segment.start)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Badge variant="outline" className="mb-1.5">
                      {segment.speaker}
                    </Badge>
                    <p className="t-body text-ink">{segment.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </PanelBody>
      </Panel>
    </div>
  );
}
