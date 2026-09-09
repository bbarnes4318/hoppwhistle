'use client';

import {
  Copy,
  Check,
  Key,
  Plus,
  Trash2,
  Loader2,
  BookOpen,
  Code2,
  Shield,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';

interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  status: string;
  scopes: string[];
  lastUsedAt?: string | null;
  createdAt: string;
  expiresAt?: string | null;
}

interface IntegrationDocs {
  publisherId: string;
  publisherCode: string;
  pingEndpoint: string;
  postEndpoint: string;
  docs: {
    curlPing: string;
    curlPost: string;
  };
}

function PublisherApiSetupPage() {
  const { user } = useAuth();
  const publisherId = user?.publisherId;

  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [docs, setDocs] = useState<IntegrationDocs | null>(null);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadingDocs, setLoadingDocs] = useState(true);

  // Key Generation Dialog
  const [openGenDialog, setOpenGenDialog] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [expiresDays, setExpiresDays] = useState('30');
  const [generating, setGenerating] = useState(false);

  // Raw Key Result Dialog (shown once)
  const [openResultDialog, setOpenResultDialog] = useState(false);
  const [newRawKey, setNewRawKey] = useState('');

  // Copy state
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [copiedTextType, setCopiedTextType] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    if (!publisherId) return;
    setLoadingKeys(true);
    try {
      const res = await apiClient.get<{ keys: ApiKeyRecord[] }>(
        `/api/v1/publishers/${publisherId}/keys`
      );
      if (res.data) {
        setKeys(res.data.keys || []);
      }
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
      toast.error('Failed to load API keys');
    } finally {
      setLoadingKeys(false);
    }
  }, [publisherId]);

  const fetchDocs = useCallback(async () => {
    if (!publisherId) return;
    setLoadingDocs(true);
    try {
      const res = await apiClient.get<IntegrationDocs>(`/api/v1/publishers/${publisherId}/docs`);
      if (res.data) {
        setDocs(res.data);
      }
    } catch (err) {
      console.error('Failed to fetch integration docs:', err);
    } finally {
      setLoadingDocs(false);
    }
  }, [publisherId]);

  useEffect(() => {
    void fetchKeys();
    void fetchDocs();
  }, [fetchKeys, fetchDocs]);

  const handleGenerateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!publisherId) return;
    setGenerating(true);
    try {
      const days = parseInt(expiresDays);
      const res = await apiClient.post<{ key: ApiKeyRecord; rawKey: string }>(
        `/api/v1/publishers/${publisherId}/keys`,
        {
          name: keyName.trim() || 'API Key',
          expiresDays: isNaN(days) ? 0 : days,
        }
      );
      if (res.data) {
        setNewRawKey(res.data.rawKey);
        setKeyName('');
        setExpiresDays('30');
        setOpenGenDialog(false);
        setOpenResultDialog(true);
        void fetchKeys();
        toast.success('API Key generated successfully');
      } else if (res.error) {
        toast.error('Failed to generate API key', res.error.message);
      }
    } catch (err) {
      console.error('Generate key error:', err);
      toast.error('Failed to generate API key');
    } finally {
      setGenerating(false);
    }
  };

  const handleRevokeKey = async (keyId: string) => {
    if (!publisherId) return;
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;

    try {
      const res = await apiClient.delete<{ success: boolean }>(
        `/api/v1/publishers/${publisherId}/keys/${keyId}`
      );
      if (res.data?.success) {
        toast.success('API Key revoked');
        void fetchKeys();
      } else {
        toast.error('Failed to revoke API key');
      }
    } catch (err) {
      console.error('Revoke key error:', err);
      toast.error('Failed to revoke API key');
    }
  };

  const handleCopyToClipboard = (text: string, type: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedTextType(type);
      setTimeout(() => setCopiedTextType(null), 2000);
      toast.success('Copied to clipboard');
    });
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">API Credentials</h1>
        <p className="text-sm text-ink-2">
          Manage API keys for ping/post traffic delivery and integration endpoints.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Keys List (left col) */}
        <div className="lg:col-span-2 space-y-6">
          <Card className="bg-surface border-rule backdrop-blur-xl">
            <CardHeader className="flex flex-row items-center justify-between border-b border-rule pb-4">
              <div>
                <CardTitle className="text-lg font-bold text-ink flex items-center gap-2">
                  <Key className="h-5 w-5 text-brand-ink" />
                  API Keys
                </CardTitle>
                <CardDescription className="text-xs text-ink-2 mt-1">
                  Active authentication tokens used for routing pings and posts.
                </CardDescription>
              </div>
              <Button
                onClick={() => setOpenGenDialog(true)}
                className="bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface font-semibold text-xs gap-1 h-9 px-3"
              >
                <Plus className="h-3.5 w-3.5" />
                Create Key
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {loadingKeys ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2">
                  <Loader2 className="h-8 w-8 animate-spin text-brand-ink" />
                  <span className="text-sm text-ink-3">Loading credentials...</span>
                </div>
              ) : keys.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-ink-3 px-4">
                  <Shield className="h-10 w-10 text-ink-3 mb-2" />
                  <p className="text-sm font-semibold text-ink-2">No active API keys</p>
                  <p className="text-xs text-ink-3 max-w-xs mt-1">
                    Generate an API key to start posting test pings or live traffic.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-rule">
                  {keys.map(k => (
                    <div
                      key={k.id}
                      className="p-4 flex items-center justify-between hover:bg-sunken transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm text-ink">{k.name}</span>
                          <span className="font-mono text-xs text-ink-2 bg-sunken border border-rule px-1.5 py-0.5 rounded">
                            {k.prefix}...
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
                          <span>Created: {new Date(k.createdAt).toLocaleDateString()}</span>
                          {k.expiresAt ? (
                            <span
                              className={
                                new Date(k.expiresAt) < new Date()
                                  ? 'text-dropped-ink font-medium'
                                  : ''
                              }
                            >
                              Expires: {new Date(k.expiresAt).toLocaleDateString()}
                            </span>
                          ) : (
                            <span>Never Expires</span>
                          )}
                          {k.lastUsedAt && (
                            <span>Last Used: {new Date(k.lastUsedAt).toLocaleString()}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRevokeKey(k.id)}
                          className="h-8 w-8 p-0 text-ink-2 hover:text-dropped-ink hover:bg-dropped-tint rounded-full"
                          title="Revoke Key"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Setup Instructions / Documentation (left col bottom) */}
          <Card className="bg-surface border-rule backdrop-blur-xl">
            <CardHeader className="border-b border-rule pb-4">
              <CardTitle className="text-lg font-bold text-ink flex items-center gap-2">
                <Code2 className="h-5 w-5 text-brand-ink" />
                Integration Snippets
              </CardTitle>
              <CardDescription className="text-xs text-ink-2">
                Use these structured requests to send lead pings and posts.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              {loadingDocs ? (
                <div className="flex items-center gap-2 py-4 justify-center">
                  <Loader2 className="h-5 w-5 animate-spin text-brand-ink" />
                  <span className="text-sm text-ink-3">Loading documentation...</span>
                </div>
              ) : !docs ? (
                <p className="text-sm text-ink-3">Documentation unavailable.</p>
              ) : (
                <div className="space-y-6">
                  {/* Ping Doc */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-ink-3" />
                        1. Lead Ping Request (Auction)
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyToClipboard(docs.docs.curlPing, 'ping')}
                        className="h-7 bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface text-xs gap-1"
                      >
                        {copiedTextType === 'ping' ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        Copy Curl
                      </Button>
                    </div>
                    <p className="text-xs text-ink-2">
                      Submit anonymized caller characteristics (e.g. ZIP code, state, age) to find
                      bidding buyers.
                    </p>
                    <pre className="bg-sunken border border-rule p-3 rounded-control overflow-x-auto text-xs font-mono text-ink">
                      <code>{docs.docs.curlPing}</code>
                    </pre>
                  </div>

                  {/* Post Doc */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-ink flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full bg-ink-3" />
                        2. Lead Post Request (DID lease)
                      </h3>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyToClipboard(docs.docs.curlPost, 'post')}
                        className="h-7 bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface text-xs gap-1"
                      >
                        {copiedTextType === 'post' ? (
                          <Check className="h-3 w-3" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        Copy Curl
                      </Button>
                    </div>
                    <p className="text-xs text-ink-2">
                      If the ping response yields a bid, post the bid token alongside the full
                      caller number to reserve the inbound DID.
                    </p>
                    <pre className="bg-sunken border border-rule p-3 rounded-control overflow-x-auto text-xs font-mono text-ink">
                      <code>{docs.docs.curlPost}</code>
                    </pre>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* API Endpoint Details (right sidebar col) */}
        <div className="space-y-6">
          <Card className="bg-surface border-rule backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-base font-bold text-ink flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-brand-ink" />
                Gateway URLs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {docs ? (
                <>
                  <div className="space-y-1">
                    <label className="text-xs text-ink-2 font-medium">Publisher Code</label>
                    <div className="bg-sunken border border-rule rounded-lg p-2.5 flex items-center justify-between">
                      <span className="font-mono text-xs text-ink">{docs.publisherCode}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-ink-2 font-medium">Ping URL</label>
                    <div className="bg-sunken border border-rule rounded-lg p-2.5 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-ink overflow-hidden text-ellipsis whitespace-nowrap mr-2">
                        {docs.pingEndpoint}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyToClipboard(docs.pingEndpoint, 'url-ping')}
                        className="h-7 w-7 p-0 flex-shrink-0"
                      >
                        {copiedTextType === 'url-ping' ? (
                          <Check className="h-3.5 w-3.5 text-brand-ink" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-ink-2 hover:text-brand-ink" />
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-ink-2 font-medium">Post URL</label>
                    <div className="bg-sunken border border-rule rounded-lg p-2.5 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-ink overflow-hidden text-ellipsis whitespace-nowrap mr-2">
                        {docs.postEndpoint}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopyToClipboard(docs.postEndpoint, 'url-post')}
                        className="h-7 w-7 p-0 flex-shrink-0"
                      >
                        {copiedTextType === 'url-post' ? (
                          <Check className="h-3.5 w-3.5 text-brand-ink" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-ink-2 hover:text-brand-ink" />
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="py-4 text-center text-ink-3 text-xs">
                  Gateway information loading...
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Generate API Key Dialog */}
      <Dialog open={openGenDialog} onOpenChange={setOpenGenDialog}>
        <DialogContent className="bg-surface border-rule text-ink max-w-md">
          <form onSubmit={handleGenerateKey}>
            <DialogHeader>
              <DialogTitle className="text-lg font-bold text-ink">Generate API Key</DialogTitle>
              <DialogDescription className="text-xs text-ink-2">
                Supply a friendly name to identify this credential and set an optional expiration
                date.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 my-4">
              <div className="space-y-1">
                <label className="text-xs text-ink-2 font-medium">Key Name</label>
                <Input
                  placeholder="e.g. Lead Portal Production"
                  value={keyName}
                  onChange={e => setKeyName(e.target.value)}
                  className="bg-surface border-rule text-ink focus:border-brand-ink placeholder:text-ink-3"
                  required
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-ink-2 font-medium">Expiration Period</label>
                <select
                  value={expiresDays}
                  onChange={e => setExpiresDays(e.target.value)}
                  className="w-full bg-surface border border-rule rounded-control p-2.5 text-sm text-ink focus:border-brand-ink outline-none"
                >
                  <option value="30">Expires in 30 days</option>
                  <option value="90">Expires in 90 days</option>
                  <option value="365">Expires in 1 year</option>
                  <option value="0">Never Expires</option>
                </select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpenGenDialog(false)}
                className="bg-surface border-rule text-ink hover:bg-sunken hover:text-ink"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={generating}
                className="bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface font-bold"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    Generating...
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Raw Key Result Dialog */}
      <Dialog open={openResultDialog} onOpenChange={setOpenResultDialog}>
        <DialogContent className="bg-surface border-rule text-ink max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-ink flex items-center gap-2">
              <Shield className="h-5 w-5 text-ringing-ink" />
              Store API Key Safely
            </DialogTitle>
            <DialogDescription className="text-xs text-ink-2">
              For security, this key is only displayed **once**. Copy it and store it in a secure
              password manager.
            </DialogDescription>
          </DialogHeader>

          <div className="my-4 space-y-4">
            <div className="bg-ringing-tint border border-ringing/40 rounded-lg p-3 text-xs text-ringing-ink">
              <strong>Warning:</strong> You will not be able to retrieve or view this raw key again
              after closing this window.
            </div>

            <div className="bg-sunken border border-rule rounded-control p-3 flex items-center justify-between">
              <span className="font-mono text-sm text-ink select-all overflow-x-auto whitespace-pre pr-4">
                {newRawKey}
              </span>
              <Button
                size="sm"
                onClick={() => handleCopyToClipboard(newRawKey, 'raw-key')}
                className="bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface shrink-0 font-medium"
              >
                {copiedTextType === 'raw-key' ? (
                  <Check className="h-4 w-4 mr-1.5" />
                ) : (
                  <Copy className="h-4 w-4 mr-1.5" />
                )}
                Copy
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setOpenResultDialog(false)}
              className="bg-surface border-rule text-ink hover:bg-sunken hover:text-ink w-full sm:w-auto"
            >
              I have stored it securely
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function GuardedPublisherApiSetupPage() {
  return (
    <RoleGuard allowedRoles={['PUBLISHER']}>
      <PublisherApiSetupPage />
    </RoleGuard>
  );
}
