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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RoleGuard } from '@/components/auth/role-guard';

function PublisherDocsPage() {
  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="border-b pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Support & Documentation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Welcome to the Publisher Developer Portal. Integrate, test, and troubleshoot your lead flow.
        </p>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Code className="h-5 w-5 text-cyan-400" />
              Ping/Post Integration
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Send lead details (ZIP code, state, etc.) using a two-step Ping/Post protocol to receive instant dynamic bids.
            </p>
            <Button size="xs" variant="outline" asChild className="text-xs mt-2">
              <a href="/publisher/api-setup" className="flex items-center gap-1">
                View API Keys & Specifications <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <Terminal className="h-5 w-5 text-primary" />
              Developer Tester
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>
              Use our built-in API tester to simulate lead requests using your active API key and campaign triggers.
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
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-emerald-400" />
            Lead Delivery Walkthrough
          </CardTitle>
          <CardDescription>How to send leads and initiate call transfers.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-slate-300">
          <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">Step 1</Badge> Send a Ping Request
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed pl-8">
            Send basic lead characteristics (such as age, state, zip code) to the <code>/api/v1/ping</code> endpoint. 
            Do not include personally identifiable information (PII). We will evaluate the lead and respond with a unique 
            <code>pingId</code> and the bid amount we are willing to pay if the lead converts.
          </p>

          <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">Step 2</Badge> Post the Lead details
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed pl-8">
            If you accept the bid, submit a POST request to <code>/api/v1/post</code> with the <code>pingId</code> and 
            the lead's contact information (first name, last name, phone number). The system validates the details and 
            returns a <code>routingNumber</code>.
          </p>

          <h3 className="font-semibold text-slate-100 flex items-center gap-1.5">
            <Badge variant="secondary" className="font-mono">Step 3</Badge> Dial and Transfer
          </h3>
          <p className="text-xs text-muted-foreground leading-relaxed pl-8">
            Initiate a telephony call transfer to the returned <code>routingNumber</code>. Ensure the caller ID matches 
            the phone number posted in Step 2. Once the call duration exceeds the campaign's billable threshold (usually 60 seconds), 
            the call will mark as billable and credit to your earnings.
          </p>
        </CardContent>
      </Card>

      {/* Support Card */}
      <Card className="bg-card border-border border-dashed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HelpCircle className="h-5 w-5 text-yellow-500" />
            Need Assistance?
          </CardTitle>
          <CardDescription>We are here to help you optimize your campaign volume.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pl-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span>Email Developer Support: <code>support@hopwhistle.com</code></span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
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
