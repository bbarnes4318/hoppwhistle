'use client';

import {
  CheckCircle,
  AlertTriangle,
  ArrowLeft,
  Play,
  Volume2,
  Phone,
  Users,
  Settings,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface StepStatus {
  complete: boolean;
  warnings: string[];
}

interface Step4ReviewLaunchProps {
  campaignName: string;
  voiceName: string;
  transferNumber: string;
  callerId: string;
  leadCount: number;
  concurrency: number;
  stepStatuses: {
    step1: StepStatus;
    step2: StepStatus;
    step3: StepStatus;
  };
  isReady: boolean;
  onStart: () => void;
  onBack: () => void;
  onGoToStep: (step: number) => void;
}

export function Step4ReviewLaunch({
  campaignName,
  voiceName,
  transferNumber,
  callerId,
  leadCount,
  concurrency,
  stepStatuses,
  isReady,
  onStart,
  onBack,
  onGoToStep,
}: Step4ReviewLaunchProps) {
  const allWarnings = [
    ...stepStatuses.step1.warnings,
    ...stepStatuses.step2.warnings,
    ...stepStatuses.step3.warnings,
  ];

  const estimatedDuration =
    leadCount > 0
      ? Math.ceil(leadCount / concurrency / 60) // rough estimate in hours
      : 0;

  return (
    <div className="space-y-6">
      {/* Ready to Launch Header */}
      <div className="text-center py-4">
        <h2 className="text-2xl font-bold text-green-600">Ready to Launch</h2>
        <p className="text-muted-foreground mt-2">
          Review everything below. Once started, calls will begin immediately.
        </p>
      </div>

      {/* Key Metrics Highlight */}
      <div className="grid grid-cols-3 gap-4 p-4 rounded-lg bg-muted/50 border">
        <div className="text-center">
          <p className="text-3xl font-bold text-primary">{leadCount}</p>
          <p className="text-sm text-muted-foreground">Leads to call</p>
        </div>
        <div className="text-center border-x">
          <p className="text-3xl font-bold text-primary">{concurrency}</p>
          <p className="text-sm text-muted-foreground">Concurrent calls</p>
        </div>
        <div className="text-center">
          <p className="text-lg font-bold text-primary font-mono">{transferNumber || 'Not set'}</p>
          <p className="text-sm text-muted-foreground">Transfer to</p>
        </div>
      </div>

      {/* Summary Header */}
      <Card>
        <CardHeader>
          <CardTitle>Configuration Checklist</CardTitle>
          <CardDescription>Review your settings before launching "{campaignName}"</CardDescription>
        </CardHeader>
        <CardContent>
          {/* Checklist */}
          <div className="space-y-4">
            {/* Step 1 Check */}
            <div
              className="flex items-center justify-between p-4 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onGoToStep(1)}
            >
              <div className="flex items-center gap-3">
                {stepStatuses.step1.complete ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <Volume2 className="h-4 w-4 text-muted-foreground" />
                    Voice & Script
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {voiceName ? `Using ${voiceName}` : 'No voice selected'}
                  </p>
                </div>
              </div>
              <Badge variant={stepStatuses.step1.complete ? 'default' : 'destructive'}>
                {stepStatuses.step1.complete ? 'Complete' : 'Incomplete'}
              </Badge>
            </div>

            {/* Step 2 Check */}
            <div
              className="flex items-center justify-between p-4 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onGoToStep(2)}
            >
              <div className="flex items-center gap-3">
                {stepStatuses.step2.complete ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <Phone className="h-4 w-4 text-muted-foreground" />
                    Routing & Numbers
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Transfer to {transferNumber || 'Not set'} • Caller ID: {callerId || 'Random'}
                  </p>
                </div>
              </div>
              <Badge variant={stepStatuses.step2.complete ? 'default' : 'destructive'}>
                {stepStatuses.step2.complete ? 'Complete' : 'Incomplete'}
              </Badge>
            </div>

            {/* Step 3 Check */}
            <div
              className="flex items-center justify-between p-4 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => onGoToStep(3)}
            >
              <div className="flex items-center gap-3">
                {stepStatuses.step3.complete ? (
                  <CheckCircle className="h-5 w-5 text-green-500" />
                ) : (
                  <AlertTriangle className="h-5 w-5 text-amber-500" />
                )}
                <div>
                  <p className="font-medium flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Leads & Settings
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {leadCount} leads • {concurrency} concurrent calls
                  </p>
                </div>
              </div>
              <Badge variant={stepStatuses.step3.complete ? 'default' : 'destructive'}>
                {stepStatuses.step3.complete ? 'Complete' : 'Incomplete'}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Estimates & Warnings */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Estimates */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Settings className="h-4 w-4" />
              Campaign Estimate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Total Leads</span>
                <span className="font-medium">{leadCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Concurrency</span>
                <span className="font-medium">{concurrency} calls</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Duration</span>
                <span className="font-medium">
                  {estimatedDuration > 0 ? `~${estimatedDuration}h` : '—'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Warnings */}
        {allWarnings.length > 0 && (
          <Card className="border-amber-200 dark:border-amber-900">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-amber-600">
                <AlertTriangle className="h-4 w-4" />
                Notes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {allWarnings.map((warning, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400"
                  >
                    <span>•</span>
                    {warning}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Launch CTA */}
      <div className="flex justify-between items-center pt-4">
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button
          onClick={onStart}
          disabled={!isReady}
          size="lg"
          className="gap-2 bg-green-600 hover:bg-green-700 px-8"
        >
          <Play className="h-5 w-5" />
          Start Campaign
        </Button>
      </div>
    </div>
  );
}
