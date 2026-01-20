'use client';

import { Phone, PhoneForwarded, ArrowRight, ArrowLeft, Settings2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
    <div className="space-y-6">
      {/* Routing Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            Call Routing Setup
          </CardTitle>
          <CardDescription>
            Configure where qualified leads are transferred and how calls appear
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Transfer Number */}
          <div className="space-y-2">
            <Label htmlFor="transfer-number" className="flex items-center gap-2">
              <PhoneForwarded className="h-4 w-4 text-green-600" />
              Live Transfer Destination
            </Label>
            <Input
              id="transfer-number"
              value={transferPhoneNumber}
              onChange={e => onTransferPhoneNumberChange(e.target.value)}
              placeholder="+1 (555) 000-0000"
              className={`max-w-md ${transferPhoneNumber && !isTransferValid ? 'border-red-500 focus-visible:ring-red-500' : ''}`}
            />
            {transferPhoneNumber && !isTransferValid ? (
              <p className="text-sm text-red-500">
                Please enter a valid phone number (at least 10 digits)
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                When a lead qualifies, they'll be transferred to this number in real-time.
              </p>
            )}
          </div>

          {/* Caller ID */}
          <div className="space-y-2">
            <Label htmlFor="caller-id" className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-blue-600" />
              Outbound Caller ID
            </Label>
            <Select
              value={callerId || 'random'}
              onValueChange={v => onCallerIdChange(v === 'random' ? '' : v)}
            >
              <SelectTrigger className="max-w-md">
                <SelectValue placeholder="Random (Pool Rotation)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="random">
                  <span className="text-muted-foreground">Random (Pool Rotation)</span>
                </SelectItem>
                {availableDids.map(did => (
                  <SelectItem key={did} value={did}>
                    {did}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              The number displayed to leads when your AI calls them.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Call Flow Diagram */}
      <Card>
        <CardHeader>
          <CardTitle>How Calls Work</CardTitle>
          <CardDescription>Visual overview of the call qualification flow</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center gap-4 py-6">
            {/* AI Calls */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Phone className="h-8 w-8" />
              </div>
              <span className="text-sm font-medium">AI Calls Lead</span>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center gap-2">
              <ArrowRight className="h-6 w-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Qualifies</span>
            </div>

            {/* Qualification */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-900/50">
                <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <span className="text-sm font-medium">Qualification</span>
            </div>

            {/* Arrow */}
            <div className="flex flex-col items-center gap-2">
              <ArrowRight className="h-6 w-6 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">If qualified</span>
            </div>

            {/* Transfer */}
            <div className="flex flex-col items-center gap-2">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-600 dark:bg-green-900/50">
                <PhoneForwarded className="h-8 w-8" />
              </div>
              <span className="text-sm font-medium">Live Transfer</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between">
        <Button onClick={onBack} variant="outline" className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <Button onClick={onContinue} disabled={!isTransferValid} size="lg" className="gap-2">
          Continue
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
