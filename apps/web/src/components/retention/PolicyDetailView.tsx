'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  User,
  FileText,
  DollarSign,
  CalendarDays,
  Clock,
  Edit,
  Plus,
  Save,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn, formatCurrency, formatPhoneNumber } from '@/lib/utils';
import { usePhone } from '@/components/phone/phone-provider';

import type { RetentionPolicy, PolicyStatus } from '@/components/retention';

// ============================================================================
// Mock Data (Replace with API call using params.id)
// ============================================================================

const MOCK_POLICY: RetentionPolicy = {
  id: '1',
  leadId: 'lead-1',
  status: 'SUBMITTED',
  onboardingAttempts: 2,
  carrier: 'Mutual of Omaha',
  coverage: 25000,
  monthlyPremium: 45.99,
  policyType: 'LEVEL',
  ssBilling: true,
  billingDateStr: '3rd',
  primaryBeneficiary: 'Jane Smith',
  primaryRelationship: 'SPOUSE',
  contingentBeneficiary: 'John Jr. Smith',
  contingentRelationship: 'CHILD',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  lead: {
    id: 'lead-1',
    firstName: 'John',
    lastName: 'Smith',
    fullName: 'John Smith',
    phoneNumber: '+15551234567',
    email: 'john.smith@email.com',
    address: '123 Main Street',
    city: 'Dallas',
    state: 'TX',
    zipCode: '75201',
  },
};

const MOCK_NOTES = [
  {
    id: '1',
    note: 'Initial welcome call - customer confirmed contact info',
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    userId: 'agent-1',
  },
  {
    id: '2',
    note: 'Follow-up call - explained billing schedule, customer confirmed 3rd of month',
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    userId: 'agent-1',
  },
];

// ============================================================================
// Status Config
// ============================================================================

const getStatusConfig = (status: PolicyStatus) => {
  switch (status) {
    case 'SUBMITTED':
      return {
        label: 'Submitted',
        color: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        icon: Clock,
      };
    case 'UW_REVIEW':
      return {
        label: 'UW Review',
        color: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
        icon: FileText,
      };
    case 'ISSUED':
      return {
        label: 'Issued',
        color: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        icon: FileText,
      };
    case 'PAID':
      return {
        label: 'Paid',
        color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        icon: CheckCircle,
      };
    case 'DECLINED':
      return {
        label: 'Declined',
        color: 'bg-red-500/10 text-red-500 border-red-500/20',
        icon: XCircle,
      };
    case 'NOT_TAKEN':
      return {
        label: 'Not Taken',
        color: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
        icon: XCircle,
      };
    case 'LAPSED':
      return {
        label: 'Lapsed',
        color: 'bg-red-500/10 text-red-500 border-red-500/20',
        icon: AlertTriangle,
      };
    default:
      return {
        label: status,
        color: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
        icon: FileText,
      };
  }
};

// ============================================================================
// Component
// ============================================================================

interface PolicyDetailViewProps {
  policyId: string;
}

