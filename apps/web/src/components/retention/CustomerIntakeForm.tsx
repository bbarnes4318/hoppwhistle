'use client';

import { useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  DollarSign,
  Phone,
  User,
  Mail,
  MapPin,
  Building,
  CalendarDays,
  FileText,
  Save,
  UserPlus,
} from 'lucide-react';
import Link from 'next/link';

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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type { PolicyStatus, PolicyType, RelationshipType } from './RetentionDashboard';

// ============================================================================
// Constants
// ============================================================================

const US_STATES = [
  'AL',
  'AK',
  'AZ',
  'AR',
  'CA',
  'CO',
  'CT',
  'DE',
  'DC',
  'FL',
  'GA',
  'HI',
  'ID',
  'IL',
  'IN',
  'IA',
  'KS',
  'KY',
  'LA',
  'ME',
  'MD',
  'MA',
  'MI',
  'MN',
  'MS',
  'MO',
  'MT',
  'NE',
  'NV',
  'NH',
  'NJ',
  'NM',
  'NY',
  'NC',
  'ND',
  'OH',
  'OK',
  'OR',
  'PA',
  'RI',
  'SC',
  'SD',
  'TN',
  'TX',
  'UT',
  'VT',
  'VA',
  'WA',
  'WV',
  'WI',
  'WY',
];

const POLICY_TYPES: { value: PolicyType; label: string }[] = [
  { value: 'LEVEL', label: 'Level' },
  { value: 'GRADED', label: 'Graded' },
  { value: 'MODIFIED', label: 'Modified' },
  { value: 'GUARANTEED_ISSUE', label: 'Guaranteed Issue' },
];

const RELATIONSHIP_TYPES: { value: RelationshipType; label: string }[] = [
  { value: 'SPOUSE', label: 'Spouse' },
  { value: 'CHILD', label: 'Child' },
  { value: 'PARENT', label: 'Parent' },
  { value: 'GRANDCHILD', label: 'Grandchild' },
  { value: 'SIBLING', label: 'Sibling' },
  { value: 'PARTNER', label: 'Partner' },
  { value: 'FRIEND', label: 'Friend' },
  { value: 'OTHER', label: 'Other' },
];

const POLICY_STATUSES: { value: PolicyStatus; label: string }[] = [
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'UW_REVIEW', label: 'UW Review' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'PAID', label: 'Paid' },
  { value: 'DECLINED', label: 'Declined' },
  { value: 'NOT_TAKEN', label: 'Not Taken' },
  { value: 'LAPSED', label: 'Lapsed' },
];

// SS Billing options (Social Security payment schedule)
const SS_BILLING_OPTIONS = ['1st', '3rd', '2nd Wed', '3rd Wed', '4th Wed'];

// Standard billing options (1-28)
const STANDARD_BILLING_OPTIONS = Array.from({ length: 28 }, (_, i) => String(i + 1));

// ============================================================================
// Types
// ============================================================================

interface FormData {
  // Contact Info
  firstName: string;
  middleName: string;
  lastName: string;
  phoneNumber: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  smsText: boolean;

  // Beneficiary Info
  primaryBeneficiary: string;
  primaryRelationship: RelationshipType | '';
  contingentBeneficiary: string;
  contingentRelationship: RelationshipType | '';

  // Policy Info
  carrier: string;
  coverage: string;
  monthlyPremium: string;
  policyType: PolicyType | '';

  // Billing
  ssBilling: boolean;
  billingDateStr: string;

  // Workflow
  status: PolicyStatus;
  notes: string;
}

// ============================================================================
// Component
// ============================================================================

