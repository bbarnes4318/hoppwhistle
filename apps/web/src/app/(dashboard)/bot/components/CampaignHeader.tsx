'use client';

import { Pause, Play, Square, Pencil, Check, X } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

import { CampaignStepper, StepState } from './CampaignStepper';

export type CampaignStatus = 'idle' | 'running' | 'paused' | 'complete' | 'error';

interface CampaignHeaderProps {
  campaignName: string;
  onCampaignNameChange: (name: string) => void;
  status: CampaignStatus;
  currentStep: number;
  steps: StepState[];
  onStepClick: (step: number) => void;
  isReady: boolean;
  onStart: () => void;
  onPause: () => void;
  onStop: () => void;
  canEditName: boolean;
}

export function CampaignHeader({
  campaignName,
  onCampaignNameChange,
  status,
  currentStep,
  steps,
  onStepClick,
  isReady,
  onStart,
  onPause,
  onStop,
  canEditName,
}: CampaignHeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(campaignName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSaveName = () => {
    if (editValue.trim()) {
      onCampaignNameChange(editValue.trim());
    } else {
      setEditValue(campaignName);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValue(campaignName);
    setIsEditing(false);
  };

  const getStatusBadge = () => {
    const variants: Record<
      CampaignStatus,
      {
        variant: 'default' | 'secondary' | 'destructive' | 'outline';
        label: string;
        className?: string;
      }
    > = {
      idle: { variant: 'secondary', label: 'Not Ready' },
      running: { variant: 'default', label: 'Running', className: 'bg-blue-600 animate-pulse' },
      paused: { variant: 'outline', label: 'Paused', className: 'border-amber-500 text-amber-600' },
      complete: { variant: 'default', label: 'Complete', className: 'bg-green-600' },
      error: { variant: 'destructive', label: 'Error' },
    };

    // Override idle status if ready
    if (status === 'idle' && isReady) {
      return <Badge className="bg-green-600">Ready</Badge>;
    }

    const { variant, label, className } = variants[status];
    return (
      <Badge variant={variant} className={className}>
        {label}
      </Badge>
    );
  };

  const getPrimaryAction = () => {
    switch (status) {
      case 'running':
        return (
          <Button onClick={onPause} variant="outline" className="gap-2">
            <Pause className="h-4 w-4" />
            Pause Campaign
          </Button>
        );
      case 'paused':
        return (
          <Button onClick={onStart} className="gap-2 bg-green-600 hover:bg-green-700">
            <Play className="h-4 w-4" />
            Resume Campaign
          </Button>
        );
      default:
        return (
          <Button
            onClick={onStart}
            disabled={!isReady}
            className="gap-2 bg-green-600 hover:bg-green-700 disabled:opacity-50"
          >
            <Play className="h-4 w-4" />
            {isReady ? 'Start Campaign' : 'Complete Setup'}
          </Button>
        );
    }
  };

  return (
    <div className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex items-center justify-between gap-4 px-6 py-4">
        {/* Left: Campaign Name + Status */}
        <div className="flex items-center gap-3 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <Input
                ref={inputRef}
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleSaveName();
                  if (e.key === 'Escape') handleCancelEdit();
                }}
                className="h-8 w-48"
              />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleSaveName}>
                <Check className="h-4 w-4 text-green-600" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={handleCancelEdit}>
                <X className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold truncate">{campaignName}</h1>
              {canEditName && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => setIsEditing(true)}
                >
                  <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                </Button>
              )}
            </div>
          )}
          {getStatusBadge()}
        </div>

        {/* Center: Stepper */}
        <div className="hidden md:flex flex-1 justify-center">
          <CampaignStepper steps={steps} currentStep={currentStep} onStepClick={onStepClick} />
        </div>

        {/* Right: Primary Action + Stop */}
        <div className="flex items-center gap-2 shrink-0">
          {getPrimaryAction()}
          {(status === 'running' || status === 'paused') && (
            <Button onClick={onStop} variant="destructive" size="icon">
              <Square className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
