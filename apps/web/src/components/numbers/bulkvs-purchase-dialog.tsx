'use client';

import { CheckCircle, Loader2, Phone, Search } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/lib/api';
import { cn, formatPhoneNumber } from '@/lib/utils';

interface BulkvsNumber {
  id: string;
  number: string;
  metadata?: {
    npa?: string;
    rateCenter?: string;
    state?: string;
    tier?: string;
  };
}

interface AddResult {
  phoneNumber: {
    id: string;
    number: string;
    status: string;
  };
}

interface BulkvsAddDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Step = 'search' | 'confirm' | 'success';

export function BulkvsPurchaseDialog({ open, onOpenChange, onSuccess }: BulkvsAddDialogProps) {
  const [step, setStep] = useState<Step>('search');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [areaCode, setAreaCode] = useState('');
  const [numbers, setNumbers] = useState<BulkvsNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<BulkvsNumber | null>(null);
  const [destination, setDestination] = useState('');

  const [addResult, setAddResult] = useState<AddResult | null>(null);

  useEffect(() => {
    if (!open) {
      setStep('search');
      setError(null);
      setAreaCode('');
      setNumbers([]);
      setSelectedNumber(null);
      setDestination('');
      setAddResult(null);
    }
  }, [open]);

  const handleSearch = async () => {
    if (!areaCode || areaCode.length !== 3) {
      setError('Please enter a valid 3-digit area code');
      return;
    }

    setLoading(true);
    setError(null);
    setNumbers([]);
    try {
      const response = await apiClient.get<{
        data: BulkvsNumber[];
        meta?: { count: number };
        error?: { message: string };
      }>(`/api/v1/bulkvs/available?areaCode=${encodeURIComponent(areaCode)}`);

      // Check for API-level errors (non-200 responses)
      if (response.error) {
        setError(response.error.message || 'Failed to search numbers');
        return;
      }

      // Check for application-level errors in the response body
      if (response.data?.error) {
        setError(response.data.error.message || 'Failed to find numbers');
        return;
      }

      if (response.data?.data && response.data.data.length > 0) {
        setNumbers(response.data.data);
      }
      // If no numbers found and no error, the UI will show "No numbers available"
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to search numbers';
      const apiError = (err as { response?: { data?: { error?: { message?: string } } } })?.response
        ?.data?.error?.message;
      setError(apiError || message);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = (num: BulkvsNumber) => {
    setSelectedNumber(num);
    setStep('confirm');
  };

  const handleAdd = async () => {
    if (!selectedNumber) return;

    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.post<{
        success: boolean;
        data: AddResult;
        error?: { message: string };
      }>('/api/v1/bulkvs/purchase', {
        number: selectedNumber.id, // Add specific number to purchase (id holds the provider ID/raw TN)
        areaCode: selectedNumber.metadata?.npa || areaCode,
        destination: destination ? destination.trim() : undefined,
      });

      // Check for API-level errors (non-200 responses)
      if (response.error) {
        setError(response.error.message || 'Failed to purchase number');
        return;
      }

      if (response.data?.success) {
        setAddResult(response.data.data);
        setStep('success');
        onSuccess?.();
      } else {
        setError(response.data?.error?.message || 'Failed to purchase number. Please try again.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add number');
    } finally {
      setLoading(false);
    }
  };

  const renderStep = () => {
    switch (step) {
      case 'search':
        return (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground mb-4">
              Enter a 3-digit area code to search for available Hopwhistle numbers.
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Area code (e.g. 310)"
                  value={areaCode}
                  onChange={e => setAreaCode(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  className="pl-10"
                  maxLength={3}
                  onKeyDown={e => e.key === 'Enter' && handleSearch()}
                />
              </div>
              <Button onClick={handleSearch} disabled={loading || areaCode.length !== 3}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Search'}
              </Button>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">Searching inventory...</p>
              </div>
            ) : numbers.length > 0 ? (
              <div className="h-[300px] mt-4 pr-4 overflow-y-auto">
                <div className="space-y-2">
                  {numbers.map(num => (
                    <button
                      key={num.id}
                      onClick={() => handleSelect(num)}
                      className={cn(
                        'w-full flex items-center justify-between p-4 rounded-xl border border-border bg-card transition-all',
                        'hover:bg-accent hover:border-primary/50 group shadow-sm'
                      )}
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition-colors">
                          <Phone className="h-5 w-5 text-primary" />
                        </div>
                        <div className="text-left">
                          <div className="font-mono text-lg font-semibold tracking-tight">
                            {formatPhoneNumber(num.number)}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 font-medium uppercase tracking-wider">
                            {num.metadata?.rateCenter}, {num.metadata?.state}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : areaCode.length === 3 && !error && !loading ? (
              <div className="text-center py-8 text-muted-foreground">
                No numbers available in this area code.
              </div>
            ) : null}
          </div>
        );

      case 'confirm':
        return (
          <div className="space-y-6">
            <div className="text-sm text-muted-foreground mb-4">
              Review your purchase before confirming.
            </div>
            <Button variant="ghost" size="sm" onClick={() => setStep('search')}>
              ← Back to Search
            </Button>

            <div className="border rounded-lg p-6 space-y-4 bg-card">
              <h3 className="font-semibold text-lg">Number Summary</h3>

              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Phone Number</span>
                  <span className="font-medium font-mono">
                    {selectedNumber ? formatPhoneNumber(selectedNumber.number) : ''}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Location</span>
                  <span className="font-medium">
                    {selectedNumber?.metadata?.rateCenter}, {selectedNumber?.metadata?.state}
                  </span>
                </div>
              </div>

              <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground">
                <CheckCircle className="h-4 w-4 inline mr-1" />
                Your number will be immediately provisioned and routed to your account.
              </div>

              <div className="space-y-4 border-t pt-4 mt-4">
                <div className="space-y-2">
                  <label
                    htmlFor="destination"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Forwarding Destination (Optional)
                  </label>
                  <Input
                    id="destination"
                    placeholder="+1234567890 or 1000,1001|+15555555555"
                    value={destination}
                    onChange={e => setDestination(e.target.value)}
                  />
                  <p className="text-[0.8rem] text-muted-foreground">
                    Where should inbound calls be routed? Leave blank to configure later.
                  </p>
                </div>
              </div>
            </div>
          </div>
        );

      case 'success':
        return (
          <div className="space-y-6 text-center py-6">
            <div className="flex justify-center">
              <div className="h-16 w-16 rounded-full bg-green-500/20 flex items-center justify-center">
                <CheckCircle className="h-10 w-10 text-green-500" />
              </div>
            </div>
            <div>
              <h3 className="text-xl font-semibold mb-2">Number Added!</h3>
              <p className="text-2xl font-mono text-primary">
                {addResult ? formatPhoneNumber(addResult.phoneNumber.number) : ''}
              </p>
            </div>

            <p className="text-sm text-muted-foreground">
              Your number is now active and routed to your SIP server.
            </p>
          </div>
        );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {step === 'success' ? 'Number Added' : 'Add Phone Number (Hopwhistle)'}
          </DialogTitle>
          <DialogDescription>
            {step === 'success'
              ? 'Your new number is ready to use'
              : 'Search and add numbers from the Hopwhistle inventory.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-hidden py-4">{renderStep()}</div>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
        )}

        <DialogFooter>
          {step === 'confirm' ? (
            <>
              <Button variant="outline" onClick={() => setStep('search')} disabled={loading}>
                Back
              </Button>
              <Button onClick={handleAdd} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Number
              </Button>
            </>
          ) : step === 'success' ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
