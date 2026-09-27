'use client';

import {
  BookOpen,
  Code,
  ExternalLink,
  HelpCircle,
  Mail,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import { useBrand } from '@/hooks/use-brand';
import { apiClient } from '@/lib/api';

function PublisherDocsPage() {
  const { productName } = useBrand();
  const { publisherId } = useAuth();

  /*
   * Who to write to is the agency that pays this publisher -- its owner's
   * email, from the docs endpoint -- not NetEnroll. Until it loads, or when the
   * agency has no owner on file, the card says to contact the agency rather
   * than printing an address that is not theirs.
   */
  const [supportEmail, setSupportEmail] = useState<string | null>(null);
  useEffect(() => {
    if (!publisherId) return;
    let cancelled = false;
    void apiClient
      .get<{ supportEmail?: string | null }>(`/api/v1/publishers/${publisherId}/docs`)
      .then(response => {
        if (!cancelled) setSupportEmail(response.data?.supportEmail ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [publisherId]);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="border-b pb-4">
        <p className="mt-1 text-sm text-ink-2">
          Everything you need to integrate with {productName}, test your integration, and work out
          what went wrong when a call does not price the way you expected.
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Code className="h-5 w-5 text-brand-ink" />
              Ping/Post Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-ink-2 space-y-2">
            <p>
              Send lead details (ZIP code, state, etc.) using a two-step Ping/Post protocol to
              receive instant dynamic bids.
            </p>
            <Button size={null} variant="outline" asChild className="text-xs mt-2">
              <a href="/publisher/api-setup" className="flex items-center gap-1">
                View API Keys & Specifications <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-surface border-rule">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Terminal className="h-5 w-5 text-brand-ink" />
              Live post test
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-ink-2 space-y-2">
            <p>
              Send a real ping and post with your API key. This leases a real number and may route a
              real call.
            </p>
            <Button size={null} variant="outline" asChild className="text-xs mt-2">
              <a href="/publisher/tester" className="flex items-center gap-1">
                Open live post test <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Integration Guide */}
      <Card className="bg-surface border-rule">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-brand-ink" />
            Lead Delivery Walkthrough
          </CardTitle>
          <CardDescription>How to send leads and initiate call transfers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-ink-2">
          <h3 className="font-semibold text-ink flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">
              Step 1
            </Badge>{' '}
            Send a Ping Request
          </h3>
          <p className="text-xs text-ink-2 leading-relaxed pl-8">
            Send basic lead characteristics (such as age, state, zip code) to the{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">/api/v1/ping</code>{' '}
            endpoint. Do not include personally identifiable information (PII). We run the auction
            and answer with a{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">ping_id</code>, the{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">bid</code> we will pay
            and, when there is a bid, a{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">token</code> that is good
            for a few minutes. A{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">bid</code> of 0 means no
            buyer wanted the call.
          </p>

          <h3 className="font-semibold text-ink flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">
              Step 2
            </Badge>{' '}
            Post the call
          </h3>
          <p className="text-xs text-ink-2 leading-relaxed pl-8">
            If you accept the bid, send a POST request to{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">/api/v1/post</code> with
            the <code className="bg-sunken text-ink rounded-control font-mono">token</code> from the
            ping and the{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">caller_number</code> you
            will transfer. When the post is accepted the answer has{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">accepted: true</code> and
            a <code className="bg-sunken text-ink rounded-control font-mono">transfer_number</code>.
            This leases a real number.
          </p>

          <h3 className="font-semibold text-ink flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">
              Step 3
            </Badge>{' '}
            Dial and Transfer
          </h3>
          <p className="text-xs text-ink-2 leading-relaxed pl-8">
            Transfer the caller to the returned{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">transfer_number</code>.
            Make sure the caller ID matches the{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">caller_number</code> you
            posted in Step 2. Once the call duration exceeds the campaign&apos;s billable threshold
            (usually 60 seconds), the call will mark as billable and credit to your earnings.
          </p>
        </CardContent>
      </Card>

      {/* Support Card */}
      <Card className="bg-surface border-rule border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-ringing-ink" />
            Need Assistance?
          </CardTitle>
          <CardDescription>
            If a call did not price the way you expected, please get in touch and we will look at it
            with you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pl-6">
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <Mail className="h-4 w-4 text-ink-2" />
            {supportEmail ? (
              <span>
                Email:{' '}
                <a
                  href={`mailto:${supportEmail}`}
                  className="bg-sunken text-ink rounded-control font-mono underline-offset-2 hover:underline"
                >
                  {supportEmail}
                </a>
              </span>
            ) : (
              <span>Contact the agency that set up your account.</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <ShieldCheck className="h-4 w-4 text-live-ink" />
            <span>Security Compliance: HTTPS TLS 1.3 is enforced on all API endpoints.</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function GuardedPublisherDocsPage() {
  return (
    <RoleGuard allowedRoles={['PUBLISHER']}>
      <PublisherDocsPage />
    </RoleGuard>
  );
}
