'use client';

import { useState, useCallback } from 'react';
import { Phone, HelpCircle, CheckCircle2, ChevronRight, ChevronLeft, ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface UnderwritingScriptPanelProps {
  prospectData?: any;
  onDataUpdate?: (data: Record<string, unknown>) => void;
}

type StepId = 'step1' | 'step2' | 'step2a' | 'step2b' | 'step2b_yes' | 'step2b_no' | 'wrapup';

interface StepContent {
  id: StepId;
  phase: number;
  title: string;
  subtitle?: string;
  script: string;
  stageDirection?: string;
  options?: Array<{
    label: string;
    nextStep: StepId;
    color?: 'emerald' | 'red' | 'blue' | 'amber';
  }>;
  nextStep?: StepId;
  isEndNode?: boolean;
}

const STEPS: Record<StepId, StepContent> = {
  step1: {
    id: 'step1',
    phase: 1,
    title: 'Call TransAmerica Underwriting',
    subtitle: 'Initiate call and authenticate agent credentials',
    script: `Please place a call to TransAmerica Underwriting & Policy Servicing.

• Phone Number: 1-877-234-4848
• Select Option 1 (Underwriting / Policy Servicing)

Once a representative answers, introduce yourself:
"Hello, I am the underwriting assistant for Yazzyl Vasquez and American Beneficiary LLC. I need to check the status of a policy."

If requested, verify Yazzyl's Agent Credentials:
• Agent Number: MLSR181715`,
    stageDirection: 'Introduce yourself professionally and wait for the representative to pull up the system.',
    nextStep: 'step2',
  },
  step2: {
    id: 'step2',
    phase: 2,
    title: 'Determine Policy Status',
    subtitle: 'Ask the representative for the current status of the customer\'s policy',
    script: `Ask the representative:
"Could you please check the current status of the policy?"

Depending on the status they report, select the corresponding path below:`,
    stageDirection: 'Listen carefully to the representative and select the policy status.',
    options: [
      { label: 'Policy shows "Reversed Premium Payment"', nextStep: 'step2a', color: 'amber' },
      { label: 'Policy shows "Lapsed Notice"', nextStep: 'step2b', color: 'red' },
    ],
  },
  step2a: {
    id: 'step2a',
    phase: 3,
    title: 'Reversed Premium Payment Flow',
    subtitle: 'Ask about premium payment resolution',
    script: `Ask the representative the following questions regarding the reversed payment:

1. "When a policy shows as 'reversed premium payment', how can the customer pay the missed premium?"
2. "Can we run the payment for them?"
3. "Does the customer need to call TransAmerica to pay?"
4. "Does the payment need to happen same day, or can we set it for a future date again?"`,
    stageDirection: 'Write down all the answers in the Live Call Notes text area on the left panel.',
    nextStep: 'wrapup',
  },
  step2b: {
    id: 'step2b',
    phase: 3,
    title: 'Lapsed Notice Status Check',
    subtitle: 'Check if a new application is required',
    script: `Ask the representative:
"When a policy shows as 'lapsed notice', does a new application need to be signed and new payment made?"`,
    stageDirection: 'Confirm if reinstatement requires a new application or if they can simply pay.',
    options: [
      { label: 'Yes - New Application Required', nextStep: 'step2b_yes', color: 'red' },
      { label: 'No - New Application NOT Required', nextStep: 'step2b_no', color: 'emerald' },
    ],
  },
  step2b_yes: {
    id: 'step2b_yes',
    phase: 4,
    title: 'Lapsed - New Application Required',
    subtitle: 'Inform customer of next steps',
    script: `The representative confirmed a new application is required.

Advise the customer:
"Since the policy has lapsed, TransAmerica requires us to sign a new application to set up a new policy and secure the coverage again."`,
    stageDirection: 'Make a note of this requirement and prepare to assist the customer with a new application process.',
    nextStep: 'wrapup',
  },
  step2b_no: {
    id: 'step2b_no',
    phase: 4,
    title: 'Lapsed - Pay Missed Premium',
    subtitle: 'Gather payment instructions',
    script: `The representative confirmed a new application is NOT required. Ask the follow-up questions:

1. "How can the customer pay the missed premium?"
2. "Can we run the payment for them?"
3. "Does the customer need to call TransAmerica to pay? If so, what phone number do they call?"
4. "Does the payment need to happen same day, or can we set it for a future date again?"`,
    stageDirection: 'Write down the exact phone number and payment rules in the Live Call Notes on the left panel.',
    nextStep: 'wrapup',
  },
  wrapup: {
    id: 'wrapup',
    phase: 5,
    title: 'Wrap Up & Document Call',
    subtitle: 'Ensure call notes are saved',
    script: `Wrap up the conversation with the representative:
"Thank you for your assistance. I have all the information I need."

Double check that you have captured:
• Payment methods allowed
• Phone numbers to call (if any)
• Payment timing constraints (same day vs future date)
• Reinstatement / New App requirement details

End the call when ready. Your call notes will be automatically appended to the call disposition record.`,
    stageDirection: 'Confirm notes are complete and click "Call Complete".',
    isEndNode: true,
  },
};

export function UnderwritingScriptPanel({
  prospectData,
  onDataUpdate,
}: UnderwritingScriptPanelProps): JSX.Element {
  const [activeStepId, setActiveStepId] = useState<StepId>('step1');
  const [history, setHistory] = useState<StepId[]>([]);

  const currentStep = STEPS[activeStepId] || STEPS.step1;

  // Progress percentage (based on phases 1 to 5)
  const progress = Math.round((currentStep.phase / 5) * 100);

  const navigateTo = useCallback(
    (stepId: StepId) => {
      setHistory(prev => [...prev, activeStepId]);
      setActiveStepId(stepId);
    },
    [activeStepId]
  );

  const goBack = useCallback(() => {
    if (history.length > 0) {
      const prevStepId = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      setActiveStepId(prevStepId);
    }
  }, [history]);

  const handleOptionSelect = useCallback(
    (nextStep: StepId) => {
      navigateTo(nextStep);
    },
    [navigateTo]
  );

  const handleContinue = useCallback(() => {
    if (currentStep.nextStep) {
      navigateTo(currentStep.nextStep);
    }
  }, [currentStep, navigateTo]);

  return (
    <div className="h-full flex flex-col overflow-auto bg-background text-foreground">
      {/* Header Banner */}
      <div className="bg-muted border-b border-[#2e2e3e] p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-500/20 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-cyan-400 uppercase tracking-wider">📋 TransAmerica Underwriting Script</h2>
              <p className="text-xs text-muted-foreground">
                Step-by-step carrier policy lookup and underwriting inquiries
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-cyan-400 bg-cyan-500/10 border border-cyan-500/30 px-2 py-1 rounded">
            Phase {currentStep.phase} / 5
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Script Content */}
      <div className="flex-1 p-6 overflow-auto space-y-4">
        {/* Node Card */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-8 h-8 bg-cyan-500/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <HelpCircle className="w-4 h-4 text-cyan-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-base">{currentStep.title}</h3>
              {currentStep.subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{currentStep.subtitle}</p>
              )}
            </div>
          </div>

          {/* Script instructions */}
          <div className="bg-muted border border-border rounded-lg p-4 mb-4">
            <p className="text-white whitespace-pre-line leading-relaxed text-sm">{currentStep.script}</p>
          </div>

          {/* Stage Directions */}
          {currentStep.stageDirection && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 mb-4">
              <span className="text-xs text-amber-200">
                <strong>Instruction:</strong> {currentStep.stageDirection}
              </span>
            </div>
          )}

          {/* Options */}
          {currentStep.options && currentStep.options.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide font-mono">Select Response Path:</p>
              <div className="grid gap-2">
                {currentStep.options.map((option, index) => {
                  const colorClasses = {
                    emerald: 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400',
                    red: 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20 text-red-400',
                    blue: 'bg-cyan-500/10 border-cyan-500/30 hover:bg-cyan-500/20 text-cyan-400',
                    amber: 'bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 text-amber-400',
                  };
                  const buttonClass = option.color
                    ? colorClasses[option.color]
                    : 'bg-slate-700/50 border-white/10 text-white hover:bg-slate-600/50';

                  return (
                    <Button
                      key={index}
                      variant="outline"
                      size="default"
                      onClick={() => handleOptionSelect(option.nextStep)}
                      className={cn('justify-start text-left w-full border font-medium text-sm transition-all', buttonClass)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Continue Button */}
          {!currentStep.options && currentStep.nextStep && !currentStep.isEndNode && (
            <Button
              onClick={handleContinue}
              size="default"
              className="w-full bg-cyan-500 text-white hover:bg-cyan-600 transition-colors"
            >
              Continue
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          )}

          {/* End Node Complete Alert */}
          {currentStep.isEndNode && (
            <div className="flex items-center gap-3 p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
              <CheckCircle2 className="w-6 h-6 text-emerald-400 flex-shrink-0" />
              <div>
                <p className="text-emerald-400 font-bold text-sm">Underwriting Inquiry Complete</p>
                <p className="text-emerald-200/70 text-xs mt-0.5">Please ensure notes are finalized and complete the call.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between p-4 border-t border-border bg-card flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={goBack}
          disabled={history.length === 0}
          className="border-border text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>

        <span className="text-xs text-muted-foreground font-mono">
          {history.length} step{history.length !== 1 ? 's' : ''} navigated
        </span>
      </div>
    </div>
  );
}

export default UnderwritingScriptPanel;
