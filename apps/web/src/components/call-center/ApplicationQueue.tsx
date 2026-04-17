import { Phone, RefreshCw } from 'lucide-react';
import React from 'react';
import type { ApplicationData } from './types';

interface ApplicationQueueProps {
  applications: ApplicationData[];
  loadingApplications: boolean;
  fetchApplications: () => Promise<void>;
  startCallWithApplication: (app: ApplicationData) => Promise<void>;
}

export function ApplicationQueue({
  applications,
  loadingApplications,
  fetchApplications,
  startCallWithApplication,
}: ApplicationQueueProps) {
  return (
    <div className="flex-1 bg-card border border-border rounded overflow-hidden flex flex-col mt-4">
      <div className="p-3 border-b border-border flex items-center justify-between bg-muted/30">
        <h2 className="text-xs font-mono uppercase tracking-widest text-foreground">Application Queue</h2>
        <button
          onClick={() => void fetchApplications()}
          disabled={loadingApplications}
          className="flex items-center space-x-2 px-2 py-1 hover:bg-muted text-muted-foreground rounded text-[10px] uppercase font-mono tracking-widest transition-colors disabled:opacity-50 border border-transparent hover:border-border"
        >
          <RefreshCw className={'w-3 h-3 ' + (loadingApplications ? 'animate-spin' : '')} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadingApplications ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <RefreshCw className="w-8 h-8 text-muted-foreground animate-spin" />
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground border-b border-border pb-1">
              Pulling Queue...
            </p>
          </div>
        ) : applications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-2 h-2 bg-muted mb-4" />
            <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground border-b border-border pb-1">
              Queue is Empty
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-muted sticky top-0 border-b border-border">
              <tr>
                <th className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-4 py-2">Customer</th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-4 py-2">Phone</th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-4 py-2">Carrier</th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-4 py-2 text-right">Face Amount</th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-4 py-2">Status</th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground px-4 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {applications.map((app) => (
                <tr key={app.id} className="hover:bg-muted/50 transition-colors group">
                  <td className="px-4 py-2">
                    <span className="text-sm font-medium text-foreground block">
                      {app.name || (app.firstName || '') + ' ' + (app.lastName || '')}
                    </span>
                    <span className="text-xs text-muted-foreground uppercase tracking-widest">{app.state || 'N/A'}</span>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-muted-foreground">{app.phone || 'N/A'}</td>
                  <td className="px-4 py-2 text-xs font-mono text-muted-foreground uppercase">{app.carrier || 'N/A'}</td>
                  <td className="px-4 py-2 text-xs font-mono text-foreground text-right">
                    ${(app.faceAmount || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
                      [{app.status}]
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button
                      onClick={() => void startCallWithApplication(app)}
                      className="px-3 py-1 bg-card border border-border hover:bg-muted text-foreground text-[10px] font-mono uppercase tracking-widest rounded transition-colors inline-block"
                    >
                      Call Out
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
