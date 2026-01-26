'use client';

import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Publisher {
  id: string;
  name: string;
  code: string;
}

interface Buyer {
  id: string;
  name: string;
  code: string;
}

interface PhoneNumber {
  id: string;
  number: string;
  status: string;
  campaignId: string | null;
}

interface CreateCampaignWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// Country list with common options
const COUNTRIES = [
  { code: 'US', name: 'United States' },
  { code: 'CA', name: 'Canada' },
  { code: 'UK', name: 'United Kingdom' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'FR', name: 'France' },
  { code: 'ES', name: 'Spain' },
  { code: 'IT', name: 'Italy' },
  { code: 'MX', name: 'Mexico' },
  { code: 'BR', name: 'Brazil' },
];

const STEPS = [
  { id: 1, title: 'Basics', description: 'Campaign details' },
  { id: 2, title: 'Routing', description: 'Select buyers' },
  { id: 3, title: 'Numbers', description: 'Assign DID' },
];

export function CreateCampaignWizard({ open, onOpenChange, onSuccess }: CreateCampaignWizardProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Step 1: Basics
  const [name, setName] = useState('');
  const [publisherId, setPublisherId] = useState('');
  const [offerName, setOfferName] = useState('');
  const [country, setCountry] = useState('US');
  const [recordingEnabled, setRecordingEnabled] = useState(true);

  // Step 2: Routing (Buyers/Targets)
  const [selectedBuyers, setSelectedBuyers] = useState<string[]>([]);

  // Step 3: Numbers
  const [selectedNumberId, setSelectedNumberId] = useState('');

  // Data lists
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);

  // Created campaign ID (for assigning numbers)
  const [createdCampaignId, setCreatedCampaignId] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setCurrentStep(1);
    setName('');
    setPublisherId('');
    setOfferName('');
    setCountry('US');
    setRecordingEnabled(true);
    setSelectedBuyers([]);
    setSelectedNumberId('');
    setCreatedCampaignId(null);
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const [pubRes, buyerRes, numbersRes] = await Promise.all([
        apiClient.get<{ data: Publisher[] }>('/api/v1/publishers?limit=100'),
        apiClient.get<{ data: Buyer[] }>('/api/v1/buyers?limit=100'),
        apiClient.get<{ data: PhoneNumber[] }>('/api/v1/numbers?limit=100'),
      ]);

      if (pubRes.data) setPublishers(pubRes.data.data);
      if (buyerRes.data) setBuyers(buyerRes.data.data);
      if (numbersRes.data) {
        // Filter to show only unassigned numbers
        setPhoneNumbers(numbersRes.data.data.filter(n => !n.campaignId && n.status === 'ACTIVE'));
      }
    } catch (error) {
      console.error('Failed to load data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      resetForm();
      void loadInitialData();
    }
  }, [open, resetForm, loadInitialData]);

  const canProceedStep1 = name.trim() && publisherId;
  const canProceedStep2 = true; // Buyers are optional
  const canFinish = true; // Number assignment is optional

  const handleNext = async () => {
    if (currentStep === 1 && canProceedStep1) {
      setCurrentStep(2);
    } else if (currentStep === 2 && canProceedStep2) {
      // Create the campaign before moving to step 3
      setSaving(true);
      try {
        const response = await apiClient.post<{ id: string }>('/api/v1/campaigns', {
          name: name.trim(),
          publisherId,
          offerName: offerName.trim() || undefined,
          country,
          recordingEnabled,
          status: 'PAUSED', // Start as paused until fully configured
        });

        if (response.data) {
          setCreatedCampaignId(response.data.id);

          // TODO: Associate selected buyers with campaign (if buyer routing is implemented)
          // For now, we just store the selection but don't persist it

          setCurrentStep(3);
        }
      } catch (error) {
        console.error('Failed to create campaign:', error);
      } finally {
        setSaving(false);
      }
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleFinish = async () => {
    setSaving(true);
    try {
      // Assign phone number to campaign if selected
      if (selectedNumberId && createdCampaignId) {
        await apiClient.patch(`/api/v1/numbers/${selectedNumberId}`, {
          campaignId: createdCampaignId,
        });
      }

      // Optionally activate the campaign
      if (createdCampaignId) {
        await apiClient.patch(`/api/v1/campaigns/${createdCampaignId}`, {
          status: 'ACTIVE',
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      console.error('Failed to finish campaign setup:', error);
    } finally {
      setSaving(false);
    }
  };

  const toggleBuyer = (buyerId: string) => {
    setSelectedBuyers(prev =>
      prev.includes(buyerId) ? prev.filter(id => id !== buyerId) : [...prev, buyerId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create Campaign</DialogTitle>
          <DialogDescription>Set up a new campaign in 3 simple steps</DialogDescription>
        </DialogHeader>

        {/* Step Indicator */}
        <div className="flex items-center justify-between mb-6">
          {STEPS.map((step, index) => (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex items-center">
                <div
                  className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors',
                    currentStep === step.id
                      ? 'border-blue-600 bg-blue-600 text-white'
                      : currentStep > step.id
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-gray-300 bg-white text-gray-500'
                  )}
                >
                  {currentStep > step.id ? <Check className="h-4 w-4" /> : step.id}
                </div>
                <div className="ml-3">
                  <p
                    className={cn(
                      'text-sm font-medium',
                      currentStep >= step.id ? 'text-gray-900' : 'text-gray-500'
                    )}
                  >
                    {step.title}
                  </p>
                  <p className="text-xs text-gray-500">{step.description}</p>
                </div>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={cn(
                    'flex-1 h-0.5 mx-4',
                    currentStep > step.id ? 'bg-green-500' : 'bg-gray-200'
                  )}
                />
              )}
            </div>
          ))}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Step 1: Basics */}
            {currentStep === 1 && (
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">Campaign Name *</Label>
                  <Input
                    id="name"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="e.g., Medicare ACA 2025"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="publisher">Publisher *</Label>
                  <Select value={publisherId} onValueChange={setPublisherId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a publisher" />
                    </SelectTrigger>
                    <SelectContent>
                      {publishers.map(pub => (
                        <SelectItem key={pub.id} value={pub.id}>
                          {pub.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="offerName">Offer Name</Label>
                  <Input
                    id="offerName"
                    value={offerName}
                    onChange={e => setOfferName(e.target.value)}
                    placeholder="e.g., Final Expense 2025"
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="country">Country</Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map(c => (
                        <SelectItem key={c.code} value={c.code}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div className="space-y-0.5">
                    <Label htmlFor="recording">Enable Call Recording</Label>
                    <p className="text-xs text-muted-foreground">
                      Record all calls for this campaign
                    </p>
                  </div>
                  <Switch
                    id="recording"
                    checked={recordingEnabled}
                    onCheckedChange={setRecordingEnabled}
                  />
                </div>
              </div>
            )}

            {/* Step 2: Routing (Buyers/Targets) */}
            {currentStep === 2 && (
              <div className="space-y-4">
                <div>
                  <Label className="text-base">Select Buyers / Targets</Label>
                  <p className="text-sm text-muted-foreground mb-4">
                    Choose which buyers should receive calls from this campaign
                  </p>

                  {buyers.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg">
                      No buyers available. You can add buyers later.
                    </div>
                  ) : (
                    <div className="grid gap-2 max-h-64 overflow-y-auto border rounded-lg p-2">
                      {buyers.map(buyer => (
                        <button
                          key={buyer.id}
                          type="button"
                          onClick={() => toggleBuyer(buyer.id)}
                          className={cn(
                            'flex items-center justify-between p-3 rounded-lg border transition-colors text-left',
                            selectedBuyers.includes(buyer.id)
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:bg-gray-50'
                          )}
                        >
                          <div>
                            <p className="font-medium text-sm">{buyer.name}</p>
                            <p className="text-xs text-muted-foreground font-mono">{buyer.code}</p>
                          </div>
                          {selectedBuyers.includes(buyer.id) && (
                            <Check className="h-5 w-5 text-blue-600" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Step 3: Numbers */}
            {currentStep === 3 && (
              <div className="space-y-4">
                <div>
                  <Label className="text-base">Assign a Phone Number (DID)</Label>
                  <p className="text-sm text-muted-foreground mb-4">
                    Select a phone number to route incoming calls to this campaign
                  </p>

                  {phoneNumbers.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg">
                      <p>No available phone numbers.</p>
                      <p className="text-xs mt-1">Purchase a number first, or skip this step.</p>
                    </div>
                  ) : (
                    <div className="grid gap-2 max-h-64 overflow-y-auto border rounded-lg p-2">
                      {phoneNumbers.map(num => (
                        <button
                          key={num.id}
                          type="button"
                          onClick={() =>
                            setSelectedNumberId(num.id === selectedNumberId ? '' : num.id)
                          }
                          className={cn(
                            'flex items-center justify-between p-3 rounded-lg border transition-colors text-left',
                            selectedNumberId === num.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:bg-gray-50'
                          )}
                        >
                          <div>
                            <p className="font-medium text-sm font-mono">{num.number}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {num.status.toLowerCase()}
                            </p>
                          </div>
                          {selectedNumberId === num.id && (
                            <Check className="h-5 w-5 text-blue-600" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t mt-4">
          <Button variant="outline" onClick={handleBack} disabled={currentStep === 1 || saving}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back
          </Button>

          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>

            {currentStep < 3 ? (
              <Button
                onClick={handleNext}
                disabled={
                  saving ||
                  (currentStep === 1 && !canProceedStep1) ||
                  (currentStep === 2 && !canProceedStep2)
                }
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    Next
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>
            ) : (
              <Button onClick={handleFinish} disabled={saving}>
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Finishing...
                  </>
                ) : (
                  <>
                    <Check className="mr-2 h-4 w-4" />
                    Finish
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
