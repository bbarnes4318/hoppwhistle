'use client';

import { Plus, Copy, Trash2, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

import { DemoToggle } from '@/components/demo/demo-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AddWebhookDialog } from '@/components/webhooks/add-webhook-dialog';
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

  useEffect(() => {
    loadWebhooks();
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
        loadWebhooks();
      } else {
        alert(`Failed to delete webhook: ${response.error.message}`);
      }
    } catch (err) {
      alert(`Failed to delete webhook: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 mb-4">
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account settings and integrations</p>
      </div>

      <Card className="flex-shrink-0 mb-4">
        <CardHeader>
          <CardTitle>Demo Mode</CardTitle>
          <CardDescription>Switch between live and demo data for presentations</CardDescription>
        </CardHeader>
        <CardContent>
          <DemoToggle />
        </CardContent>
      </Card>

      <Tabs defaultValue="webhooks" className="flex-1 flex flex-col overflow-hidden min-h-0">
        <TabsList>
          <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          <TabsTrigger value="api-keys">API Keys</TabsTrigger>
          <TabsTrigger value="dnc">DNC Lists</TabsTrigger>
        </TabsList>

        <TabsContent value="webhooks" className="flex-1 flex flex-col overflow-hidden min-h-0">
          <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
            <CardHeader className="flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Webhooks</CardTitle>
                  <CardDescription>Configure webhook endpoints for events</CardDescription>
                </div>
                <Button onClick={() => setAddWebhookOpen(true)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Webhook
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto min-h-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : webhooks.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">No webhooks configured</div>
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
                    {webhooks.map((webhook) => (
                      <TableRow key={webhook.id}>
                        <TableCell className="font-mono text-sm">{webhook.url}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {webhook.events.slice(0, 2).map((event) => (
                              <Badge key={event} variant="outline" className="text-xs">
                                {event}
                              </Badge>
                            ))}
                            {webhook.events.length > 2 && (
                              <Badge variant="outline" className="text-xs">
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
                        <TableCell>
                          {webhook.lastTriggeredAt
                            ? new Date(webhook.lastTriggeredAt).toLocaleString()
                            : 'Never'}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDeleteWebhook(webhook.id)}
                          >
                            <Trash2 className="h-4 w-4" />
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

        <TabsContent value="api-keys" className="flex-1 flex flex-col overflow-hidden min-h-0">
          <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
            <CardHeader className="flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>API Keys</CardTitle>
                  <CardDescription>Manage your API authentication keys</CardDescription>
                </div>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Generate Key
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto min-h-0">
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
                    <TableCell>Production Key</TableCell>
                    <TableCell className="font-mono text-sm">cf_live_****1234</TableCell>
                    <TableCell>{new Date().toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="dnc" className="flex-1 flex flex-col overflow-hidden min-h-0">
          <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
            <CardHeader className="flex-shrink-0">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>DNC Lists</CardTitle>
                  <CardDescription>Upload and manage Do Not Call lists</CardDescription>
                </div>
                <Button>
                  <Plus className="mr-2 h-4 w-4" />
                  Upload List
                </Button>
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto min-h-0">
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
                    <TableCell>Global DNC</TableCell>
                    <TableCell>
                      <Badge variant="outline">Global</Badge>
                    </TableCell>
                    <TableCell>1,234</TableCell>
                    <TableCell>
                      <Badge variant="success">Active</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
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

