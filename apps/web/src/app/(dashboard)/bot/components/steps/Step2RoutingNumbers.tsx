'use client';

/**
 * Project Cortex | Step 2: Routing Numbers (Node Flow Interface)
 *
 * Call routing configuration with dark cyberpunk inputs.
 */

import { Phone, PhoneForwarded, ArrowRight, ArrowLeft, Workflow } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { GlassPanel, NodeConnector } from '@/components/ui/glass-panel';
import { NodeInput } from '@/components/ui/node-input';
import { NodeField } from '@/components/ui/node-label';
import { cn } from '@/lib/utils';

interface Step2RoutingNumbersProps {
  transferPhoneNumber: string;
  onTransferPhoneNumberChange: (value: string) => void;
  callerId: string;
  onCallerIdChange: (value: string) => void;
  availableDids: string[];
  onContinue: () => void;
  onBack: () => void;
}

export function Step2RoutingNumbers({
  transferPhoneNumber,
  onTransferPhoneNumberChange,
  callerId,
  onCallerIdChange,
  availableDids,
  onContinue,
  onBack,
}: Step2RoutingNumbersProps) {
  const isTransferValid = transferPhoneNumber.length >= 10;

  return (
    <div className="space-y-0">
      {/* NODE 01: Transfer Destination */}
      <GlassPanel
        active
        accentColor="violet"
        title="NODE 01 // TRANSFER ENDPOINT"
        subtitle="Where qualified leads are routed in real-time"
        icon={<PhoneForwarded className="h-5 w-5" />}
      >
        <NodeField
          label="LIVE TRANSFER DESTINATION"
          icon={<PhoneForwarded className="h-4 w-4" />}
          required
          hint="When a lead qualifies, they'll be transferred to this number"
          error={
            transferPhoneNumber && !isTransferValid
              ? 'Enter a valid phone number (10+ digits)'
              : undefined
          }
        >
          <NodeInput
            value={transferPhoneNumber}
            onChange={e => onTransferPhoneNumberChange(e.target.value)}
            placeholder="+1 (555) 000-0000"
            error={!!transferPhoneNumber && !isTransferValid}
          />
        </NodeField>
      </GlassPanel>

      {/* Node Connector */}
      <NodeConnector />

      {/* NODE 02: Caller ID */}
      <GlassPanel
        active={isTransferValid}
        accentColor="cyan"
        title="NODE 02 // CALLER ID"
        subtitle="The number displayed when your AI calls leads"
        icon={<Phone className="h-5 w-5" />}
      >
        <NodeField
          label="OUTBOUND CALLER ID"
          icon={<Phone className="h-4 w-4" />}
          hint="Leave empty to use pool rotation (recommended)"
        >
          <select
            value={callerId || 'random'}
            onChange={e => onCallerIdChange(e.target.value === 'random' ? '' : e.target.value)}
            className={cn(
              'flex h-10 w-full rounded-lg px-4 py-2',
              'bg-panel border border-white/10',
              'text-text-primary font-mono text-sm',
              'focus:outline-none focus:border-neon-cyan focus:ring-1 focus:ring-neon-cyan/30',
              'transition-all duration-200'
            )}
          >
            <option value="random" className="bg-panel">
              Random (Pool Rotation)
            </option>
            {availableDids.map(did => (
              <option key={did} value={did} className="bg-panel">
                {did}
              </option>
            ))}
          </select>
        </NodeField>
      </GlassPanel>

      {/* Node Connector */}
      <NodeConnector />

      {/* NODE 03: Flow Diagram */}
      <GlassPanel
        accentColor="lime"
        title="NODE 03 // SIGNAL FLOW"
        subtitle="Visual overview of the call qualification flow"
        icon={<Workflow className="h-5 w-5" />}
      >
        <div className="flex items-center justify-center gap-4 py-6">
          {/* AI Calls */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-neon-violet/10 border border-neon-violet/30">
              <Phone className="h-8 w-8 text-neon-violet" />
            </div>
            <span className="text-xs font-mono text-text-muted uppercase">AI CALLS</span>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-2">
            <ArrowRight className="h-6 w-6 text-neon-cyan" />
            <span className="text-[10px] text-neon-cyan font-mono">QUALIFIES</span>
          </div>

          {/* Qualification */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-toxic-lime/10 border border-toxic-lime/30">
              <svg
                className="h-8 w-8 text-toxic-lime"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
            <span className="text-xs font-mono text-text-muted uppercase">QUALIFIED</span>
          </div>

          {/* Arrow */}
          <div className="flex flex-col items-center gap-2">
            <ArrowRight className="h-6 w-6 text-neon-cyan" />
            <span className="text-[10px] text-neon-cyan font-mono">TRANSFER</span>
          </div>

          {/* Transfer */}
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-status-success/10 border border-status-success/30">
              <PhoneForwarded className="h-8 w-8 text-status-success" />
            </div>
            <span className="text-xs font-mono text-text-muted uppercase">LIVE AGENT</span>
          </div>
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
          disabled={!isTransferValid}
          size="lg"
          className={cn(
            'gap-2 font-display uppercase tracking-widest',
            'bg-neon-violet hover:bg-neon-violet/80 text-white',
            'shadow-[0_0_15px_rgba(156,74,255,0.3)]',
            'disabled:opacity-50 disabled:shadow-none'
          )}
        >
          CONTINUE TO LEADS
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
