'use client';

/**
 * Project Cortex | Step 3: Leads & Campaign (Node Flow Interface)
 *
 * Lead upload and concurrency settings with cyberpunk styling.
 */

import {
  Upload,
  Users,
  ArrowRight,
  ArrowLeft,
  Settings,
  AlertCircle,
  RefreshCw,
  Zap,
  CheckCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { GlassPanel, NodeConnector } from '@/components/ui/glass-panel';
import { NodeLabel } from '@/components/ui/node-label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface Lead {
  id: string;
  phone: string;
  name?: string;
  status: 'pending' | 'calling' | 'success' | 'failed' | 'no_answer';
}

export interface LeadUploadError {
  type: 'invalid_file' | 'missing_phone' | 'empty_file' | 'upload_failed';
  message: string;
}

interface Step3LeadsCampaignProps {
  leads: Lead[];
  onUploadLeads: (e: React.ChangeEvent<HTMLInputElement>) => void;
  concurrency: number;
  onConcurrencyChange: (value: number) => void;
  onContinue: () => void;
  onBack: () => void;
  uploadError?: LeadUploadError | null;
  onClearError?: () => void;
}

export function Step3LeadsCampaign({
  leads,
  onUploadLeads,
  concurrency,
  onConcurrencyChange,
  onContinue,
  onBack,
  uploadError,
  onClearError,
}: Step3LeadsCampaignProps) {
  const canContinue = leads.length > 0 && !uploadError;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (onClearError) onClearError();
    onUploadLeads(e);
  };

  return (
    <div className="space-y-0">
      {/* NODE 01: Lead Upload */}
      <GlassPanel
        active
        accentColor="violet"
        title="NODE 01 // LEAD INJECTION"
        subtitle="Upload phone numbers to dial"
        icon={<Users className="h-5 w-5" />}
      >
        <div className="space-y-4">
          {/* Upload Zone */}
          <label htmlFor="leads-upload" className="cursor-pointer block">
            <div
              className={cn(
                'flex flex-col items-center justify-center gap-4 rounded-xl',
                'border-2 border-dashed border-white/10',
                'px-6 py-12 transition-all duration-300',
                'hover:border-neon-cyan/50 hover:bg-neon-cyan/5',
                'group'
              )}
            >
              <div
                className={cn(
                  'flex h-16 w-16 items-center justify-center rounded-full',
                  'bg-neon-violet/10 border border-neon-violet/30',
                  'group-hover:bg-neon-cyan/10 group-hover:border-neon-cyan/30',
                  'transition-all duration-300'
                )}
              >
                <Upload className="h-8 w-8 text-neon-violet group-hover:text-neon-cyan transition-colors" />
              </div>
              <div className="text-center">
                <p className="font-display font-semibold text-text-primary uppercase tracking-wide">
                  DROP CSV OR CLICK TO BROWSE
                </p>
                <p className="text-xs text-text-muted font-mono mt-2">
                  FORMAT: PHONE (COLUMN 1) • NAME (OPTIONAL)
                </p>
              </div>
            </div>
          </label>
          <input
            id="leads-upload"
            type="file"
            accept=".csv,.txt"
            onChange={handleFileChange}
            className="hidden"
          />

          {/* Upload Error */}
          {uploadError && (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-status-error/10 border border-status-error/30">
              <AlertCircle className="h-5 w-5 text-status-error shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-mono font-semibold text-status-error uppercase text-sm">
                  UPLOAD FAILED
                </p>
                <p className="text-xs text-status-error/80 mt-1">{uploadError.message}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('leads-upload')?.click()}
                className="shrink-0 border-status-error/30 text-status-error hover:bg-status-error/10"
              >
                <RefreshCw className="h-3 w-3 mr-1" />
                RETRY
              </Button>
            </div>
          )}

          {/* Empty State */}
          {leads.length === 0 && !uploadError && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-panel border border-white/5">
              <Users className="h-5 w-5 text-text-muted" />
              <p className="text-xs text-text-muted font-mono">AWAITING DATA INJECTION...</p>
            </div>
          )}

          {/* Lead Count Success */}
          {leads.length > 0 && (
            <div className="flex items-center justify-between p-4 rounded-lg bg-status-success/10 border border-status-success/30">
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-status-success" />
                <span className="font-mono font-semibold text-status-success">
                  {leads.length} LEADS LOADED
                </span>
              </div>
              <span className="text-xs font-mono text-status-success/80 uppercase">READY</span>
            </div>
          )}

          {/* Lead Preview Table */}
          {leads.length > 0 && (
            <div className="rounded-lg border border-white/5 overflow-hidden max-h-[200px] overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-panel border-b border-white/5">
                  <tr>
                    <th className="p-3 text-left font-mono text-xs text-neon-cyan uppercase tracking-widest">
                      PHONE
                    </th>
                    <th className="p-3 text-left font-mono text-xs text-neon-cyan uppercase tracking-widest">
                      NAME
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 5).map(lead => (
                    <tr key={lead.id} className="border-t border-white/5">
                      <td className="p-3 font-mono text-text-primary">{lead.phone}</td>
                      <td className="p-3 text-text-muted">{lead.name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leads.length > 5 && (
                <p className="p-3 text-center text-xs text-text-muted font-mono border-t border-white/5">
                  + {leads.length - 5} MORE RECORDS
                </p>
              )}
            </div>
          )}
        </div>
      </GlassPanel>

      {/* Node Connector */}
      <NodeConnector />

      {/* NODE 02: Concurrency Settings */}
      <GlassPanel
        active={leads.length > 0}
        accentColor="cyan"
        title="NODE 02 // VELOCITY CONTROL"
        subtitle="Configure simultaneous call capacity"
        icon={<Settings className="h-5 w-5" />}
      >
        <div className="space-y-6">
          {/* Concurrency Display */}
          <div className="flex items-center justify-between">
            <NodeLabel icon={<Zap className="h-4 w-4" />}>CONCURRENT CALLS</NodeLabel>
            <span className="text-4xl font-display font-bold text-neon-cyan">{concurrency}</span>
          </div>

          {/* Slider */}
          <Slider
            value={[concurrency]}
            onValueChange={([value]) => onConcurrencyChange(value)}
            min={1}
            max={10}
            step={1}
            className="w-full"
          />

          {/* Scale Labels */}
          <div className="flex justify-between text-xs text-text-muted font-mono uppercase">
            <span>1 // CONSERVATIVE</span>
            <span>10 // MAXIMUM VELOCITY</span>
          </div>

          {/* Info */}
          <p className="text-xs text-text-muted font-mono">
            HIGHER CONCURRENCY = FASTER PROCESSING • ENSURE AGENT AVAILABILITY
          </p>
        </div>
      </GlassPanel>

      {/* Navigation */}
      <div className="flex justify-between pt-6">
        <Button
          onClick={onBack}
          variant="outline"
          className="gap-2 border-white/10 text-text-secondary hover:text-text-primary hover:bg-white/5"
        >
          <ArrowLeft className="h-4 w-4" />
          BACK
        </Button>
        <Button
          onClick={onContinue}
          disabled={!canContinue}
          size="lg"
          className={cn(
            'gap-2 font-display uppercase tracking-widest',
            'bg-neon-violet hover:bg-neon-violet/80 text-white',
            'shadow-[0_0_15px_rgba(156,74,255,0.3)]',
            'disabled:opacity-50 disabled:shadow-none'
          )}
        >
          REVIEW & LAUNCH
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
