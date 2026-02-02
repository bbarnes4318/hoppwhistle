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
// CustomerIntakeForm Component
// ============================================================================

export function CustomerIntakeForm(): JSX.Element {
  const { formData, updateField, clearFormData } = useCustomerIntake();
  const [showSSN, setShowSSN] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [submitMessage, setSubmitMessage] = useState('');

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

  // Submit form to API
  const handleSubmit = useCallback(async () => {
    // Validate phone is present
    const phoneDigits = formData.phone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      setSubmitStatus('error');
      setSubmitMessage('Please enter a valid 10-digit phone number');
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus('idle');
    setSubmitMessage('');

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

      // Build beneficiaries array for API
      const beneficiaries = formData.primaryBeneficiaries
        .filter(b => b.name)
        .map(b => ({
          name: b.name,
          relationship: b.relationship,
          percentage: 100 / formData.primaryBeneficiaries.length,
        }));

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

      const response = await fetch(`${apiUrl}/api/v1/prospects/intake`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          firstName: formData.firstName,
          lastName: formData.lastName,
          phone: phoneDigits,
          email: formData.email,
          dob: formData.dateOfBirth || undefined,
          gender: undefined, // Add if form has gender field
          street: formData.address,
          city: formData.city,
          state: formData.state,
          zip: formData.zip,
          carrier: formData.carrier,
          policyType: formData.policyType,
          coverageAmount: formData.coverage,
          monthlyPremium: formData.monthlyPremium,
          beneficiaries: beneficiaries.length > 0 ? beneficiaries : undefined,
          ssPaidOnDate: formData.ssPayDay,
          payDay: formData.firstPayDay?.toString(),
          bankDraftDate: formData.futurePayDay?.toString(),
          bankName: formData.bankName,
          accountType: formData.accountType,
          routingNumber: formData.routingNumber,
          accountNumber: formData.accountNumber,
          trustedFormCertUrl, // TrustedForm certificate URL for TCPA compliance
          source: 'intake_form',
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setSubmitStatus('success');
        setSubmitMessage('Prospect intake saved successfully! Form will clear in 3 seconds.');

        // Clear form after 3 seconds
        setTimeout(() => {
          clearFormData();
          setSubmitStatus('idle');
          setSubmitMessage('');
        }, 3000);
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
  }, [formData, clearFormData]);

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-4 bg-slate-900/50 rounded-lg border border-slate-700">
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Section 1: Client Info */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <User className="h-5 w-5 text-cyan-400" />
          <h3 className="text-lg font-semibold text-white">Client Information</h3>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {/* Row 1 */}
          <div className="space-y-1.5">
            <Label htmlFor="firstName" className="text-slate-300">
              First Name
            </Label>
            <Input
              id="firstName"
              value={formData.firstName}
              onChange={e => updateField('firstName', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="John"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="lastName" className="text-slate-300">
              Last Name
            </Label>
            <Input
              id="lastName"
              value={formData.lastName}
              onChange={e => updateField('lastName', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="Doe"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-slate-300">
              Phone
            </Label>
            <Input
              id="phone"
              value={formData.phone}
              onChange={e => handlePhoneChange(e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="(555) 123-4567"
            />
          </div>

          {/* Row 2 */}
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
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="state" className="text-slate-300">
                State
              </Label>
              <Select value={formData.state} onValueChange={value => updateField('state', value)}>
                <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                  <SelectValue placeholder="ST" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map(state => (
                    <SelectItem key={state.value} value={state.value}>
                      {state.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Section 2: Policy Details */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <section>
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
              onValueChange={([value]) => updateField('coverage', value)}
              min={1000}
              max={100000}
              step={1000}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>$1,000</span>
              <span>$100,000</span>
            </div>
          </div>

          {/* Carrier, Policy Type, Premium */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="carrier" className="text-slate-300">
                Carrier
              </Label>
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
              <Label htmlFor="policyType" className="text-slate-300">
                Policy Type
              </Label>
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
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <Input
                  id="monthlyPremium"
                  type="number"
                  value={formData.monthlyPremium || ''}
                  onChange={e => updateField('monthlyPremium', parseFloat(e.target.value) || 0)}
                  className="bg-slate-800 border-slate-600 text-white pl-8"
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Section 3: Beneficiaries */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Heart className="h-5 w-5 text-pink-400" />
          <h3 className="text-lg font-semibold text-white">Beneficiaries</h3>
        </div>

        {/* Primary Beneficiaries - Dynamic Array */}
        <div className="space-y-3">
          <Label className="text-slate-300">Primary Beneficiaries</Label>

          {formData.primaryBeneficiaries.map((beneficiary, index) => (
            <div key={beneficiary.id} className="flex gap-2 items-end">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs text-slate-500">Name</Label>
                <Input
                  value={beneficiary.name}
                  onChange={e => handleUpdateBeneficiary(beneficiary.id, 'name', e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white"
                  placeholder={`Beneficiary ${index + 1}`}
                />
              </div>
              <div className="w-40 space-y-1.5">
                <Label className="text-xs text-slate-500">Relationship</Label>
                <Select
                  value={beneficiary.relationship}
                  onValueChange={value =>
                    handleUpdateBeneficiary(beneficiary.id, 'relationship', value)
                  }
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
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
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => handleRemoveBeneficiary(beneficiary.id)}
                className="text-red-400 hover:text-red-300 hover:bg-red-900/20"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}

          <Button
            variant="outline"
            size="sm"
            onClick={handleAddBeneficiary}
            className="border-dashed border-slate-600 text-slate-300 hover:text-white hover:border-slate-500"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Beneficiary
          </Button>
        </div>

        {/* Secondary Beneficiary - Single */}
        <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-700">
          <div className="space-y-1.5">
            <Label htmlFor="secondaryBeneficiaryName" className="text-slate-300">
              Secondary Beneficiary
            </Label>
            <Input
              id="secondaryBeneficiaryName"
              value={formData.secondaryBeneficiaryName}
              onChange={e => updateField('secondaryBeneficiaryName', e.target.value)}
              className="bg-slate-800 border-slate-600 text-white"
              placeholder="Name"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="secondaryRelationship" className="text-slate-300">
              Relationship
            </Label>
            <Select
              value={formData.secondaryBeneficiaryRelationship}
              onValueChange={value =>
                updateField(
                  'secondaryBeneficiaryRelationship',
                  value as Beneficiary['relationship']
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

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Section 4: Underwriting & Billing */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Building2 className="h-5 w-5 text-amber-400" />
          <h3 className="text-lg font-semibold text-white">Underwriting & Billing</h3>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Tobacco Status */}
          <div className="space-y-3">
            <Label className="text-slate-300">Tobacco User</Label>
            <div className="flex gap-4">
              <Button
                variant={formData.tobaccoUser ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateField('tobaccoUser', true)}
                className={
                  formData.tobaccoUser ? 'bg-amber-600 hover:bg-amber-700' : 'border-slate-600'
                }
              >
                Yes
              </Button>
              <Button
                variant={!formData.tobaccoUser ? 'default' : 'outline'}
                size="sm"
                onClick={() => updateField('tobaccoUser', false)}
                className={
                  !formData.tobaccoUser ? 'bg-green-600 hover:bg-green-700' : 'border-slate-600'
                }
              >
                No
              </Button>
            </div>
          </div>

          {/* SS Payment Toggle */}
          <div className="space-y-3">
            <Label className="text-slate-300">Social Security Billing</Label>
            <div className="flex items-center gap-3">
              <Switch
                checked={formData.ssPayment}
                onCheckedChange={checked => updateField('ssPayment', checked)}
              />
              <span className="text-sm text-slate-400">{formData.ssPayment ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>

        {/* Conditional Fields Based on SS Payment */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          {formData.ssPayment ? (
            <>
              {/* IF Yes: SS Pay Day + 1st Pay Day */}
              <div className="space-y-1.5">
                <Label className="text-slate-300">SS Pay Day</Label>
                <Select
                  value={formData.ssPayDay}
                  onValueChange={value =>
                    updateField('ssPayDay', value as CustomerIntakeData['ssPayDay'])
                  }
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue placeholder="Select SS pay day" />
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
              <div className="space-y-1.5">
                <Label className="text-slate-300">1st Pay Day</Label>
                <Select
                  value={formData.firstPayDay?.toString() || ''}
                  onValueChange={value => updateField('firstPayDay', parseInt(value))}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue placeholder="Select day (1-31)" />
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
            </>
          ) : (
            <>
              {/* IF No: 1st Pay Day + Future Pay Day */}
              <div className="space-y-1.5">
                <Label className="text-slate-300">1st Pay Day</Label>
                <Select
                  value={formData.firstPayDay?.toString() || ''}
                  onValueChange={value => updateField('firstPayDay', parseInt(value))}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue placeholder="Select day (1-31)" />
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
                <Label className="text-slate-300">Future Pay Day</Label>
                <Select
                  value={formData.futurePayDay?.toString() || ''}
                  onValueChange={value => updateField('futurePayDay', parseInt(value))}
                >
                  <SelectTrigger className="bg-slate-800 border-slate-600 text-white">
                    <SelectValue placeholder="Select day (2-28)" />
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
            </>
          )}
        </div>
      </section>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Section 5: Banking */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <CreditCard className="h-5 w-5 text-blue-400" />
          <h3 className="text-lg font-semibold text-white">Banking Information</h3>
        </div>

        <div className="grid grid-cols-2 gap-4">
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
              placeholder="Bank of America"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="routingNumber" className="text-slate-300">
              Routing Number
              {formData.routingNumber && !isValidRoutingNumber(formData.routingNumber) && (
                <span className="text-red-400 text-xs ml-2">(9 digits required)</span>
              )}
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
              placeholder="Account number"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="accountType" className="text-slate-300">
              Account Type
            </Label>
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
          <div className="space-y-1.5">
            <Label htmlFor="ssn" className="text-slate-300">
              SSN
            </Label>
            <div className="relative">
              <Input
                id="ssn"
                type={showSSN ? 'text' : 'password'}
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

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* Submit Section */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <section className="pt-4 border-t border-slate-700">
        <div className="flex items-center justify-between">
          <div className="flex-1">
            {submitMessage && (
              <div
                className={`flex items-center gap-2 text-sm ${
                  submitStatus === 'success' ? 'text-emerald-400' : 'text-red-400'
                }`}
              >
                {submitStatus === 'success' && <CheckCircle2 className="h-4 w-4" />}
                {submitMessage}
              </div>
            )}
          </div>
          <div className="flex gap-3">
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
              disabled={isSubmitting || !formData.phone}
              className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white px-6"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Submit Intake
                </>
              )}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default CustomerIntakeForm;
