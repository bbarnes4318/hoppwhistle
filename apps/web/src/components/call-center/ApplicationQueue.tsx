import { Loader2, RefreshCw, Trash2 } from 'lucide-react';
import React from 'react';

import { EmptyState, Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/domain';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { ApplicationData } from './types';

interface ApplicationQueueProps {
  applications: ApplicationData[];
  loadingApplications: boolean;
  fetchApplications: () => Promise<void>;
  startCallWithApplication: (app: ApplicationData) => Promise<void>;
  onDeleteLead?: (id: string) => Promise<void>;
}

/** A queue status as a person reads it: "NEW_LEAD" is "New lead". */
function statusText(status: string | undefined): string {
  if (!status) return '—';
  const text = status.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function ApplicationQueue({
  applications,
  loadingApplications,
  fetchApplications,
  startCallWithApplication,
  onDeleteLead,
}: ApplicationQueueProps) {
  return (
    <Panel className="mt-1 flex min-h-0 flex-1 flex-col overflow-hidden">
      <PanelHeader
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchApplications()}
            disabled={loadingApplications}
          >
            <RefreshCw
              className={'mr-1.5 h-3.5 w-3.5 ' + (loadingApplications ? 'animate-spin' : '')}
            />
            Refresh
          </Button>
        }
      >
        <PanelTitle>Application queue</PanelTitle>
      </PanelHeader>

      <PanelBody flush className="min-h-0 flex-1 overflow-y-auto">
        {loadingApplications ? (
          <div className="flex h-full items-center justify-center gap-2 py-16 t-body text-ink-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading the queue
          </div>
        ) : applications.length === 0 ? (
          <EmptyState headline="The queue is empty." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Carrier</TableHead>
                <TableHead className="text-right">Face amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Action</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {applications.map(app => (
                <TableRow key={app.id} className="group">
                  <TableCell>
                    <span className="block font-medium text-ink">
                      {app.name || `${app.firstName || ''} ${app.lastName || ''}`.trim() || '—'}
                    </span>
                    <span className="t-meta text-ink-3">{app.state || '—'}</span>
                  </TableCell>
                  <TableCell className="tabular-nums text-ink-2">{app.phone || '—'}</TableCell>
                  <TableCell className="text-ink-2">
                    {(app.carrier as React.ReactNode) || '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {app.faceAmount ? `$${Number(app.faceAmount).toLocaleString()}` : '—'}
                  </TableCell>
                  <TableCell className="text-ink-2">{statusText(app.status)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void startCallWithApplication(app)}
                      >
                        Call out
                      </Button>
                      {onDeleteLead && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 hover:bg-dropped-tint hover:text-dropped-ink"
                          onClick={() => void onDeleteLead(app.id)}
                          title="Delete this lead"
                          aria-label="Delete this lead"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </PanelBody>
    </Panel>
  );
}
