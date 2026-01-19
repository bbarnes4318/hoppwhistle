'use client';

import { ChevronRight, Phone, User } from 'lucide-react';
import Link from 'next/link';

import type { RetentionPolicy, StatusConfig } from './RetentionDashboard';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatPhoneNumber, formatCurrency } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface PolicyCardProps {
  policy: RetentionPolicy;
  statusConfig: StatusConfig;
  onClick?: () => void;
}

// ============================================================================
// Component
// ============================================================================

export function PolicyCard({ policy, statusConfig, onClick }: PolicyCardProps): JSX.Element {
  const StatusIcon = statusConfig.icon;
  const isClickable = policy.status === 'DECLINED';

  const cardContent = (
    <Card
      className={cn(
        'transition-all hover:shadow-md',
        statusConfig.priority === 'high' && 'border-amber-500/30 bg-amber-500/5',
        statusConfig.priority === 'critical' &&
          'border-red-500/30 bg-red-500/5 animate-pulse cursor-pointer',
        statusConfig.priority === 'complete' && 'opacity-75'
      )}
      onClick={isClickable ? onClick : undefined}
    >
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Customer Info */}
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div
              className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center',
                statusConfig.priority === 'critical'
                  ? 'bg-red-500/20'
                  : statusConfig.priority === 'high'
                    ? 'bg-amber-500/20'
                    : 'bg-primary/10'
              )}
            >
              <User
                className={cn(
                  'h-6 w-6',
                  statusConfig.priority === 'critical'
                    ? 'text-red-500'
                    : statusConfig.priority === 'high'
                      ? 'text-amber-500'
                      : 'text-primary'
                )}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground truncate">
                  {policy.lead?.fullName || 'Unknown Customer'}
                </h3>
                <Badge variant="outline" className={cn('text-xs', statusConfig.color)}>
                  <StatusIcon className="h-3 w-3 mr-1" />
                  {statusConfig.label}
                </Badge>
              </div>

              <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Phone className="h-3 w-3" />
                  {formatPhoneNumber(policy.lead?.phoneNumber || '')}
                </span>
                {policy.carrier && <span className="truncate">{policy.carrier}</span>}
                {policy.lead?.city && policy.lead?.state && (
                  <span>
                    {policy.lead.city}, {policy.lead.state}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Center: Policy Info */}
          <div className="hidden md:flex items-center gap-6">
            {policy.coverage && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Coverage</p>
                <p className="font-semibold">{formatCurrency(policy.coverage)}</p>
              </div>
            )}
            {policy.monthlyPremium && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Premium</p>
                <p className="font-semibold">{formatCurrency(policy.monthlyPremium)}/mo</p>
              </div>
            )}
            {policy.policyType && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground">Type</p>
                <p className="font-semibold capitalize">
                  {policy.policyType.replace('_', ' ').toLowerCase()}
                </p>
              </div>
            )}
          </div>

          {/* Right: Onboarding Progress + Actions */}
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">Attempts</p>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'font-semibold',
                    policy.onboardingAttempts >= 7
                      ? 'text-red-500'
                      : policy.onboardingAttempts >= 4
                        ? 'text-amber-500'
                        : 'text-foreground'
                  )}
                >
                  {policy.onboardingAttempts}/9
                </span>
                <div className="w-16 h-2 bg-muted rounded-full">
                  <div
                    className={cn(
                      'h-2 rounded-full transition-all',
                      policy.onboardingAttempts >= 7
                        ? 'bg-red-500'
                        : policy.onboardingAttempts >= 4
                          ? 'bg-amber-500'
                          : 'bg-primary'
                    )}
                    style={{ width: `${(policy.onboardingAttempts / 9) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            {policy.status === 'DECLINED' ? (
              <Button
                variant="destructive"
                size="sm"
                className="gap-1"
                onClick={e => {
                  e.stopPropagation();
                  onClick?.();
                }}
              >
                GI Offer
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <Link href={`/retention/${policy.id}`}>
                <Button variant="outline" size="sm" className="gap-1">
                  View
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {/* Critical Alert Banner */}
        {policy.status === 'DECLINED' && (
          <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-sm text-red-500 font-medium flex items-center gap-2">
              <StatusIcon className="h-4 w-4" />
              Policy Declined - Present Guaranteed Issue Offer to Customer
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  return cardContent;
}

export default PolicyCard;
