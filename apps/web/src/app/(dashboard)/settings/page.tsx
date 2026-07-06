'use client';

import { Plus, Copy, Trash2, Loader2, Shield, Scale, FileText } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from '@/components/ui/use-toast';

import { DemoToggle } from '@/components/demo/demo-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddWebhookDialog } from '@/components/webhooks/add-webhook-dialog';
import { apiClient } from '@/lib/api';
import { CompactPageShell, CompactPageHeader } from '@/components/layout/compact-layout';

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

  useEffect(() => {
    void loadWebhooks();
  }, []);

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
        toast({ variant: 'destructive', title: 'Error', description: `Failed to delete webhook: ${response.error.message}` });
      }
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: `Failed to delete webhook: ${err instanceof Error ? err.message : 'Unknown error'}` });
    }
  };

  return (
    <CompactPageShell fullHeight={false}>
      <CompactPageHeader
        title="Settings"
        subtitle="Manage your account settings and integrations"
      >
        <div className="flex items-center gap-2 border border-border/40 rounded px-2 py-1 bg-card/50">
          <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Demo Mode:</span>
          <DemoToggle />
        </div>
      </CompactPageHeader>

      <Tabs defaultValue="webhooks" className="w-full flex flex-col">
        <TabsList className="w-full justify-start border-b border-border/40 bg-transparent h-9 p-0 mb-3 gap-6">
          <TabsTrigger
            value="webhooks"
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none border-b-2 border-transparent h-9 px-1 text-xs font-semibold text-muted-foreground"
          >
            Webhooks
          </TabsTrigger>
          <TabsTrigger
            value="api-keys"
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none border-b-2 border-transparent h-9 px-1 text-xs font-semibold text-muted-foreground"
          >
            API Keys
          </TabsTrigger>
          <TabsTrigger
            value="dnc"
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none border-b-2 border-transparent h-9 px-1 text-xs font-semibold text-muted-foreground"
          >
            DNC Lists
          </TabsTrigger>
          <TabsTrigger
            value="legal"
            className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-white rounded-none border-b-2 border-transparent h-9 px-1 text-xs font-semibold text-muted-foreground"
          >
            Legal
          </TabsTrigger>
        </TabsList>

        <TabsContent value="webhooks" className="w-full mt-0 data-[state=active]:flex flex-col">
          <Card className="w-full border-border/40 shadow-sm">
            <CardHeader className="flex-shrink-0 p-3 pb-2 border-b border-border/10 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Webhooks</CardTitle>
                <CardDescription className="text-[10px] text-muted-foreground mt-0.5">Configure webhook endpoints for events</CardDescription>
              </div>
              <Button size="sm" className="h-7 text-xs px-2.5" onClick={() => setAddWebhookOpen(true)}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Webhook
              </Button>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : webhooks.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                  No webhooks configured
                </div>
              ) : (
                <Table className="table-dense">
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
                        <TableCell className="font-mono text-[11px] truncate max-w-[300px]">{webhook.url}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {webhook.events.slice(0, 2).map(event => (
                              <Badge key={event} variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                                {event}
                              </Badge>
                            ))}
                            {webhook.events.length > 2 && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">
                                +{webhook.events.length - 2}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={webhook.status === 'active' ? 'success' : 'secondary'} className="text-[10px] py-0 px-1.5 h-4">
                            {webhook.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {webhook.lastTriggeredAt
                            ? new Date(webhook.lastTriggeredAt).toLocaleString()
                            : 'Never'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => handleDeleteWebhook(webhook.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="api-keys" className="w-full mt-0 data-[state=active]:flex flex-col">
          <Card className="w-full border-border/40 shadow-sm">
            <CardHeader className="flex-shrink-0 p-3 pb-2 border-b border-border/10 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">API Keys</CardTitle>
                <CardDescription className="text-[10px] text-muted-foreground mt-0.5">Manage your API authentication keys</CardDescription>
              </div>
              <Button size="sm" className="h-7 text-xs px-2.5">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Generate Key
              </Button>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="table-dense">
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
                    <TableCell className="font-medium text-xs">Production Key</TableCell>
                    <TableCell className="font-mono text-[11px]">cf_live_****1234</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date().toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0">
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dnc" className="w-full mt-0 data-[state=active]:flex flex-col">
          <Card className="w-full border-border/40 shadow-sm">
            <CardHeader className="flex-shrink-0 p-3 pb-2 border-b border-border/10 flex flex-row items-center justify-between space-y-0">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">DNC Lists</CardTitle>
                <CardDescription className="text-[10px] text-muted-foreground mt-0.5">Upload and manage Do Not Call lists</CardDescription>
              </div>
              <Button size="sm" className="h-7 text-xs px-2.5">
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Upload List
              </Button>
            </CardHeader>
            <CardContent className="p-0 overflow-x-auto">
              <Table className="table-dense">
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
                    <TableCell className="font-medium text-xs">Global DNC</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 h-4">Global</Badge>
                    </TableCell>
                    <TableCell className="text-xs">1,234</TableCell>
                    <TableCell>
                      <Badge variant="success" className="text-[10px] py-0 px-1.5 h-4">Active</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="legal" className="w-full mt-0 data-[state=active]:flex flex-col">
          <Card className="w-full border-border/40 shadow-sm">
            <CardHeader className="flex-shrink-0 p-3 pb-2 border-b border-border/10">
              <div>
                <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Legal Documents</CardTitle>
                <CardDescription className="text-[10px] text-muted-foreground mt-0.5">
                  Privacy policy, terms of service, and compliance documents
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-3">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                <a
                  href="/legal/privacy"
                  className="flex items-center gap-2.5 p-2.5 rounded border border-border bg-card hover:bg-muted transition-colors text-xs"
                >
                  <Shield className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="truncate">
                    <div className="font-medium text-white">Privacy Policy</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      How we collect and use your data
                    </div>
                  </div>
                </a>
                <a
                  href="/legal/terms"
                  className="flex items-center gap-2.5 p-2.5 rounded border border-border bg-card hover:bg-muted transition-colors text-xs"
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="truncate">
                    <div className="font-medium text-white">Terms of Service</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      Service agreements and conditions
                    </div>
                  </div>
                </a>
                <a
                  href="/legal/data-retention"
                  className="flex items-center gap-2.5 p-2.5 rounded border border-border bg-card hover:bg-muted transition-colors text-xs"
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="truncate">
                    <div className="font-medium text-white">Data Retention Policy</div>
                    <div className="text-[10px] text-muted-foreground truncate">How long we keep your data</div>
                  </div>
                </a>
                <a
                  href="/legal/call-recording"
                  className="flex items-center gap-2.5 p-2.5 rounded border border-border bg-card hover:bg-muted transition-colors text-xs"
                >
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="truncate">
                    <div className="font-medium text-white">Call Recording Policy</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      Recording consent and compliance
                    </div>
                  </div>
                </a>
                <a
                  href="/legal/dpa"
                  className="flex items-center gap-2.5 p-2.5 rounded border border-border bg-card hover:bg-muted transition-colors text-xs"
                >
                  <Scale className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="truncate">
                    <div className="font-medium text-white">Data Processing Agreement</div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      GDPR and data processing terms
                    </div>
                  </div>
                </a>
              </div>
              <div className="mt-4 pt-3 border-t border-border/10 text-[10px] text-muted-foreground flex justify-between items-center">
                <span>© {new Date().getFullYear()} Hopwhistle. All rights reserved.</span>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AddWebhookDialog
        open={addWebhookOpen}
        onOpenChange={setAddWebhookOpen}
        onSuccess={loadWebhooks}
      />
    </CompactPageShell>
  );
}
