'use client';

import {
 Plus,
 Trash2,
 User,
 Building2,
 Shield,
 Heart,
 DollarSign,
 CreditCard,
 Send,
 CheckCircle2,
 Loader2,
 ChevronDown,
 FileText,
 ExternalLink,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { useCustomerIntake } from '@/contexts/customer-intake-context';
import {
 US_STATES,
 CARRIERS,
 POLICY_TYPES,
 RELATIONSHIPS,
 SS_PAY_DAYS,
 ACCOUNT_TYPES,
 PAY_DAYS,
 FUTURE_PAY_DAYS,
} from '@/lib/us-states';
import {
 type Beneficiary,
 type CustomerIntakeData,
 formatPhoneNumber,
 formatSSN,
 maskSSN,
 isValidRoutingNumber,
 isValidEmail,
} from '@/types/customer-intake-types';

// ============================================================================
// CustomerIntakeForm Component - Two Section Layout
// ============================================================================

export function CustomerIntakeForm(): JSX.Element {
 const { formData, updateField, clearFormData } = useCustomerIntake();
 const [showSSN, setShowSSN] = useState(false);
 const [isSubmitting, setIsSubmitting] = useState(false);
 const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
 const [submitMessage, setSubmitMessage] = useState('');

 // Two-section state
 const [showFullApplication, setShowFullApplication] = useState(false);
 const [submittedCertUrl, setSubmittedCertUrl] = useState<string | null>(null);

 // ─────────────────────────────────────────────────────────────────────────
 // Handlers
 // ─────────────────────────────────────────────────────────────────────────

 const handlePhoneChange = useCallback(
 (value: string) => {
 updateField('phone', formatPhoneNumber(value));
 },
 [updateField]
 );

 const handleSSNChange = useCallback(
 (value: string) => {
 const digits = value.replace(/\D/g, '').slice(0, 9);
 updateField('ssn', digits);
 },
 [updateField]
 );

 const handleRoutingChange = useCallback(
 (value: string) => {
 const digits = value.replace(/\D/g, '').slice(0, 9);
 updateField('routingNumber', digits);
 },
 [updateField]
 );

 const handleAddBeneficiary = useCallback(() => {
 const newBeneficiary: Beneficiary = {
 id: uuidv4(),
 name: '',
 relationship: 'spouse',
 };
 updateField('primaryBeneficiaries', [...formData.primaryBeneficiaries, newBeneficiary]);
 }, [formData.primaryBeneficiaries, updateField]);

 const handleRemoveBeneficiary = useCallback(
 (id: string) => {
 updateField(
 'primaryBeneficiaries',
 formData.primaryBeneficiaries.filter(b => b.id !== id)
 );
 },
 [formData.primaryBeneficiaries, updateField]
 );

 const handleUpdateBeneficiary = useCallback(
 (id: string, field: keyof Beneficiary, value: string) => {
 updateField(
 'primaryBeneficiaries',
 formData.primaryBeneficiaries.map(b => (b.id === id ? { ...b, [field]: value } : b))
 );
 },
 [formData.primaryBeneficiaries, updateField]
 );

 // ─────────────────────────────────────────────────────────────────────────
 // Validation - Top Section Only
 // ─────────────────────────────────────────────────────────────────────────

 const isTopSectionValid = useCallback(() => {
 const phoneDigits = formData.phone.replace(/\D/g, '');
 return (
 formData.firstName.trim().length > 0 &&
 formData.lastName.trim().length > 0 &&
 phoneDigits.length === 10 &&
 formData.state.length === 2 &&
 (formData.age === '' ||
 (typeof formData.age === 'number' && formData.age > 0 && formData.age < 120))
 );
 }, [formData.firstName, formData.lastName, formData.phone, formData.state, formData.age]);

 // ─────────────────────────────────────────────────────────────────────────
 // Submit Handler
 // ─────────────────────────────────────────────────────────────────────────

 const handleSubmit = useCallback(async () => {
 // Validate phone is present
 const phoneDigits = formData.phone.replace(/\D/g, '');
 if (phoneDigits.length < 10) {
 setSubmitStatus('error');
 setSubmitMessage('Please enter a valid 10-digit phone number');
 return;
 }

 // Validate top section if not showing full application
 if (!showFullApplication && !isTopSectionValid()) {
 setSubmitStatus('error');
 setSubmitMessage('Please complete all required fields in the top section');
 return;
 }

 setIsSubmitting(true);
 setSubmitStatus('idle');
 setSubmitMessage('');

 try {
 const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

 // Build beneficiaries array for API (only if full form)
 const beneficiaries = showFullApplication
 ? formData.primaryBeneficiaries
 .filter(b => b.name)
 .map(b => ({
 name: b.name,
 relationship: b.relationship,
 percentage: 100 / formData.primaryBeneficiaries.length,
 }))
 : undefined;

 // Try to get TrustedForm certificate URL from hidden input
 let trustedFormCertUrl: string | undefined;
 try {
 const tfInput = document.querySelector<HTMLInputElement>(
 'input[name="xxTrustedFormCertUrl"]'
 );
 if (tfInput?.value) {
 trustedFormCertUrl = tfInput.value;
 console.log('[CustomerIntakeForm] TrustedForm cert URL captured:', trustedFormCertUrl);
 }
 } catch (e) {
 console.warn('[CustomerIntakeForm] Could not get TrustedForm cert URL:', e);
 }

 // Build payload - only include full application fields if expanded
 const payload: Record<string, unknown> = {
 firstName: formData.firstName,
 lastName: formData.lastName,
 phone: phoneDigits,
 state: formData.state,
 age: formData.age || undefined,
 trustedFormCertUrl,
 source: showFullApplication ? 'intake_form_full' : 'intake_form_basic',
 };

 // Add full application fields if expanded
 if (showFullApplication) {
 Object.assign(payload, {
 email: formData.email || undefined,
 dob: formData.dateOfBirth || undefined,
 street: formData.address || undefined,
 city: formData.city || undefined,
 zip: formData.zip || undefined,
 carrier: formData.carrier || undefined,
 policyType: formData.policyType || undefined,
 coverageAmount: formData.coverage || undefined,
 monthlyPremium: formData.monthlyPremium || undefined,
 beneficiaries: beneficiaries && beneficiaries.length > 0 ? beneficiaries : undefined,
 ssPaidOnDate: formData.ssPayDay || undefined,
 payDay: formData.firstPayDay?.toString() || undefined,
 bankDraftDate: formData.futurePayDay?.toString() || undefined,
 bankName: formData.bankName || undefined,
 accountType: formData.accountType || undefined,
 routingNumber: formData.routingNumber || undefined,
 accountNumber: formData.accountNumber || undefined,
 });
 }

 const response = await fetch(`${apiUrl}/api/v1/prospects/intake`, {
 method: 'POST',
 headers: {
 'Content-Type': 'application/json',
 },
 body: JSON.stringify(payload),
 });

 const data = await response.json();

 if (response.ok) {
 setSubmitStatus('success');
 setSubmitMessage('Prospect intake saved successfully!');

 // Show the TrustedForm certificate URL after submission
 if (trustedFormCertUrl) {
 setSubmittedCertUrl(trustedFormCertUrl);
 }

 // Clear form after 5 seconds
 setTimeout(() => {
 clearFormData();
 setSubmitStatus('idle');
 setSubmitMessage('');
 setShowFullApplication(false);
 // Keep cert URL visible
 }, 5000);
 } else {
 setSubmitStatus('error');
 setSubmitMessage(data.error?.message || 'Failed to save intake');
 }
 } catch (error) {
 console.error('Intake submit error:', error);
 setSubmitStatus('error');
 setSubmitMessage('Network error. Please try again.');
 } finally {
 setIsSubmitting(false);
 }
 }, [formData, clearFormData, showFullApplication, isTopSectionValid]);

 // ─────────────────────────────────────────────────────────────────────────
 // Render
 // ─────────────────────────────────────────────────────────────────────────

 return (
 <div className="space-y-6 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
 {/* ═══════════════════════════════════════════════════════════════════ */}
 {/* TOP SECTION: Basic Lead Info (Always Visible) */}
 {/* ═══════════════════════════════════════════════════════════════════ */}
 <section>
 <div className="flex items-center gap-2 mb-4">
 <User className="h-5 w-5 text-cyan-400" />
 <h3 className="text-lg font-semibold text-white">Lead Information</h3>
 <span className="text-xs text-slate-400 ml-2">(Required)</span>
 </div>

 <div className="grid grid-cols-5 gap-4">
 {/* First Name */}
 <div className="space-y-1.5">
 <Label htmlFor="firstName" className="text-slate-300">
 First Name <span className="text-red-400">*</span>
 </Label>
 <Input
 id="firstName"
 value={formData.firstName}
 onChange={e => updateField('firstName', e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="John"
 />
 </div>

 {/* Last Name */}
 <div className="space-y-1.5">
 <Label htmlFor="lastName" className="text-slate-300">
 Last Name <span className="text-red-400">*</span>
 </Label>
 <Input
 id="lastName"
 value={formData.lastName}
 onChange={e => updateField('lastName', e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="Doe"
 />
 </div>

 {/* Phone */}
 <div className="space-y-1.5">
 <Label htmlFor="phone" className="text-slate-300">
 Phone <span className="text-red-400">*</span>
 </Label>
 <Input
 id="phone"
 value={formData.phone}
 onChange={e => handlePhoneChange(e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="(555) 123-4567"
 />
 </div>

 {/* State */}
 <div className="space-y-1.5">
 <Label htmlFor="state" className="text-slate-300">
 State <span className="text-red-400">*</span>
 </Label>
 <Select value={formData.state} onValueChange={value => updateField('state', value)}>
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
 <SelectValue placeholder="Select" />
 </SelectTrigger>
 <SelectContent>
 {US_STATES.map(state => (
 <SelectItem key={state.value} value={state.value}>
 {state.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 {/* Age */}
 <div className="space-y-1.5">
 <Label htmlFor="age" className="text-slate-300">
 Age
 </Label>
 <Input
 id="age"
 type="number"
 min="1"
 max="120"
 value={formData.age}
 onChange={e => {
 const val = e.target.value;
 updateField('age', val === '' ? '' : parseInt(val, 10));
 }}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="65"
 />
 </div>
 </div>

 {/* Top Section Actions */}
 <div className="mt-6 flex items-center justify-between border-t border-slate-700 pt-4">
 <div className="flex items-center gap-3">
 {!showFullApplication && (
 <Button
 variant="outline"
 onClick={() => setShowFullApplication(true)}
 className="border-cyan-600 text-cyan-400 hover:bg-cyan-600/10 hover:border-cyan-500"
 >
 <ChevronDown className="h-4 w-4 mr-2" />
 Continue to Full Application
 </Button>
 )}
 {showFullApplication && (
 <Button
 variant="ghost"
 onClick={() => setShowFullApplication(false)}
 className="text-slate-400 hover:text-white"
 >
 <ChevronDown className="h-4 w-4 mr-2 rotate-180" />
 Hide Full Application
 </Button>
 )}
 </div>

 {!showFullApplication && (
 <div className="flex items-center gap-3">
 <Button
 variant="outline"
 onClick={clearFormData}
 disabled={isSubmitting}
 className="border-slate-600 text-slate-300 hover:text-white hover:border-slate-500"
 >
 Clear
 </Button>
 <Button
 onClick={handleSubmit}
 disabled={isSubmitting || !isTopSectionValid()}
 className="bg-primary hover: hover: text-white px-6"
 >
 {isSubmitting ? (
 <>
 <Loader2 className="h-4 w-4 mr-2 animate-spin" />
 Saving...
 </>
 ) : (
 <>
 <Send className="h-4 w-4 mr-2" />
 Submit Lead
 </>
 )}
 </Button>
 </div>
 )}
 </div>

 {/* Status Message for Top Section */}
 {!showFullApplication && submitMessage && (
 <div className="mt-4">
 <div
 className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
 submitStatus === 'success'
 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
 : 'bg-red-500/10 text-red-400 border border-red-500/30'
 }`}
 >
 {submitStatus === 'success' && <CheckCircle2 className="h-4 w-4" />}
 {submitMessage}
 </div>
 </div>
 )}
 </section>

 {/* ═══════════════════════════════════════════════════════════════════ */}
 {/* BOTTOM SECTION: Full Application (Initially Hidden) */}
 {/* ═══════════════════════════════════════════════════════════════════ */}
 {showFullApplication && (
 <>
 {/* ─────────────────────────────────────────────────────────────── */}
 {/* Section 2: Additional Client Info */}
 {/* ─────────────────────────────────────────────────────────────── */}
 <section className="border-t border-slate-700 pt-6">
 <div className="flex items-center gap-2 mb-4">
 <Building2 className="h-5 w-5 text-purple-400" />
 <h3 className="text-lg font-semibold text-white">Additional Details</h3>
 </div>

 <div className="grid grid-cols-3 gap-4">
 {/* Email */}
 <div className="space-y-1.5">
 <Label htmlFor="email" className="text-slate-300">
 Email
 </Label>
 <Input
 id="email"
 type="email"
 value={formData.email}
 onChange={e => updateField('email', e.target.value)}
 className={`bg-slate-800 border-slate-600 text-white ${
 formData.email && !isValidEmail(formData.email) ? 'border-red-500' : ''
 }`}
 placeholder="john@example.com"
 />
 </div>

 {/* Date of Birth */}
 <div className="space-y-1.5">
 <Label htmlFor="dateOfBirth" className="text-slate-300">
 Date of Birth
 </Label>
 <Input
 id="dateOfBirth"
 type="date"
 value={formData.dateOfBirth}
 onChange={e => updateField('dateOfBirth', e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 />
 </div>

 {/* State of Birth */}
 <div className="space-y-1.5">
 <Label htmlFor="stateOfBirth" className="text-slate-300">
 State of Birth
 </Label>
 <Select
 value={formData.stateOfBirth}
 onValueChange={value => updateField('stateOfBirth', value)}
 >
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
 <SelectValue placeholder="Select state" />
 </SelectTrigger>
 <SelectContent>
 {US_STATES.map(state => (
 <SelectItem key={state.value} value={state.value}>
 {state.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>

 {/* Address Row */}
 <div className="grid grid-cols-4 gap-4 mt-4">
 <div className="col-span-2 space-y-1.5">
 <Label htmlFor="address" className="text-slate-300">
 Address
 </Label>
 <Input
 id="address"
 value={formData.address}
 onChange={e => updateField('address', e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="123 Main St"
 />
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="city" className="text-slate-300">
 City
 </Label>
 <Input
 id="city"
 value={formData.city}
 onChange={e => updateField('city', e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="New York"
 />
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="zip" className="text-slate-300">
 Zip
 </Label>
 <Input
 id="zip"
 value={formData.zip}
 onChange={e => updateField('zip', e.target.value.replace(/\D/g, '').slice(0, 5))}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="10001"
 />
 </div>
 </div>
 </section>

 {/* ─────────────────────────────────────────────────────────────── */}
 {/* Section 3: Policy Details */}
 {/* ─────────────────────────────────────────────────────────────── */}
 <section className="border-t border-slate-700 pt-6">
 <div className="flex items-center gap-2 mb-4">
 <Shield className="h-5 w-5 text-emerald-400" />
 <h3 className="text-lg font-semibold text-white">Policy Details</h3>
 </div>

 <div className="space-y-4">
 {/* Coverage Slider */}
 <div className="space-y-3">
 <div className="flex justify-between">
 <Label className="text-slate-300">Coverage Amount</Label>
 <span className="text-lg font-bold text-emerald-400">
 ${formData.coverage.toLocaleString()}
 </span>
 </div>
 <Slider
 value={[formData.coverage]}
 min={1000}
 max={100000}
 step={1000}
 onValueChange={([value]) => updateField('coverage', value)}
 className="py-2"
 />
 <div className="flex justify-between text-xs text-slate-500">
 <span>$1,000</span>
 <span>$100,000</span>
 </div>
 </div>

 {/* Policy Row */}
 <div className="grid grid-cols-3 gap-4">
 <div className="space-y-1.5">
 <Label className="text-slate-300">Carrier</Label>
 <Select
 value={formData.carrier}
 onValueChange={value =>
 updateField('carrier', value as CustomerIntakeData['carrier'])
 }
 >
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
 <SelectValue placeholder="Select carrier" />
 </SelectTrigger>
 <SelectContent>
 {CARRIERS.map(carrier => (
 <SelectItem key={carrier.value} value={carrier.value}>
 {carrier.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="text-slate-300">Policy Type</Label>
 <Select
 value={formData.policyType}
 onValueChange={value =>
 updateField('policyType', value as CustomerIntakeData['policyType'])
 }
 >
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
 <SelectValue placeholder="Select type" />
 </SelectTrigger>
 <SelectContent>
 {POLICY_TYPES.map(type => (
 <SelectItem key={type.value} value={type.value}>
 {type.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="monthlyPremium" className="text-slate-300">
 Monthly Premium
 </Label>
 <div className="relative">
 <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-500" />
 <Input
 id="monthlyPremium"
 type="number"
 value={formData.monthlyPremium || ''}
 onChange={e => updateField('monthlyPremium', parseFloat(e.target.value) || 0)}
 className="bg-slate-800 border-slate-600 text-white pl-9"
 placeholder="0.00"
 />
 </div>
 </div>
 </div>

 {/* Underwriting Row */}
 <div className="grid grid-cols-4 gap-4 mt-4">
 <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
 <Switch
 checked={formData.tobaccoUser}
 onCheckedChange={checked => updateField('tobaccoUser', checked)}
 />
 <Label className="text-slate-300 cursor-pointer">Tobacco User</Label>
 </div>
 <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg">
 <Switch
 checked={formData.ssPayment}
 onCheckedChange={checked => updateField('ssPayment', checked)}
 />
 <Label className="text-slate-300 cursor-pointer">SS Payment</Label>
 </div>
 <div className="space-y-1.5">
 <Label className="text-slate-300">SS Pay Day</Label>
 <Select
 value={formData.ssPayDay}
 onValueChange={value =>
 updateField('ssPayDay', value as CustomerIntakeData['ssPayDay'])
 }
 >
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
 <SelectValue placeholder="Select" />
 </SelectTrigger>
 <SelectContent>
 {SS_PAY_DAYS.map(day => (
 <SelectItem key={day.value} value={day.value}>
 {day.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="grid grid-cols-2 gap-2">
 <div className="space-y-1.5">
 <Label className="text-slate-300 text-xs">1st Pay Day</Label>
 <Select
 value={formData.firstPayDay?.toString() || ''}
 onValueChange={value => updateField('firstPayDay', parseInt(value, 10))}
 >
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm">
 <SelectValue placeholder="Day" />
 </SelectTrigger>
 <SelectContent>
 {PAY_DAYS.map(day => (
 <SelectItem key={day.value} value={day.value.toString()}>
 {day.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 <div className="space-y-1.5">
 <Label className="text-slate-300 text-xs">Future Pay</Label>
 <Select
 value={formData.futurePayDay?.toString() || ''}
 onValueChange={value => updateField('futurePayDay', parseInt(value, 10))}
 >
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white h-9 text-sm">
 <SelectValue placeholder="Day" />
 </SelectTrigger>
 <SelectContent>
 {FUTURE_PAY_DAYS.map(day => (
 <SelectItem key={day.value} value={day.value.toString()}>
 {day.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 </div>
 </div>
 </section>

 {/* ─────────────────────────────────────────────────────────────── */}
 {/* Section 4: Beneficiaries */}
 {/* ─────────────────────────────────────────────────────────────── */}
 <section className="border-t border-slate-700 pt-6">
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-2">
 <Heart className="h-5 w-5 text-pink-400" />
 <h3 className="text-lg font-semibold text-white">Beneficiaries</h3>
 </div>
 <Button
 variant="outline"
 size="sm"
 onClick={handleAddBeneficiary}
 className="border-pink-500/50 text-pink-400 hover:bg-pink-500/10"
 >
 <Plus className="h-4 w-4 mr-1" /> Add Primary
 </Button>
 </div>

 {/* Primary Beneficiaries */}
 <div className="space-y-3">
 {formData.primaryBeneficiaries.map((beneficiary, index) => (
 <div
 key={beneficiary.id}
 className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-lg"
 >
 <span className="text-slate-500 text-sm w-6">#{index + 1}</span>
 <Input
 value={beneficiary.name}
 onChange={e => handleUpdateBeneficiary(beneficiary.id, 'name', e.target.value)}
 className="flex-1 bg-slate-800 border-slate-600 text-white"
 placeholder="Beneficiary name"
 />
 <Select
 value={beneficiary.relationship}
 onValueChange={value =>
 handleUpdateBeneficiary(beneficiary.id, 'relationship', value)
 }
 >
 <SelectTrigger className="w-36 bg-slate-800 border-slate-600 text-white">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 {RELATIONSHIPS.map(rel => (
 <SelectItem key={rel.value} value={rel.value}>
 {rel.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <Button
 variant="ghost"
 size="icon"
 onClick={() => handleRemoveBeneficiary(beneficiary.id)}
 className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
 >
 <Trash2 className="h-4 w-4" />
 </Button>
 </div>
 ))}
 {formData.primaryBeneficiaries.length === 0 && (
 <div className="text-center py-6 text-slate-500 bg-slate-800/30 rounded-lg">
 No beneficiaries added. Click &quot;Add Primary&quot; to add one.
 </div>
 )}
 </div>

 {/* Secondary Beneficiary */}
 <div className="grid grid-cols-2 gap-4 mt-4">
 <div className="space-y-1.5">
 <Label className="text-slate-300">Secondary Beneficiary Name</Label>
 <Input
 value={formData.secondaryBeneficiaryName}
 onChange={e => updateField('secondaryBeneficiaryName', e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="Contingent beneficiary"
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-slate-300">Relationship</Label>
 <Select
 value={formData.secondaryBeneficiaryRelationship}
 onValueChange={value =>
 updateField(
 'secondaryBeneficiaryRelationship',
 value as CustomerIntakeData['secondaryBeneficiaryRelationship']
 )
 }
 >
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
 <SelectValue placeholder="Select relationship" />
 </SelectTrigger>
 <SelectContent>
 {RELATIONSHIPS.map(rel => (
 <SelectItem key={rel.value} value={rel.value}>
 {rel.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>
 </section>

 {/* ─────────────────────────────────────────────────────────────── */}
 {/* Section 5: Banking Information */}
 {/* ─────────────────────────────────────────────────────────────── */}
 <section className="border-t border-slate-700 pt-6">
 <div className="flex items-center gap-2 mb-4">
 <CreditCard className="h-5 w-5 text-amber-400" />
 <h3 className="text-lg font-semibold text-white">Banking Information</h3>
 </div>

 <div className="grid grid-cols-3 gap-4">
 <div className="space-y-1.5">
 <Label htmlFor="nameOnAccount" className="text-slate-300">
 Name on Account
 </Label>
 <Input
 id="nameOnAccount"
 value={formData.nameOnAccount}
 onChange={e => updateField('nameOnAccount', e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="John Doe"
 />
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="bankName" className="text-slate-300">
 Bank Name
 </Label>
 <Input
 id="bankName"
 value={formData.bankName}
 onChange={e => updateField('bankName', e.target.value)}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="Chase Bank"
 />
 </div>
 <div className="space-y-1.5">
 <Label className="text-slate-300">Account Type</Label>
 <Select
 value={formData.accountType}
 onValueChange={value =>
 updateField('accountType', value as CustomerIntakeData['accountType'])
 }
 >
 <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
 <SelectValue placeholder="Select type" />
 </SelectTrigger>
 <SelectContent>
 {ACCOUNT_TYPES.map(type => (
 <SelectItem key={type.value} value={type.value}>
 {type.label}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>
 </div>

 <div className="grid grid-cols-3 gap-4 mt-4">
 <div className="space-y-1.5">
 <Label htmlFor="routingNumber" className="text-slate-300">
 Routing Number
 </Label>
 <Input
 id="routingNumber"
 value={formData.routingNumber}
 onChange={e => handleRoutingChange(e.target.value)}
 className={`bg-slate-800 border-slate-600 text-white ${
 formData.routingNumber && !isValidRoutingNumber(formData.routingNumber)
 ? 'border-red-500'
 : ''
 }`}
 placeholder="123456789"
 maxLength={9}
 />
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="accountNumber" className="text-slate-300">
 Account Number
 </Label>
 <Input
 id="accountNumber"
 value={formData.accountNumber}
 onChange={e => updateField('accountNumber', e.target.value.replace(/\D/g, ''))}
 className="bg-slate-800 border-slate-600 text-white"
 placeholder="••••••••••"
 type="password"
 />
 </div>
 <div className="space-y-1.5">
 <Label htmlFor="ssn" className="text-slate-300">
 SSN
 </Label>
 <div className="relative">
 <Input
 id="ssn"
 value={showSSN ? formatSSN(formData.ssn) : maskSSN(formData.ssn)}
 onChange={e => handleSSNChange(e.target.value)}
 className="bg-slate-800 border-slate-600 text-white pr-16"
 placeholder="XXX-XX-XXXX"
 maxLength={11}
 />
 <Button
 type="button"
 variant="ghost"
 size="sm"
 onClick={() => setShowSSN(!showSSN)}
 className="absolute right-1 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
 >
 {showSSN ? 'Hide' : 'Show'}
 </Button>
 </div>
 </div>
 </div>
 </section>

 {/* ─────────────────────────────────────────────────────────────── */}
 {/* Submit Section (Full Application) */}
 {/* ─────────────────────────────────────────────────────────────── */}
 <section className="pt-4 border-t border-slate-700">
 <div className="flex items-center justify-between">
 <div className="flex-1">
 {submitMessage && (
 <div
 className={`flex items-center gap-2 text-sm p-3 rounded-lg ${
 submitStatus === 'success'
 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
 : 'bg-red-500/10 text-red-400 border border-red-500/30'
 }`}
 >
 {submitStatus === 'success' && <CheckCircle2 className="h-4 w-4" />}
 {submitMessage}
 </div>
 )}
 </div>
 <div className="flex gap-3 ml-4">
 <Button
 variant="outline"
 onClick={clearFormData}
 disabled={isSubmitting}
 className="border-slate-600 text-slate-300 hover:text-white hover:border-slate-500"
 >
 Clear Form
 </Button>
 <Button
 onClick={handleSubmit}
 disabled={isSubmitting || !isTopSectionValid()}
 className="bg-primary hover: hover: text-white px-6"
 >
 {isSubmitting ? (
 <>
 <Loader2 className="h-4 w-4 mr-2 animate-spin" />
 Saving...
 </>
 ) : (
 <>
 <Send className="h-4 w-4 mr-2" />
 Submit Full Application
 </>
 )}
 </Button>
 </div>
 </div>
 </section>
 </>
 )}

 {/* ═══════════════════════════════════════════════════════════════════ */}
 {/* TrustedForm Certificate Display (After Submission) */}
 {/* ═══════════════════════════════════════════════════════════════════ */}
 {submittedCertUrl && (
 <section className="mt-6 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
 <div className="flex items-center gap-2 mb-2">
 <FileText className="h-5 w-5 text-emerald-400" />
 <h3 className="text-lg font-semibold text-emerald-400">TrustedForm Certificate</h3>
 </div>
 <div className="flex items-center gap-2 mt-2">
 <code className="flex-1 text-xs bg-slate-800 text-slate-300 p-2 rounded font-mono overflow-x-auto">
 {submittedCertUrl}
 </code>
 <a
 href={submittedCertUrl}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1 px-3 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded"
 >
 <ExternalLink className="h-4 w-4" />
 View Certificate
 </a>
 </div>
 </section>
 )}
 </div>
 );
}

export default CustomerIntakeForm;

