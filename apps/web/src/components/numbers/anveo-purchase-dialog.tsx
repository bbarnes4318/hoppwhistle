'use client';

import {
 ChevronRight,
 DollarSign,
 Loader2,
 MapPin,
 Phone,
 ShoppingCart,
 CheckCircle,
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
import { Label } from '@/components/ui/label';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api';
import { cn } from '@/lib/utils';

// Types matching the Anveo API
interface AnveoCountry {
 countryId: string;
 countryName: string;
 hasStates: boolean;
 isSms: boolean;
}

interface AnveoState {
 stateId: string;
 stateName: string;
 stateCode: string;
}

interface AnveoRatePlan {
 ratePlanId: string;
 ratePlanName: string;
 monthlyPrice: number;
 setupPrice: number;
}

interface AnveoArea {
 areaId: string;
 areaName: string;
 areaCode: string;
 stock: number;
 ratePlans: AnveoRatePlan[];
}

interface PurchaseResult {
 phoneNumber: {
 id: string;
 number: string;
 areaCode: string;
 areaName: string;
 };
 billing: {
 invoiceId: string;
 invoiceNumber: string;
 setupFee: number;
 monthlyFee: number;
 total: number;
 };
}

interface AnveoPurchaseDialogProps {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 onSuccess?: () => void;
}

type Step = 'country' | 'state' | 'area' | 'confirm' | 'success';

export function AnveoPurchaseDialog({ open, onOpenChange, onSuccess }: AnveoPurchaseDialogProps) {
 // Step state
 const [step, setStep] = useState<Step>('country');
 const [loading, setLoading] = useState(false);
 const [error, setError] = useState<string | null>(null);

 // Data state
 const [countries, setCountries] = useState<AnveoCountry[]>([]);
 const [states, setStates] = useState<AnveoState[]>([]);
 const [areas, setAreas] = useState<AnveoArea[]>([]);

 // Selection state
 const [selectedCountry, setSelectedCountry] = useState<AnveoCountry | null>(null);
 const [selectedState, setSelectedState] = useState<AnveoState | null>(null);
 const [selectedArea, setSelectedArea] = useState<AnveoArea | null>(null);
 const [selectedRatePlan, setSelectedRatePlan] = useState<AnveoRatePlan | null>(null);

 // Purchase result
 const [purchaseResult, setPurchaseResult] = useState<PurchaseResult | null>(null);

 // Load countries on mount
 useEffect(() => {
 if (open) {
 loadCountries();
 }
 }, [open]);

 // Reset when dialog closes
 useEffect(() => {
 if (!open) {
 setStep('country');
 setError(null);
 setSelectedCountry(null);
 setSelectedState(null);
 setSelectedArea(null);
 setSelectedRatePlan(null);
 setPurchaseResult(null);
 }
 }, [open]);

 const loadCountries = async () => {
 setLoading(true);
 setError(null);
 try {
 const response = await apiClient.get<{
 data: AnveoCountry[];
 error?: { message: string };
 }>('/api/v1/anveo/countries');
 if (response.data?.data) {
 setCountries(response.data.data);
 } else if (response.data?.error) {
 setError(response.data.error.message || 'Unknown API error');
 }
 } catch (err: unknown) {
 const message = err instanceof Error ? err.message : 'Failed to load countries';
 // Try to extract API error message from response
 const apiError = (err as { response?: { data?: { error?: { message?: string } } } })?.response
 ?.data?.error?.message;
 setError(apiError || message);
 } finally {
 setLoading(false);
 }
 };

 const loadStates = async (countryId: string) => {
 setLoading(true);
 setError(null);
 try {
 const response = await apiClient.get<{
 data: AnveoState[];
 }>(`/api/v1/anveo/countries/${encodeURIComponent(countryId)}/states`);
 if (response.data?.data) {
 setStates(response.data.data);
 setStep('state');
 }
 } catch (err) {
 setError('Failed to load states');
 } finally {
 setLoading(false);
 }
 };

 const loadAreas = async (countryId?: string, stateId?: string) => {
 setLoading(true);
 setError(null);
 try {
 const params = new URLSearchParams();
 if (stateId) {
 params.set('stateId', stateId);
 } else if (countryId) {
 params.set('countryId', countryId);
 }

 const response = await apiClient.get<{
 data: AnveoArea[];
 }>(`/api/v1/anveo/areas?${params.toString()}`);
 if (response.data?.data) {
 setAreas(response.data.data);
 setStep('area');
 }
 } catch (err) {
 setError('Failed to load areas');
 } finally {
 setLoading(false);
 }
 };

 const handleCountrySelect = (country: AnveoCountry) => {
 setSelectedCountry(country);
 if (country.hasStates) {
 loadStates(country.countryId);
 } else {
 loadAreas(country.countryId);
 }
 };

 const handleStateSelect = (state: AnveoState) => {
 setSelectedState(state);
 loadAreas(undefined, state.stateId);
 };

 const handleAreaSelect = (area: AnveoArea, ratePlan: AnveoRatePlan) => {
 setSelectedArea(area);
 setSelectedRatePlan(ratePlan);
 setStep('confirm');
 };

 const handlePurchase = async () => {
 if (!selectedArea || !selectedRatePlan) return;

 setLoading(true);
 setError(null);
 try {
 const response = await apiClient.post<{
 success: boolean;
 data: PurchaseResult;
 }>('/api/v1/anveo/purchase', {
 areaId: selectedArea.areaId,
 ratePlanId: selectedRatePlan.ratePlanId,
 didType: 'GEOGRAPHIC',
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

 const formatPrice = (price: number) => {
 return `$${price.toFixed(2)}`;
 };

 // Render different steps
 const renderStep = () => {
 switch (step) {
 case 'country':
 return (
 <div className="space-y-4">
 <div className="text-sm text-muted-foreground mb-4">
 Select a country to browse available phone numbers.
 </div>
 {loading ? (
 <div className="flex flex-col items-center justify-center py-8 gap-2">
 <Loader2 className="h-8 w-8 animate-spin text-primary" />
 <p className="text-sm text-muted-foreground">Loading countries...</p>
 </div>
 ) : error ? (
 <div className="flex flex-col items-center justify-center py-8 gap-4">
 <div className="text-sm text-destructive bg-destructive/10 p-4 rounded-md text-center">
 <p className="font-medium mb-1">Failed to load countries</p>
 <p className="text-xs opacity-80">{error}</p>
 </div>
 <Button variant="outline" onClick={loadCountries}>
 Try Again
 </Button>
 </div>
 ) : countries.length === 0 ? (
 <div className="flex flex-col items-center justify-center py-8 gap-4">
 <div className="text-sm text-muted-foreground text-center">
 <p>No countries available at this time.</p>
 <p className="text-xs mt-1">Please check your Anveo API configuration.</p>
 </div>
 <Button variant="outline" onClick={loadCountries}>
 Refresh
 </Button>
 </div>
 ) : (
 <div className="space-y-2 max-h-[400px] overflow-y-auto">
 {countries.map(country => (
 <button
 key={country.countryId}
 onClick={() => handleCountrySelect(country)}
 className={cn(
 'w-full flex items-center justify-between p-4 rounded-lg border transition-all',
 'hover:bg-accent hover:border-primary'
 )}
 >
 <div className="flex items-center gap-3">
 <MapPin className="h-5 w-5 text-muted-foreground" />
 <span className="font-medium">{country.countryName}</span>
 {country.isSms && (
 <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded">
 SMS
 </span>
 )}
 </div>
 <ChevronRight className="h-5 w-5 text-muted-foreground" />
 </button>
 ))}
 </div>
 )}
 </div>
 );

 case 'state':
 return (
 <div className="space-y-4">
 <div className="text-sm text-muted-foreground mb-4">
 Select a state in {selectedCountry?.countryName}.
 </div>
 <Button variant="ghost" size="sm" onClick={() => setStep('country')}>
 ← Back to Countries
 </Button>
 {loading ? (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="h-8 w-8 animate-spin text-primary" />
 </div>
 ) : (
 <div className="grid grid-cols-2 gap-2 max-h-[400px] overflow-y-auto">
 {states.map(state => (
 <button
 key={state.stateId}
 onClick={() => handleStateSelect(state)}
 className={cn(
 'flex items-center justify-between p-3 rounded-lg border transition-all',
 'hover:bg-accent hover:border-primary'
 )}
 >
 <span className="font-medium">{state.stateName}</span>
 <span className="text-xs text-muted-foreground">{state.stateCode}</span>
 </button>
 ))}
 </div>
 )}
 </div>
 );

 case 'area':
 return (
 <div className="space-y-4">
 <div className="text-sm text-muted-foreground mb-4">
 Select an area code and rate plan.
 {selectedState && ` Showing numbers in ${selectedState.stateName}.`}
 </div>
 <Button
 variant="ghost"
 size="sm"
 onClick={() => setStep(selectedCountry?.hasStates ? 'state' : 'country')}
 >
 ← Back
 </Button>
 {loading ? (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="h-8 w-8 animate-spin text-primary" />
 </div>
 ) : areas.length === 0 ? (
 <div className="text-center py-8 text-muted-foreground">
 No numbers available in this area. Try a different state.
 </div>
 ) : (
 <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
 {areas.map(area => (
 <div key={area.areaId} className="border rounded-lg p-4 space-y-3">
 <div className="flex items-center justify-between">
 <div>
 <div className="font-medium text-lg">
 ({area.areaCode}) {area.areaName}
 </div>
 <div className="text-sm text-muted-foreground">
 {area.stock} numbers available
 </div>
 </div>
 <Phone className="h-6 w-6 text-muted-foreground" />
 </div>
 <div className="space-y-2">
 {area.ratePlans.map(plan => (
 <button
 key={plan.ratePlanId}
 onClick={() => handleAreaSelect(area, plan)}
 className={cn(
 'w-full flex items-center justify-between p-3 rounded-md border transition-all',
 'hover:bg-accent hover:border-primary group'
 )}
 >
 <div>
 <div className="font-medium">{plan.ratePlanName}</div>
 <div className="text-xs text-muted-foreground">
 Setup: {formatPrice(plan.setupPrice)} +{' '}
 {formatPrice(plan.monthlyPrice)}
 /mo
 </div>
 </div>
 <div className="flex items-center gap-2">
 <span className="text-primary font-semibold">
 {formatPrice(plan.monthlyPrice)}/mo
 </span>
 <ShoppingCart className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
 </div>
 </button>
 ))}
 </div>
 </div>
 ))}
 </div>
 )}
 </div>
 );

 case 'confirm':
 return (
 <div className="space-y-6">
 <div className="text-sm text-muted-foreground mb-4">
 Review your purchase before confirming.
 </div>
 <Button variant="ghost" size="sm" onClick={() => setStep('area')}>
 ← Back to Areas
 </Button>

 <div className="border rounded-lg p-6 space-y-4 bg-card">
 <h3 className="font-semibold text-lg">Order Summary</h3>

 <div className="space-y-3">
 <div className="flex justify-between">
 <span className="text-muted-foreground">Area Code</span>
 <span className="font-medium">
 ({selectedArea?.areaCode}) {selectedArea?.areaName}
 </span>
 </div>
 <div className="flex justify-between">
 <span className="text-muted-foreground">Rate Plan</span>
 <span className="font-medium">{selectedRatePlan?.ratePlanName}</span>
 </div>
 <div className="border-t pt-3 space-y-2">
 <div className="flex justify-between text-sm">
 <span>Setup Fee</span>
 <span>{formatPrice(selectedRatePlan?.setupPrice || 0)}</span>
 </div>
 <div className="flex justify-between text-sm">
 <span>Monthly Fee (prorated)</span>
 <span>{formatPrice(selectedRatePlan?.monthlyPrice || 0)}</span>
 </div>
 <div className="flex justify-between font-semibold text-lg border-t pt-2">
 <span>Total Due Today</span>
 <span className="text-primary">
 {formatPrice(
 (selectedRatePlan?.setupPrice || 0) + (selectedRatePlan?.monthlyPrice || 0)
 )}
 </span>
 </div>
 </div>
 </div>

 <div className="bg-muted/50 p-3 rounded-md text-sm text-muted-foreground">
 <DollarSign className="h-4 w-4 inline mr-1" />
 Your number will be immediately provisioned and routed to your account.
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
 {purchaseResult?.phoneNumber.number}
 </p>
 <p className="text-sm text-muted-foreground mt-1">
 {purchaseResult?.phoneNumber.areaName}
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
 {step === 'success' ? 'Purchase Complete' : 'Purchase Phone Number'}
 </DialogTitle>
 <DialogDescription>
 {step === 'success'
 ? 'Your new number is ready to use'
 : 'Browse real inventory and purchase a number for your account.'}
 </DialogDescription>
 </DialogHeader>

 <div className="flex-1 min-h-0 overflow-hidden py-4">{renderStep()}</div>

 {error && (
 <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
 )}

 <DialogFooter>
 {step === 'confirm' ? (
 <>
 <Button variant="outline" onClick={() => setStep('area')} disabled={loading}>
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

