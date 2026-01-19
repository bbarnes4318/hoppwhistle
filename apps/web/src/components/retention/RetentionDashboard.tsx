'use client';

import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock,
  FileCheck,
  Phone,
  Plus,
  Search,
  User,
  XCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useState, useCallback } from 'react';

import { GuaranteedIssueModal } from './GuaranteedIssueModal';
import { PolicyCard } from './PolicyCard';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export type PolicyStatus =
  | 'SUBMITTED'
  | 'UW_REVIEW'
  | 'ISSUED'
  | 'PAID'
  | 'DECLINED'
  | 'NOT_TAKEN'
  | 'LAPSED';

export type PolicyType = 'LEVEL' | 'GRADED' | 'MODIFIED' | 'GUARANTEED_ISSUE';

export type RelationshipType =
  | 'SPOUSE'
  | 'CHILD'
  | 'PARENT'
  | 'GRANDCHILD'
  | 'SIBLING'
  | 'PARTNER'
  | 'FRIEND'
  | 'OTHER';

export interface RetentionPolicy {
  id: string;
  leadId: string;
  status: PolicyStatus;
  onboardingAttempts: number;
  carrier?: string;
  coverage?: number;
  monthlyPremium?: number;
  policyType?: PolicyType;
  ssBilling: boolean;
  billingDateStr?: string;
  primaryBeneficiary?: string;
  primaryRelationship?: RelationshipType;
  contingentBeneficiary?: string;
  contingentRelationship?: RelationshipType;
  createdAt: string;
  updatedAt: string;
  // Joined Lead data for display
  lead?: {
    id: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    phoneNumber: string;
    email?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
}

// ============================================================================
// Mock Data (Replace with API calls)
// ============================================================================

const MOCK_POLICIES: RetentionPolicy[] = [
  {
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lead: {
      id: 'lead-1',
      firstName: 'John',
      lastName: 'Smith',
      fullName: 'John Smith',
      phoneNumber: '+15551234567',
      email: 'john.smith@email.com',
      city: 'Dallas',
      state: 'TX',
      zipCode: '75201',
    },
  },
  {
    id: '2',
    leadId: 'lead-2',
    status: 'DECLINED',
    onboardingAttempts: 5,
    carrier: 'AIG',
    coverage: 15000,
    monthlyPremium: 35.0,
    policyType: 'GRADED',
    ssBilling: false,
    billingDateStr: '15',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lead: {
      id: 'lead-2',
      firstName: 'Mary',
      lastName: 'Johnson',
      fullName: 'Mary Johnson',
      phoneNumber: '+15559876543',
      email: 'mary.j@email.com',
      city: 'Houston',
      state: 'TX',
      zipCode: '77001',
    },
  },
  {
    id: '3',
    leadId: 'lead-3',
    status: 'UW_REVIEW',
    onboardingAttempts: 1,
    carrier: 'Gerber Life',
    coverage: 50000,
    monthlyPremium: 89.99,
    policyType: 'MODIFIED',
    ssBilling: true,
    billingDateStr: '2nd Wed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lead: {
      id: 'lead-3',
      firstName: 'Robert',
      lastName: 'Williams',
      fullName: 'Robert Williams',
      phoneNumber: '+15555551234',
      email: 'rwilliams@email.com',
      city: 'Austin',
      state: 'TX',
      zipCode: '78701',
    },
  },
  {
    id: '4',
    leadId: 'lead-4',
    status: 'PAID',
    onboardingAttempts: 9,
    carrier: 'Transamerica',
    coverage: 20000,
    monthlyPremium: 55.0,
    policyType: 'LEVEL',
    ssBilling: false,
    billingDateStr: '1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lead: {
      id: 'lead-4',
      firstName: 'Patricia',
      lastName: 'Brown',
      fullName: 'Patricia Brown',
      phoneNumber: '+15553334444',
      email: 'pat.brown@email.com',
      city: 'San Antonio',
      state: 'TX',
      zipCode: '78201',
    },
  },
];

// ============================================================================
// Status Helpers
// ============================================================================

export interface StatusConfig {
  label: string;
  color: string;
  icon: React.FC<{ className?: string }>;
  priority: 'high' | 'critical' | 'normal' | 'complete';
}

export const getStatusConfig = (status: PolicyStatus): StatusConfig => {
  switch (status) {
    case 'SUBMITTED':
      return {
        label: 'Submitted',
        color: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
        icon: Clock,
        priority: 'high',
      };
    case 'UW_REVIEW':
      return {
        label: 'UW Review',
        color: 'bg-orange-500/10 text-orange-500 border-orange-500/20',
        icon: FileCheck,
        priority: 'high',
      };
    case 'ISSUED':
      return {
        label: 'Issued',
        color: 'bg-blue-500/10 text-blue-500 border-blue-500/20',
        icon: FileCheck,
        priority: 'normal',
      };
    case 'PAID':
      return {
        label: 'Paid',
        color: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
        icon: Check,
        priority: 'complete',
      };
    case 'DECLINED':
      return {
        label: 'Declined',
        color: 'bg-red-500/10 text-red-500 border-red-500/20',
        icon: XCircle,
        priority: 'critical',
      };
    case 'NOT_TAKEN':
      return {
        label: 'Not Taken',
        color: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
        icon: XCircle,
        priority: 'complete',
      };
    case 'LAPSED':
      return {
        label: 'Lapsed',
        color: 'bg-red-500/10 text-red-500 border-red-500/20',
        icon: AlertTriangle,
        priority: 'complete',
      };
    default:
      return {
        label: status,
        color: 'bg-gray-500/10 text-gray-500 border-gray-500/20',
        icon: FileCheck,
        priority: 'normal',
      };
  }
};

