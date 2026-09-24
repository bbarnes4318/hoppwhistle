'use client';

import { Plus, Copy, Trash2, Loader2, Shield, Scale, FileText } from 'lucide-react';
import { useState, useEffect } from 'react';

import { DemoToggle } from '@/components/demo/demo-toggle';
import {
  EmptyState,
  Notice,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import { AddWebhookDialog } from '@/components/webhooks/add-webhook-dialog';
import { usePlatformContext } from '@/hooks/use-platform-context';
import { useReadOnlyPreview } from '@/hooks/use-read-only-preview';
import { apiClient } from '@/lib/api';

interface Webhook {
  id: string;
  url: string;
  events: string[];
  status: string;
  lastTriggeredAt: string | null;
}

export default function SettingsPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [addWebhookOpen, setAddWebhookOpen] = useState(false);
  // A read-only role preview cannot add or delete a webhook.
  const { readOnly, disabledProps: readOnlyProps } = useReadOnlyPreview();
  /*
   * Webhooks belong to one agency, and this page is reachable without one.
   *
   * /settings is in PLATFORM_WIDE_PREFIXES so NetEnroll staff can open it
   * without entering an agency — the account and appearance sections below are
   * theirs either way. The webhook list is not: it is agency-scoped, so asking
   * for it with no acting tenant is a request the server refuses 409, twice per
   * load, for a list that could never have rendered. Same shape as the defect
   * Phase 5 fixed on /delivery; the browser smoke test found this one.
   */
  const platform = usePlatformContext();
  const withoutAgency = platform.needsAgency;

  useEffect(() => {
    if (platform.loading) return;
    if (withoutAgency) {
      setWebhooks([]);
      setLoading(false);
      return;
    }
    void loadWebhooks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform.loading, withoutAgency]);

  const loadWebhooks = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<{ data: Webhook[] }>('/api/v1/webhooks');
      if (response.data?.data) {
        setWebhooks(response.data.data);
      }
    } catch (err) {
      console.error('Failed to load webhooks:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWebhook = async (webhookId: string) => {
    if (!confirm('Are you sure you want to delete this webhook?')) {
      return;
    }

    try {
      const response = await apiClient.delete(`/api/v1/webhooks/${webhookId}`);
      if (!response.error) {
        void loadWebhooks();
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: `Failed to delete webhook: ${response.error.message}`,
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: `Failed to delete webhook: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  };

  return (
    <div className="page-canvas">
      {/*
       * The tabs are the first thing on the page. The title is already in the
       * topbar, and the demo-mode switch that used to sit in a full-width
       * "Workspace" card above them is a tab of its own: it is a setting like
       * the others, not something every visit needs to scroll past.
       */}
      <Tabs defaultValue="webhooks" className="w-full">
        <TabsList>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="dnc">DNC Lists</TabsTrigger>
          <TabsTrigger value="workspace">Workspace</TabsTrigger>
          <TabsTrigger value="legal">Legal</TabsTrigger>
        </TabsList>

        <TabsContent value="workspace">
          <Panel>
            <PanelBody>
              <DemoToggle />
            </PanelBody>
          </Panel>
        </TabsContent>

        <TabsContent value="webhooks">
          <Panel>
            <PanelHeader
              action={
                <Button
                  size="sm"
                  onClick={() => setAddWebhookOpen(true)}
                  disabled={readOnly}
                  title={readOnlyProps.title}
                >
                  <Plus className="h-4 w-4" />
                  Add Webhook
                </Button>
              }
            >
              <PanelTitle>Webhooks</PanelTitle>
              <PanelDescription>Configure webhook endpoints for events</PanelDescription>
            </PanelHeader>
            <PanelBody flush className="overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-ink-3" />
                </div>
              ) : withoutAgency ? (
                <div className="p-5">
                  <Notice tone="info">
                    Webhooks belong to an agency. Enter one in the switcher above to see and manage
                    its endpoints.
                  </Notice>
                </div>
              ) : webhooks.length === 0 ? (
                <EmptyState
                  headline="No webhooks configured"
                  body="Send call and application events to your own systems."
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>URL</TableHead>
                      <TableHead>Events</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Last Triggered</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {webhooks.map(webhook => (
                      <TableRow key={webhook.id}>
                        <TableCell className="t-data max-w-[300px] truncate text-ink">
                          {webhook.url}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {webhook.events.slice(0, 2).map(event => (
                              <Badge key={event} variant="outline">
                                {event}
                              </Badge>
                            ))}
                            {webhook.events.length > 2 && (
                              <Badge variant="outline" className="tabular-nums">
                                +{webhook.events.length - 2}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={webhook.status === 'active' ? 'success' : 'secondary'}>
                            {webhook.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="t-data whitespace-nowrap text-ink-3">
                          {webhook.lastTriggeredAt
                            ? new Date(webhook.lastTriggeredAt).toLocaleString()
                            : 'Never'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Tooltip content="Delete webhook" align="end">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="hover:bg-dropped-tint hover:text-dropped-ink"
                              onClick={() => handleDeleteWebhook(webhook.id)}
                              disabled={readOnly}
                              title={readOnlyProps.title}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </PanelBody>
          </Panel>
        </TabsContent>

        <TabsContent value="api-keys">
          <Panel>
            <PanelHeader
              action={
                <Button size="sm">
                  <Plus className="h-4 w-4" />
                  Generate Key
                </Button>
              }
            >
              <PanelTitle>API Keys</PanelTitle>
              <PanelDescription>Manage your API authentication keys</PanelDescription>
            </PanelHeader>
            <PanelBody flush className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Key</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium text-ink">Production Key</TableCell>
                    <TableCell className="t-data text-ink-2">cf_live_****1234</TableCell>
                    <TableCell className="t-data text-ink-3">
                      {new Date().toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Tooltip content="Copy key" align="end">
                        <Button variant="ghost" size="icon">
                          <Copy className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>
        </TabsContent>

        <TabsContent value="dnc">
          <Panel>
            <PanelHeader
              action={
                <Button size="sm">
                  <Plus className="h-4 w-4" />
                  Upload List
                </Button>
              }
            >
              <PanelTitle>DNC Lists</PanelTitle>
              <PanelDescription>Upload and manage Do Not Call lists</PanelDescription>
            </PanelHeader>
            <PanelBody flush className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Entries</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell className="font-medium text-ink">Global DNC</TableCell>
                    <TableCell>
                      <Badge variant="outline">Global</Badge>
                    </TableCell>
                    <TableCell className="t-num text-ink">1,234</TableCell>
                    <TableCell>
                      <Badge variant="success">Active</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Tooltip content="Delete key" align="end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-dropped-tint hover:text-dropped-ink"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </PanelBody>
          </Panel>
        </TabsContent>

        <TabsContent value="legal">
          <Panel>
            <PanelHeader>
              <PanelTitle>Legal Documents</PanelTitle>
              <PanelDescription>
                Privacy policy, terms of service, and compliance documents
              </PanelDescription>
            </PanelHeader>
            <PanelBody>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                <a
                  href="/legal/privacy"
                  className="flex min-w-0 items-center gap-3 rounded-card border border-rule bg-surface p-4 shadow-card transition-shadow duration-150 ease-out hover:shadow-raised"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                    <Shield className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">Privacy Policy</div>
                    <div className="t-meta truncate text-ink-3">
                      How we collect and use your data
                    </div>
                  </div>
                </a>
                <a
                  href="/legal/terms"
                  className="flex min-w-0 items-center gap-3 rounded-card border border-rule bg-surface p-4 shadow-card transition-shadow duration-150 ease-out hover:shadow-raised"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">Terms of Service</div>
                    <div className="t-meta truncate text-ink-3">
                      Service agreements and conditions
                    </div>
                  </div>
                </a>
                <a
                  href="/legal/data-retention"
                  className="flex min-w-0 items-center gap-3 rounded-card border border-rule bg-surface p-4 shadow-card transition-shadow duration-150 ease-out hover:shadow-raised"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">
                      Data Retention Policy
                    </div>
                    <div className="t-meta truncate text-ink-3">How long we keep your data</div>
                  </div>
                </a>
                <a
                  href="/legal/call-recording"
                  className="flex min-w-0 items-center gap-3 rounded-card border border-rule bg-surface p-4 shadow-card transition-shadow duration-150 ease-out hover:shadow-raised"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">
                      Call Recording Policy
                    </div>
                    <div className="t-meta truncate text-ink-3">
                      Recording consent and compliance
                    </div>
                  </div>
                </a>
                <a
                  href="/legal/dpa"
                  className="flex min-w-0 items-center gap-3 rounded-card border border-rule bg-surface p-4 shadow-card transition-shadow duration-150 ease-out hover:shadow-raised"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-brand-tint text-brand-ink">
                    <Scale className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">
                      Data Processing Agreement
                    </div>
                    <div className="t-meta truncate text-ink-3">GDPR and data processing terms</div>
                  </div>
                </a>
              </div>
              <div className="t-meta mt-5 flex items-center justify-between border-t border-rule pt-4 text-ink-3">
                <span>© {new Date().getFullYear()} NetEnroll. All rights reserved.</span>
              </div>
            </PanelBody>
          </Panel>
        </TabsContent>
      </Tabs>

      <AddWebhookDialog
        open={addWebhookOpen}
        onOpenChange={setAddWebhookOpen}
        onSuccess={loadWebhooks}
      />
    </div>
  );
}
