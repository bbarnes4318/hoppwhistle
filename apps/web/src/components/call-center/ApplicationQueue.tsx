import { Phone, RefreshCw, Trash2 } from 'lucide-react';
import React from 'react';

import type { ApplicationData } from './types';

interface ApplicationQueueProps {
  applications: ApplicationData[];
  loadingApplications: boolean;
  fetchApplications: () => Promise<void>;
  startCallWithApplication: (app: ApplicationData) => Promise<void>;
  onDeleteLead?: (id: string) => Promise<void>;
}

export function ApplicationQueue({
  applications,
  loadingApplications,
  fetchApplications,
  startCallWithApplication,
  onDeleteLead,
}: ApplicationQueueProps) {
  return (
    <div className="flex-1 bg-surface border border-rule rounded overflow-hidden flex flex-col mt-4">
      <div className="p-3 border-b border-rule flex items-center justify-between bg-sunken">
        <h2 className="text-xs font-mono uppercase tracking-widest text-ink">Application Queue</h2>
        <button
          onClick={() => void fetchApplications()}
          disabled={loadingApplications}
          className="flex items-center space-x-2 px-2 py-1 hover:bg-sunken text-ink-2 rounded text-[10px] uppercase font-mono tracking-widest transition-colors disabled:opacity-50 border border-transparent hover:border-rule-strong"
        >
          <RefreshCw className={'w-3 h-3 ' + (loadingApplications ? 'animate-spin' : '')} />
          <span>Refresh</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loadingApplications ? (
          <div className="flex flex-col items-center justify-center h-full space-y-4">
            <RefreshCw className="w-8 h-8 text-ink-2 animate-spin" />
            <p className="text-xs font-mono uppercase tracking-widest text-ink-2 border-b border-rule pb-1">
              Pulling Queue...
            </p>
          </div>
        ) : applications.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-2 h-2 bg-ink-3 mb-4" />
            <p className="text-xs font-mono uppercase tracking-widest text-ink-2 border-b border-rule pb-1">
              Queue is Empty
            </p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead className="bg-sunken sticky top-0 border-b border-rule">
              <tr>
                <th className="text-[10px] font-mono uppercase tracking-widest text-ink-2 px-4 py-2">
                  Customer
                </th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-ink-2 px-4 py-2">
                  Phone
                </th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-ink-2 px-4 py-2">
                  Carrier
                </th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-ink-2 px-4 py-2 text-right">
                  Face Amount
                </th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-ink-2 px-4 py-2">
                  Status
                </th>
                <th className="text-[10px] font-mono uppercase tracking-widest text-ink-2 px-4 py-2 text-right">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-rule">
              {applications.map(app => (
                <tr key={app.id} className="hover:bg-sunken transition-colors group">
                  <td className="px-4 py-2">
                    <span className="text-sm font-medium text-ink block">
                      {app.name || (app.firstName || '') + ' ' + (app.lastName || '')}
                    </span>
                    <span className="text-xs text-ink-2 uppercase tracking-widest">
                      {app.state || 'N/A'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-ink-2">{app.phone || 'N/A'}</td>
                  <td className="px-4 py-2 text-xs font-mono text-ink-2 uppercase">
                    {app.carrier || 'N/A'}
                  </td>
                  <td className="px-4 py-2 text-xs font-mono text-ink text-right">
                    ${(app.faceAmount || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-ink-2">
                      [{app.status}]
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button
                        onClick={() => void startCallWithApplication(app)}
                        className="px-3 py-1 bg-surface border border-rule hover:bg-sunken text-ink text-[10px] font-mono uppercase tracking-widest rounded transition-colors inline-block"
                      >
                        Call Out
                      </button>
                      {onDeleteLead && (
                        <button
                          onClick={() => void onDeleteLead(app.id)}
                          className="p-1 hover:bg-dropped-tint text-ink-2 hover:text-dropped-ink rounded transition-colors"
                          title="Delete Lead"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
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