export function CustomerIntakeForm(): JSX.Element {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    firstName: '',
    middleName: '',
    lastName: '',
    phoneNumber: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    smsText: false,
    primaryBeneficiary: '',
    primaryRelationship: '',
    contingentBeneficiary: '',
    contingentRelationship: '',
    carrier: '',
    coverage: '',
    monthlyPremium: '',
    policyType: '',
    ssBilling: false,
    billingDateStr: '',
    status: 'SUBMITTED',
    notes: '',
  });

  // Get billing options based on SS Billing toggle
  const billingOptions = useMemo(() => {
    return formData.ssBilling ? SS_BILLING_OPTIONS : STANDARD_BILLING_OPTIONS;
  }, [formData.ssBilling]);

  // Update field handler
  const updateField = useCallback(<K extends keyof FormData>(field: K, value: FormData[K]) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  // Handle SS Billing toggle - reset billing date when switching
  const handleSSBillingChange = useCallback((checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      ssBilling: checked,
      billingDateStr: '', // Reset billing date when toggling
    }));
  }, []);

  // Submit handler
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // TODO: API call to create policy
      console.log('Creating policy:', formData);
      await new Promise(resolve => setTimeout(resolve, 1000));
      router.push('/retention');
    } catch (error) {
      console.error('Failed to create policy:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/retention">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">New Policy Intake</h1>
          <p className="text-muted-foreground">Enter customer and policy information</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Contact Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Contact Information
            </CardTitle>
            <CardDescription>Customer contact details - syncs with call-pop system</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={e => updateField('firstName', e.target.value)}
                placeholder="John"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="middleName">Middle Name</Label>
              <Input
                id="middleName"
                value={formData.middleName}
                onChange={e => updateField('middleName', e.target.value)}
                placeholder="Robert"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                value={formData.lastName}
                onChange={e => updateField('lastName', e.target.value)}
                placeholder="Smith"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phoneNumber" className="flex items-center gap-2">
                <Phone className="h-4 w-4" />
                Phone Number *
              </Label>
              <Input
                id="phoneNumber"
                value={formData.phoneNumber}
                onChange={e => updateField('phoneNumber', e.target.value)}
                placeholder="+1 (555) 123-4567"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="h-4 w-4" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={e => updateField('email', e.target.value)}
                placeholder="john@example.com"
              />
            </div>
            <div className="flex items-center space-x-2 pt-7">
              <Switch
                id="smsText"
                checked={formData.smsText}
                onCheckedChange={checked => updateField('smsText', checked)}
              />
              <Label htmlFor="smsText" className="cursor-pointer">
                SMS/Text Enabled
              </Label>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address" className="flex items-center gap-2">
                <MapPin className="h-4 w-4" />
                Street Address
              </Label>
              <Input
                id="address"
                value={formData.address}
                onChange={e => updateField('address', e.target.value)}
                placeholder="123 Main Street"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City</Label>
              <Input
                id="city"
                value={formData.city}
                onChange={e => updateField('city', e.target.value)}
                placeholder="Dallas"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="state">State</Label>
              <Select value={formData.state} onValueChange={value => updateField('state', value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select state" />
                </SelectTrigger>
                <SelectContent>
                  {US_STATES.map(state => (
                    <SelectItem key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="zipCode">ZIP Code</Label>
              <Input
                id="zipCode"
                value={formData.zipCode}
                onChange={e => updateField('zipCode', e.target.value)}
                placeholder="75201"
              />
            </div>
          </CardContent>
        </Card>

        {/* Beneficiary Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Beneficiary Information
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Primary Beneficiary */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Primary Beneficiary</h4>
              <div className="space-y-2">
                <Label htmlFor="primaryBeneficiary">Name</Label>
                <Input
                  id="primaryBeneficiary"
                  value={formData.primaryBeneficiary}
                  onChange={e => updateField('primaryBeneficiary', e.target.value)}
                  placeholder="Jane Smith"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="primaryRelationship">Relationship</Label>
                <Select
                  value={formData.primaryRelationship}
                  onValueChange={value =>
                    updateField('primaryRelationship', value as RelationshipType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIP_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Contingent Beneficiary */}
            <div className="space-y-4">
              <h4 className="font-medium text-sm text-muted-foreground">Contingent Beneficiary</h4>
              <div className="space-y-2">
                <Label htmlFor="contingentBeneficiary">Name</Label>
                <Input
                  id="contingentBeneficiary"
                  value={formData.contingentBeneficiary}
                  onChange={e => updateField('contingentBeneficiary', e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contingentRelationship">Relationship</Label>
                <Select
                  value={formData.contingentRelationship}
                  onValueChange={value =>
                    updateField('contingentRelationship', value as RelationshipType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select relationship" />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONSHIP_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Policy Details */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Policy Details
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label htmlFor="carrier" className="flex items-center gap-2">
                <Building className="h-4 w-4" />
                Carrier
              </Label>
              <Input
                id="carrier"
                value={formData.carrier}
                onChange={e => updateField('carrier', e.target.value)}
                placeholder="Mutual of Omaha"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="coverage" className="flex items-center gap-2">
                <DollarSign className="h-4 w-4" />
                Coverage Amount
              </Label>
              <Input
                id="coverage"
                type="number"
                value={formData.coverage}
                onChange={e => updateField('coverage', e.target.value)}
                placeholder="25000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthlyPremium">Monthly Premium</Label>
              <Input
                id="monthlyPremium"
                type="number"
                step="0.01"
                value={formData.monthlyPremium}
                onChange={e => updateField('monthlyPremium', e.target.value)}
                placeholder="45.99"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="policyType">Policy Type</Label>
              <Select
                value={formData.policyType}
                onValueChange={value => updateField('policyType', value as PolicyType)}
              >
                <SelectTrigger>
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
          </CardContent>
        </Card>

        {/* Billing Information */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5" />
              Billing Information
            </CardTitle>
            <CardDescription>
              Toggle SS Billing for Social Security payment schedules
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="flex items-center space-x-4 p-4 rounded-lg bg-muted/50">
              <Switch
                id="ssBilling"
                checked={formData.ssBilling}
                onCheckedChange={handleSSBillingChange}
              />
              <Label htmlFor="ssBilling" className="cursor-pointer">
                <span className="font-medium">SS Billing</span>
                <p className="text-xs text-muted-foreground">Social Security payment schedule</p>
              </Label>
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="billingDateStr">
                Billing Date {formData.ssBilling ? '(SS Schedule)' : '(Day of Month)'}
              </Label>
              <Select
                value={formData.billingDateStr}
                onValueChange={value => updateField('billingDateStr', value)}
              >
                <SelectTrigger
                  className={cn(
                    'transition-all',
                    formData.ssBilling && 'border-amber-500/50 bg-amber-500/5'
                  )}
                >
                  <SelectValue
                    placeholder={
                      formData.ssBilling ? 'Select SS payment date' : 'Select day of month (1-28)'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {billingOptions.map(option => (
                    <SelectItem key={option} value={option}>
                      {formData.ssBilling ? option : `Day ${option}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {formData.ssBilling && (
                <p className="text-xs text-amber-500">
                  Customer receives Social Security payments - using SS payment schedule
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Status & Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Status & Notes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="status">Initial Status</Label>
              <Select
                value={formData.status}
                onValueChange={value => updateField('status', value as PolicyStatus)}
              >
                <SelectTrigger className="w-full md:w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {POLICY_STATUSES.map(status => (
                    <SelectItem key={status.value} value={status.value}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={e => updateField('notes', e.target.value)}
                placeholder="Any additional notes about this policy..."
                rows={4}
              />
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center justify-end gap-4">
          <Link href="/retention">
            <Button variant="outline">Cancel</Button>
          </Link>
          <Button type="submit" disabled={isSubmitting} className="gap-2">
            <Save className="h-4 w-4" />
            {isSubmitting ? 'Creating...' : 'Create Policy'}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default CustomerIntakeForm;