// ============================================================================
// Main Component
// ============================================================================

export function RetentionDashboard(): JSX.Element {
  const [policies] = useState<RetentionPolicy[]>(MOCK_POLICIES);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('active');
  const [selectedDeclinedPolicy, setSelectedDeclinedPolicy] = useState<RetentionPolicy | null>(
    null
  );
  const [showGIModal, setShowGIModal] = useState(false);

  // Filter policies based on tab
  const activePolicies = policies.filter(
    p =>
      p.status !== 'PAID' &&
      p.status !== 'NOT_TAKEN' &&
      p.status !== 'LAPSED' &&
      p.onboardingAttempts < 9
  );

  const completedPolicies = policies.filter(
    p =>
      p.status === 'PAID' ||
      p.status === 'NOT_TAKEN' ||
      p.status === 'LAPSED' ||
      p.onboardingAttempts >= 9
  );

  // Filter by search
  const filterBySearch = (p: RetentionPolicy) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      p.lead?.fullName?.toLowerCase().includes(query) ||
      p.lead?.phoneNumber?.includes(query) ||
      p.lead?.email?.toLowerCase().includes(query) ||
      p.carrier?.toLowerCase().includes(query)
    );
  };

  const filteredActive = activePolicies.filter(filterBySearch);
  const filteredCompleted = completedPolicies.filter(filterBySearch);

  // Stats
  const highPriorityCount = activePolicies.filter(
    p => p.status === 'SUBMITTED' || p.status === 'UW_REVIEW'
  ).length;
  const criticalCount = activePolicies.filter(p => p.status === 'DECLINED').length;
  const avgAttempts =
    activePolicies.length > 0
      ? Math.round(
          activePolicies.reduce((acc, p) => acc + p.onboardingAttempts, 0) / activePolicies.length
        )
      : 0;

  // Handle declined policy click - show GI modal
  const handlePolicyClick = useCallback((policy: RetentionPolicy) => {
    if (policy.status === 'DECLINED') {
      setSelectedDeclinedPolicy(policy);
      setShowGIModal(true);
    }
  }, []);

  const handleCloseGIModal = useCallback(() => {
    setShowGIModal(false);
    setSelectedDeclinedPolicy(null);
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Retention Queue</h1>
          <p className="text-muted-foreground">Manage policy onboarding and retention follow-ups</p>
        </div>
        <Link href="/retention/new">
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            New Policy
          </Button>
        </Link>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Active Policies</CardDescription>
            <CardTitle className="text-3xl">{activePolicies.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Awaiting completion</p>
          </CardContent>
        </Card>

        <Card className="border-amber-500/20">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-500" />
              High Priority
            </CardDescription>
            <CardTitle className="text-3xl text-amber-500">{highPriorityCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Submitted or UW Review</p>
          </CardContent>
        </Card>

        <Card className="border-red-500/20">
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              Critical Alerts
            </CardDescription>
            <CardTitle className="text-3xl text-red-500">{criticalCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">Declined - GI Offer Required</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Avg. Onboarding Attempts</CardDescription>
            <CardTitle className="text-3xl">{avgAttempts}/9</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${(avgAttempts / 9) * 100}%` }}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search and Tabs */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, or carrier..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Policy List */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="active" className="gap-2">
            Active
            <Badge variant="secondary" className="ml-1">
              {filteredActive.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="completed" className="gap-2">
            Completed
            <Badge variant="secondary" className="ml-1">
              {filteredCompleted.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-6">
          {filteredActive.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileCheck className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Active Policies</h3>
                <p className="text-muted-foreground text-center">
                  All policies have been completed or no policies match your search.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredActive.map(policy => (
                <PolicyCard
                  key={policy.id}
                  policy={policy}
                  statusConfig={getStatusConfig(policy.status)}
                  onClick={() => handlePolicyClick(policy)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="completed" className="mt-6">
          {filteredCompleted.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Check className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Completed Policies</h3>
                <p className="text-muted-foreground text-center">
                  Completed policies will appear here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {filteredCompleted.map(policy => (
                <PolicyCard
                  key={policy.id}
                  policy={policy}
                  statusConfig={getStatusConfig(policy.status)}
                  onClick={() => handlePolicyClick(policy)}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Guaranteed Issue Modal */}
      {showGIModal && selectedDeclinedPolicy && (
        <GuaranteedIssueModal policy={selectedDeclinedPolicy} onClose={handleCloseGIModal} />
      )}
    </div>
  );
}

export default RetentionDashboard;