export function PolicyDetailView({ policyId }: PolicyDetailViewProps): JSX.Element {
  const router = useRouter();
  const { makeCall } = usePhone();
  const [policy] = useState<RetentionPolicy>(MOCK_POLICY);
  const [notes] = useState(MOCK_NOTES);
  const [newNote, setNewNote] = useState('');
  const [isLogging, setIsLogging] = useState(false);

  const statusConfig = getStatusConfig(policy.status);
  const StatusIcon = statusConfig.icon;

  // Log call handler - increments attempts and adds note
  const handleLogCall = useCallback(async () => {
    if (!newNote.trim()) return;
    setIsLogging(true);

    try {
      // TODO: API call - POST /api/v1/retention/{id}/log-call
      // { note: newNote }
      // This should increment onboardingAttempts and create a RetentionNote
      console.log('Logging call for policy:', policyId, 'Note:', newNote);
      await new Promise(resolve => setTimeout(resolve, 500));
      setNewNote('');
      // Refresh policy data
    } catch (error) {
      console.error('Failed to log call:', error);
    } finally {
      setIsLogging(false);
    }
  }, [policyId, newNote]);

  // Click-to-call handler
  const handleCallCustomer = useCallback(() => {
    if (policy.lead?.phoneNumber) {
      makeCall(policy.lead.phoneNumber);
    }
  }, [policy.lead?.phoneNumber, makeCall]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/retention">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">
                {policy.lead?.fullName || 'Unknown Customer'}
              </h1>
              <Badge variant="outline" className={cn('text-sm', statusConfig.color)}>
                <StatusIcon className="h-4 w-4 mr-1" />
                {statusConfig.label}
              </Badge>
            </div>
            <p className="text-muted-foreground">
              Policy ID: {policy.id} • Created {new Date(policy.createdAt).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={handleCallCustomer} className="gap-2">
            <Phone className="h-4 w-4" />
            Call Customer
          </Button>
          <Link href={`/retention/${policy.id}/edit`}>
            <Button variant="outline" className="gap-2">
              <Edit className="h-4 w-4" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Customer Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                Customer Information
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Full Name</p>
                <p className="font-medium">{policy.lead?.fullName || 'N/A'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Phone className="h-3 w-3" /> Phone
                </p>
                <p className="font-medium">{formatPhoneNumber(policy.lead?.phoneNumber || '')}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <Mail className="h-3 w-3" /> Email
                </p>
                <p className="font-medium">{policy.lead?.email || 'N/A'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Address
                </p>
                <p className="font-medium">
                  {policy.lead?.address ? (
                    <>
                      {policy.lead.address}
                      <br />
                      {policy.lead.city}, {policy.lead.state} {policy.lead.zipCode}
                    </>
                  ) : (
                    'N/A'
                  )}
                </p>
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
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Carrier</p>
                <p className="font-medium">{policy.carrier || 'N/A'}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Coverage</p>
                <p className="font-medium text-lg">{formatCurrency(policy.coverage || 0)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Monthly Premium</p>
                <p className="font-medium">{formatCurrency(policy.monthlyPremium || 0)}/mo</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Policy Type</p>
                <p className="font-medium capitalize">
                  {policy.policyType?.replace('_', ' ').toLowerCase() || 'N/A'}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Beneficiary Info */}
          <Card>
            <CardHeader>
              <CardTitle>Beneficiary Information</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-6">
              <div className="p-4 rounded-lg bg-muted/50">
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Primary Beneficiary
                </h4>
                <p className="font-medium">{policy.primaryBeneficiary || 'N/A'}</p>
                {policy.primaryRelationship && (
                  <p className="text-sm text-muted-foreground capitalize">
                    {policy.primaryRelationship.toLowerCase()}
                  </p>
                )}
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Contingent Beneficiary
                </h4>
                <p className="font-medium">{policy.contingentBeneficiary || 'None'}</p>
                {policy.contingentRelationship && (
                  <p className="text-sm text-muted-foreground capitalize">
                    {policy.contingentRelationship.toLowerCase()}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Call Log / Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Call Log & Notes</CardTitle>
              <CardDescription>Record notes from each call attempt</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Add Note */}
              <div className="flex gap-3">
                <Textarea
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Enter notes from this call..."
                  rows={2}
                  className="flex-1"
                />
                <Button
                  onClick={handleLogCall}
                  disabled={!newNote.trim() || isLogging}
                  className="gap-2"
                >
                  <Plus className="h-4 w-4" />
                  Log Call
                </Button>
              </div>

              {/* Notes List */}
              <div className="space-y-3 pt-4 border-t">
                {notes.length === 0 ? (
                  <p className="text-muted-foreground text-center py-4">No call notes yet</p>
                ) : (
                  notes.map(note => (
                    <div key={note.id} className="p-3 rounded-lg bg-muted/30 border border-border">
                      <p className="text-sm">{note.note}</p>
                      <p className="text-xs text-muted-foreground mt-2">
                        {new Date(note.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Onboarding Progress */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Onboarding Progress
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center">
                <span
                  className={cn(
                    'text-4xl font-bold',
                    policy.onboardingAttempts >= 7
                      ? 'text-red-500'
                      : policy.onboardingAttempts >= 4
                        ? 'text-amber-500'
                        : 'text-foreground'
                  )}
                >
                  {policy.onboardingAttempts}
                </span>
                <span className="text-2xl text-muted-foreground"> / 9</span>
                <p className="text-sm text-muted-foreground mt-1">Onboarding Attempts</p>
              </div>

              <div className="w-full h-3 bg-muted rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full transition-all',
                    policy.onboardingAttempts >= 7
                      ? 'bg-red-500'
                      : policy.onboardingAttempts >= 4
                        ? 'bg-amber-500'
                        : 'bg-primary'
                  )}
                  style={{ width: `${(policy.onboardingAttempts / 9) * 100}%` }}
                />
              </div>

              {policy.onboardingAttempts >= 7 && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <p className="text-sm text-red-500 font-medium">
                    ⚠️ Approaching attempt limit - escalate if needed
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Billing Info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CalendarDays className="h-5 w-5" />
                Billing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Billing Type</span>
                <Badge variant={policy.ssBilling ? 'default' : 'secondary'}>
                  {policy.ssBilling ? 'SS Billing' : 'Standard'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Billing Date</span>
                <span className="font-medium">
                  {policy.ssBilling ? policy.billingDateStr : `Day ${policy.billingDateStr}`}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Premium</span>
                <span className="font-medium text-lg">
                  {formatCurrency(policy.monthlyPremium || 0)}/mo
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Quick Actions */}
          <Card>
            <CardHeader>
              <CardTitle>Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button
                variant="outline"
                className="w-full justify-start gap-2"
                onClick={handleCallCustomer}
              >
                <Phone className="h-4 w-4" />
                Call Customer
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2 text-emerald-500 hover:text-emerald-500"
              >
                <CheckCircle className="h-4 w-4" />
                Mark as Paid
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start gap-2 text-red-500 hover:text-red-500"
              >
                <XCircle className="h-4 w-4" />
                Mark as Declined
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default PolicyDetailView;
