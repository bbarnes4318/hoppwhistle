'use client';

import {
  BookOpen,
  Code,
  ExternalLink,
  FileCode2,
  HelpCircle,
  Mail,
  ShieldCheck,
  Terminal,
} from 'lucide-react';

import { RoleGuard } from '@/components/auth/role-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

function PublisherDocsPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-ink">Support & Documentation</h1>
        <p className="mt-1 text-sm text-ink-2">
          Everything you need to integrate with NetEnroll, test your integration, and work out what
          went wrong when a call does not price the way you expected.
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
            <Button size="xs" variant="outline" asChild className="text-xs mt-2">
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
              Developer Tester
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-ink-2 space-y-2">
            <p>
              Use our built-in API tester to simulate lead requests using your active API key and
              campaign triggers.
            </p>
            <Button size="xs" variant="outline" asChild className="text-xs mt-2">
              <a href="/publisher/tester" className="flex items-center gap-1">
                Open Sandbox Tester <ExternalLink className="h-3 w-3" />
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
            endpoint. Do not include personally identifiable information (PII). We will evaluate the
            lead and respond with a unique
            <code className="bg-sunken text-ink rounded-control font-mono">pingId</code> and the bid
            amount we are willing to pay if the lead converts.
          </p>

          <h3 className="font-semibold text-ink flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">
              Step 2
            </Badge>{' '}
            Post the Lead details
          </h3>
          <p className="text-xs text-ink-2 leading-relaxed pl-8">
            If you accept the bid, submit a POST request to{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">/api/v1/post</code> with
            the <code className="bg-sunken text-ink rounded-control font-mono">pingId</code> and the
            lead's contact information (first name, last name, phone number). The system validates
            the details and returns a{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">routingNumber</code>.
          </p>

          <h3 className="font-semibold text-ink flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">
              Step 3
            </Badge>{' '}
            Dial and Transfer
          </h3>
          <p className="text-xs text-ink-2 leading-relaxed pl-8">
            Initiate a telephony call transfer to the returned{' '}
            <code className="bg-sunken text-ink rounded-control font-mono">routingNumber</code>.
            Ensure the caller ID matches the phone number posted in Step 2. Once the call duration
            exceeds the campaign's billable threshold (usually 60 seconds), the call will mark as
            billable and credit to your earnings.
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
            If a call did not price the way you expected, please get in touch and we will look at
            it with you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pl-6">
          <div className="flex items-center gap-2 text-xs text-ink-2">
            <Mail className="h-4 w-4 text-ink-2" />
            <span>
              Email Developer Support:{' '}
              <code className="bg-sunken text-ink rounded-control font-mono">
                support@netenroll.com
              </code>
            </span>
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
