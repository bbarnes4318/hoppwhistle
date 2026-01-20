'use client';

import { ChevronRight, ChevronLeft, HelpCircle, Lightbulb, AlertCircle } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ContextPanelProps {
  currentStep: number;
}

const STEP_CONTEXT: Record<number, { title: string; tips: string[]; warnings?: string[] }> = {
  1: {
    title: 'Voice & Script Tips',
    tips: [
      'Choose a voice that matches your brand personality',
      'Keep scripts conversational, not robotic',
      'Use {name} and {company} for personalization',
      'Aim for 30-60 seconds of speaking time',
      'Preview your voice to ensure it sounds natural',
    ],
  },
  2: {
    title: 'Routing Setup',
    tips: [
      'The transfer number receives qualified leads',
      'Ensure someone is available to answer transfers',
      'Caller ID affects answer rates significantly',
      'Local numbers typically perform 2-3x better',
    ],
    warnings: ['Random caller ID may reduce answer rates'],
  },
  3: {
    title: 'Lead Upload Guide',
    tips: [
      'CSV format: phone number in first column',
      'Optional: name in second column',
      'Remove duplicates before uploading',
      'Start with a small batch to test',
      'Higher concurrency = faster but more resource intensive',
    ],
  },
  4: {
    title: 'Before You Launch',
    tips: [
      'Review all settings one more time',
      'Ensure transfer destination is staffed',
      'Start with low concurrency for new campaigns',
      'Monitor the first few calls closely',
    ],
    warnings: ['Calls cannot be recalled once started'],
  },
};

export function ContextPanel({ currentStep }: ContextPanelProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const context = STEP_CONTEXT[currentStep] || STEP_CONTEXT[1];

  if (isCollapsed) {
    return (
      <div className="flex flex-col items-center py-4 px-2 border-l bg-muted/30">
        <Button variant="ghost" size="icon" onClick={() => setIsCollapsed(false)} className="mb-4">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <HelpCircle className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="w-80 border-l bg-muted/30 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm">{context.title}</span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => setIsCollapsed(true)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Tips */}
        <div className="space-y-3">
          {context.tips.map((tip, index) => (
            <div key={index} className="flex gap-3 text-sm">
              <Lightbulb className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span className="text-muted-foreground">{tip}</span>
            </div>
          ))}
        </div>

        {/* Warnings */}
        {context.warnings && context.warnings.length > 0 && (
          <div className="pt-4 border-t space-y-3">
            {context.warnings.map((warning, index) => (
              <div key={index} className="flex gap-3 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <span className="text-amber-600 dark:text-amber-400">{warning}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
