'use client';

import { AlertTriangle, X } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface LaunchConfirmationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  leadCount: number;
  voiceName: string;
  transferNumber: string;
}

export function LaunchConfirmationModal({
  open,
  onOpenChange,
  onConfirm,
  leadCount,
  voiceName,
  transferNumber,
}: LaunchConfirmationModalProps) {
  const [confirmed, setConfirmed] = useState(false);

  const handleClose = () => {
    setConfirmed(false);
    onOpenChange(false);
  };

  const handleConfirm = () => {
    if (confirmed) {
      onConfirm();
      handleClose();
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Start Campaign?
          </DialogTitle>
          <DialogDescription className="text-base pt-2">
            Calls will begin immediately using your uploaded leads, selected voice, and routing
            settings.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Summary */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Leads to call</span>
              <span className="font-medium">{leadCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Voice</span>
              <span className="font-medium">{voiceName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Transfer to</span>
              <span className="font-medium font-mono">{transferNumber}</span>
            </div>
          </div>

          {/* Confirmation Checkbox */}
          <div className="flex items-start gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/20">
            <Checkbox
              id="confirm-launch"
              checked={confirmed}
              onCheckedChange={checked => setConfirmed(checked === true)}
              className="mt-0.5"
            />
            <label
              htmlFor="confirm-launch"
              className="text-sm font-medium text-amber-700 dark:text-amber-400 cursor-pointer"
            >
              I understand that calls will begin immediately
            </label>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!confirmed}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50"
          >
            Start Calling
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
