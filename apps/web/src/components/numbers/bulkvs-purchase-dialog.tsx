'use client';

import {
  CheckCircle,
  DollarSign,
  Loader2,
  MapPin,
  Phone,
  Search,
  ShoppingCart,
} from 'lucide-react';
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
import { cn } from '@/lib/utils';
import { formatPhoneNumber } from '@/lib/utils';

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

interface PurchaseResult {
  phoneNumber: {
    id: string;
    number: string;
    status: string;
  };
  billing: {
    invoiceId: string;
    invoiceNumber: string;
    setupFee: number;
    monthlyFee: number;
    total: number;
  };
}

interface BulkvsPurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

type Step = 'search' | 'confirm' | 'success';

export function BulkvsPurchaseDialog({ open, onOpenChange, onSuccess }: BulkvsPurchaseDialogProps) {
  const [step, setStep] = useState<Step>('search');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [areaCode, setAreaCode] = useState('');
  const [numbers, setNumbers] = useState<BulkvsNumber[]>([]);
  const [selectedNumber, setSelectedNumber] = useState<BulkvsNumber | null>(null);
  const [destination, setDestination] = useState('');

  const [purchaseResult, setPurchaseResult] = useState<PurchaseResult | null>(null);

  // Pricing constants based on our route implementation
  const SETUP_FEE = 1.00;
  const MONTHLY_FEE = 1.50;

  useEffect(() => {
    if (!open) {
      setStep('search');
      setError(null);
      setAreaCode('');
      setNumbers([]);
      setSelectedNumber(null);
      setDestination('');
      setPurchaseResult(null);
    }
  }, [open]);

  const handleSearch = async () => {
    if (!areaCode || areaCode.length !== 3) {
      setError('Please enter a valid 3-digit area code');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.get<{
        data: BulkvsNumber[];
        error?: { message: string };
      }>(`/api/v1/bulkvs/available?areaCode=${encodeURIComponent(areaCode)}`);

      if (response.data?.data) {
        setNumbers(response.data.data);
      } else if (response.data?.error) {
        setError(response.data.error.message || 'Failed to find numbers');
      }
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

  const handlePurchase = async () => {
    if (!selectedNumber) return;

    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.post<{
        success: boolean;
        data: PurchaseResult;
      }>('/api/v1/bulkvs/purchase', {
        areaCode: selectedNumber.metadata?.npa || areaCode,
        destination: destination ? destination.trim() : undefined,
      });

      if (response.data?.success) {
        setPurchaseResult(response.data.data);
        setStep('success');
        onSuccess?.();
      } else {
        throw new Error('Purchase failed');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to purchase number');
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price: number) => `$${price.toFixed(2)}`;

  const renderStep = () => {
    switch (step) {
      case 'search':
        return (
          <div className="space-y-4">
            <div className="text-sm text-muted-foreground mb-4">
              Enter a 3-digit area code to search for available BulkVS numbers.
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
              <div className="space-y-2 max-h-[300px] overflow-y-auto mt-4 pr-2">
                {numbers.map(num => (
                  <button
                    key={num.id}
                    onClick={() => handleSelect(num)}
                    className={cn(
                      'w-full flex items-center justify-between p-3 rounded-md border transition-all',
                      'hover:bg-accent hover:border-primary group'
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Phone className="h-5 w-5 text-muted-foreground" />
                      <div className="text-left">
                        <div className="font-medium">{formatPhoneNumber(num.number)}</div>
                        <div className="text-xs text-muted-foreground">
                          {num.metadata?.rateCenter}, {num.metadata?.state}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right text-xs text-muted-foreground">
                        <div>Setup: {formatPrice(SETUP_FEE)}</div>
                        <div>Monthly: {formatPrice(MONTHLY_FEE)}</div>
                      </div>
                      <ShoppingCart className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  </button>
                ))}
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
              <h3 className="font-semibold text-lg">Order Summary</h3>

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
                <div className="border-t pt-3 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Setup Fee</span>
                    <span>{formatPrice(SETUP_FEE)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Monthly Fee (prorated)</span>
                    <span>{formatPrice(MONTHLY_FEE)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-lg border-t pt-2">
                    <span>Total Due Today</span>
                    <span className="text-primary">
                      {formatPrice(SETUP_FEE + MONTHLY_FEE)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground">
                <DollarSign className="h-4 w-4 inline mr-1" />
                Your number will be immediately provisioned and routed to your account.
              </div>

              <div className="space-y-4 border-t pt-4 mt-4">
                <div className="space-y-2">
                  <label htmlFor="destination" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                    Forwarding Destination (Optional)
                  </label>
                  <Input
                    id="destination"
                    placeholder="+1234567890 or 1000,1001|+15555555555"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
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
              <h3 className="text-xl font-semibold mb-2">Number Purchased!</h3>
              <p className="text-2xl font-mono text-primary">
                {purchaseResult ? formatPhoneNumber(purchaseResult.phoneNumber.number) : ''}
              </p>
            </div>

            <div className="border rounded-lg p-4 text-left space-y-2 bg-card">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Invoice</span>
                <span className="font-mono">{purchaseResult?.billing.invoiceNumber}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Total Charged</span>
                <span className="font-medium text-primary">
                  {formatPrice(purchaseResult?.billing.total || 0)}
                </span>
              </div>
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
            {step === 'success' ? 'Purchase Complete' : 'Purchase Phone Number (BulkVS)'}
          </DialogTitle>
          <DialogDescription>
            {step === 'success'
              ? 'Your new number is ready to use'
              : 'Search and purchase numbers from the BulkVS inventory.'}
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
              <Button onClick={handlePurchase} disabled={loading}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Purchase
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
