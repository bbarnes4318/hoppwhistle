'use client';

import { Check, AlertTriangle } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface StepState {
  id: number;
  label: string;
  complete: boolean;
  hasWarning: boolean;
}

interface CampaignStepperProps {
  steps: StepState[];
  currentStep: number;
  onStepClick: (step: number) => void;
}

export function CampaignStepper({ steps, currentStep, onStepClick }: CampaignStepperProps) {
  const canNavigateTo = (stepId: number) => {
    // Forward-only gating: can go to completed steps or the next unlocked step
    if (stepId <= currentStep) return true;
    // Can only go forward if all previous steps are complete
    for (let i = 0; i < stepId - 1; i++) {
      if (!steps[i]?.complete) return false;
    }
    return true;
  };

  return (
    <div className="flex items-center gap-2">
      {steps.map((step, index) => {
        const isActive = step.id === currentStep;
        const isComplete = step.complete;
        const isClickable = canNavigateTo(step.id);
        const showConnector = index < steps.length - 1;

        return (
          <div key={step.id} className="flex items-center">
            {/* Step Circle */}
            <button
              onClick={() => isClickable && onStepClick(step.id)}
              disabled={!isClickable}
              className={cn(
                'relative flex h-9 w-9 items-center justify-center rounded-full border-2 text-sm font-medium transition-all',
                isActive && 'border-primary bg-primary text-primary-foreground shadow-md scale-110',
                isComplete && !isActive && 'border-green-500 bg-green-500 text-white',
                !isComplete &&
                  !isActive &&
                  'border-muted-foreground/30 bg-background text-muted-foreground',
                isClickable && !isActive && 'hover:border-primary/50 cursor-pointer',
                !isClickable && 'opacity-50 cursor-not-allowed'
              )}
              title={step.label}
            >
              {isComplete && !isActive ? <Check className="h-4 w-4" /> : step.id}
              {/* Warning indicator */}
              {step.hasWarning && !isComplete && (
                <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-white">
                  <AlertTriangle className="h-2.5 w-2.5" />
                </span>
              )}
            </button>

            {/* Step Label (visible on larger screens) */}
            <span
              className={cn(
                'ml-2 hidden text-sm font-medium lg:block',
                isActive && 'text-primary',
                isComplete && !isActive && 'text-green-600',
                !isComplete && !isActive && 'text-muted-foreground'
              )}
            >
              {step.label}
            </span>

            {/* Connector Line */}
            {showConnector && (
              <div
                className={cn(
                  'mx-3 h-0.5 w-8 lg:w-12',
                  steps[index + 1]?.complete || (isComplete && currentStep > step.id)
                    ? 'bg-green-500'
                    : 'bg-muted-foreground/20'
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
