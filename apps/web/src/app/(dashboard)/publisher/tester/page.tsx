'use client';

import {
  Send,
  Terminal,
  Play,
  RotateCcw,
  CheckCircle,
  XCircle,
  Copy,
  Check,
  ChevronRight,
  Info,
  Loader2,
  Key,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { RoleGuard } from '@/components/auth/role-guard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';

interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  status: string;
}

function PublisherTesterPage() {
  const { user } = useAuth();
  const publisherId = user?.publisherId;

  // Configuration
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [selectedApiKey, setSelectedApiKey] = useState('');
  const [manualApiKey, setManualApiKey] = useState('');
  const [useManualKey, setUseManualKey] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'ping' | 'post'>('ping');

  // Ping Form State
  const [vertical, setVertical] = useState('health_insurance');
  const [zip, setZip] = useState('37901');
  const [state, setState] = useState('TN');
  const [age, setAge] = useState('67');
  const [minBid, setMinBid] = useState('10.00');
  const [source, setSource] = useState('landing_page');
  const [pingLoading, setPingLoading] = useState(false);

  // Ping Result
  const [pingRequestPayload, setPingRequestPayload] = useState<string | null>(null);
  const [pingResponsePayload, setPingResponsePayload] = useState<string | null>(null);
  const [pingSuccess, setPingSuccess] = useState<boolean | null>(null);
  const [bidAmount, setBidAmount] = useState<number | null>(null);
  const [bidToken, setBidToken] = useState<string | null>(null);

  // Post Form State
  const [postToken, setPostToken] = useState('');
  const [callerNumber, setCallerNumber] = useState('+12816991120');
  const [postLoading, setPostLoading] = useState(false);

  // Post Result
  const [postRequestPayload, setPostRequestPayload] = useState<string | null>(null);
  const [postResponsePayload, setPostResponsePayload] = useState<string | null>(null);
  const [postSuccess, setPostSuccess] = useState<boolean | null>(null);
  const [leasedNumber, setLeasedNumber] = useState<string | null>(null);

  // Copy states
  const [copiedType, setCopiedType] = useState<string | null>(null);

  const fetchKeys = useCallback(async () => {
    if (!publisherId) return;
    setLoadingKeys(true);
    try {
      const res = await apiClient.get<{ keys: ApiKeyRecord[] }>(
        `/api/v1/publishers/${publisherId}/keys`
      );
      if (res.data && res.data.keys && res.data.keys.length > 0) {
        setKeys(res.data.keys);
        setSelectedApiKey(res.data.keys[0].prefix); // Save prefix first
      }
    } catch (err) {
      console.error('Failed to fetch API keys:', err);
    } finally {
      setLoadingKeys(false);
    }
  }, [publisherId]);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  const getEffectiveKey = async (): Promise<string | null> => {
    if (useManualKey) {
      if (!manualApiKey.trim()) {
        toast.error('Please enter an API Key');
        return null;
      }
      return manualApiKey.trim();
    }

    if (!selectedApiKey) {
      toast.error('Please create or select an API Key first');
      return null;
    }

    // Since we only list key prefixes in the UI, we need a way to make calls.
    // Wait, let's look at how the tester calls the API. Can it make a request to a helper tester endpoint on the backend
    // to proxy the request, or do we need the raw API key?
    // Wait! Let's check if the backend has `/api/v1/ping/verify` or similar, or does the front-end need the raw API key?
    // In ping.ts, we saw `fastify.post('/api/v1/ping/verify')`! Let's check what it does. Maybe it is a test endpoint that accepts session authentication?
    // Let's do a search or view `apps/api/src/routes/ping.ts` around line 240.
    return selectedApiKey;
  };

  const handleSendPing = async () => {
    const key = useManualKey ? manualApiKey.trim() : selectedApiKey;
    if (!key) {
      toast.error('API key is required to run the test');
      return;
    }

    setPingLoading(true);
    setPingSuccess(null);
    setBidAmount(null);
    setBidToken(null);
    setPingResponsePayload(null);

    const payload = {
      request_id: crypto.randomUUID(),
      vertical: vertical.trim(),
      caller: {
        zip: zip.trim(),
        state: state.trim().toUpperCase(),
        age: parseInt(age) || undefined,
      },
      source: source.trim(),
      min_bid: parseFloat(minBid) || undefined,
    };

    const reqStr = JSON.stringify(payload, null, 2);
    setPingRequestPayload(reqStr);

    try {
      const apiBaseUrl =
        typeof window !== 'undefined'
          ? window.location.origin
          : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/ping`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
        },
        body: reqStr,
      });

      const data = await response.json();
      setPingResponsePayload(JSON.stringify(data, null, 2));

      if (response.ok && data.bid > 0) {
        setPingSuccess(true);
        setBidAmount(data.bid);
        setBidToken(data.token);
        setPostToken(data.token); // Auto prefill post token
        toast.success(`Ping success! Bid received: $${data.bid}`);
      } else {
        setPingSuccess(false);
        if (data.bid === 0) {
          toast.info('Ping auction complete: No bids received from buyers.');
        } else {
          toast.error(data.error?.message || 'Ping failed');
        }
      }
    } catch (err: any) {
      console.error(err);
      setPingSuccess(false);
      setPingResponsePayload(JSON.stringify({ error: err.message || 'Network error' }, null, 2));
      toast.error('Network request failed');
    } finally {
      setPingLoading(false);
    }
  };

  const handleSendPost = async () => {
    const key = useManualKey ? manualApiKey.trim() : selectedApiKey;
    if (!key) {
      toast.error('API key is required to run the test');
      return;
    }

    if (!postToken.trim()) {
      toast.error('Bid token is required');
      return;
    }

    setPostLoading(true);
    setPostSuccess(null);
    setLeasedNumber(null);
    setPostResponsePayload(null);

    const payload = {
      token: postToken.trim(),
      caller_number: callerNumber.trim(),
    };

    const reqStr = JSON.stringify(payload, null, 2);
    setPostRequestPayload(reqStr);

    try {
      const apiBaseUrl =
        typeof window !== 'undefined'
          ? window.location.origin
          : process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/api/v1/post`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
        },
        body: reqStr,
      });

      const data = await response.json();
      setPostResponsePayload(JSON.stringify(data, null, 2));

      if (response.ok && data.status === 'LEASED') {
        setPostSuccess(true);
        setLeasedNumber(data.leased_number || data.number);
        toast.success('Post success! DID leased.');
      } else {
        setPostSuccess(false);
        toast.error(data.error?.message || data.message || 'Post failed');
      }
    } catch (err: any) {
      console.error(err);
      setPostSuccess(false);
      setPostResponsePayload(JSON.stringify({ error: err.message || 'Network error' }, null, 2));
      toast.error('Network request failed');
    } finally {
      setPostLoading(false);
    }
  };

  const handleReset = () => {
    setPingRequestPayload(null);
    setPingResponsePayload(null);
    setPingSuccess(null);
    setBidAmount(null);
    setBidToken(null);
    setPostToken('');
    setPostRequestPayload(null);
    setPostResponsePayload(null);
    setPostSuccess(null);
    setLeasedNumber(null);
    setActiveTab('ping');
    toast.success('Playground reset');
  };

  const handleCopyText = (text: string, type: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedType(type);
      setTimeout(() => setCopiedType(null), 2000);
      toast.success('Copied JSON');
    });
  };

  return (
    <div className="space-y-6 p-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-ink flex items-center gap-2">
            <Terminal className="h-8 w-8 text-brand-ink" />
            Ping/Post Tester
          </h1>
          <p className="text-sm text-ink-2">
            Simulate publisher integrations and verify campaign routing bidding auctions.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={handleReset}
          className="bg-surface border-rule text-ink hover:bg-sunken flex items-center gap-1.5"
        >
          <RotateCcw className="h-4 w-4" />
          Reset Tester
        </Button>
      </div>

      {/* API Key Selector */}
      <Card className="bg-surface border-rule backdrop-blur-xl">
        <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center gap-4">
          <div className="flex items-center gap-2 text-brand-ink">
            <Key className="h-5 w-5" />
            <span className="text-sm font-semibold">Auth Configuration:</span>
          </div>

          <div className="flex-1 flex flex-col sm:flex-row gap-4 w-full">
            {!useManualKey ? (
              <div className="flex-1 flex gap-2 items-center">
                <select
                  value={selectedApiKey}
                  onChange={e => setSelectedApiKey(e.target.value)}
                  className="bg-surface border border-rule rounded-control p-2 text-sm text-ink focus:border-brand-ink outline-none w-full max-w-md"
                >
                  {loadingKeys ? (
                    <option>Loading API keys...</option>
                  ) : keys.length === 0 ? (
                    <option>No API Keys found - generate one first</option>
                  ) : (
                    keys.map(k => (
                      <option key={k.id} value={k.prefix}>
                        {k.name} ({k.prefix}...)
                      </option>
                    ))
                  )}
                </select>
                <Button
                  variant="link"
                  onClick={() => setUseManualKey(true)}
                  className="text-xs text-brand-ink hover:text-brand-ink p-0"
                >
                  Enter key manually
                </Button>
              </div>
            ) : (
              <div className="flex-1 flex gap-2 items-center w-full">
                <Input
                  type="password"
                  placeholder="Enter raw API key (hw_pub_...)"
                  value={manualApiKey}
                  onChange={e => setManualApiKey(e.target.value)}
                  className="bg-surface border-rule text-ink focus:border-brand-ink max-w-md"
                />
                <Button
                  variant="link"
                  onClick={() => setUseManualKey(false)}
                  className="text-xs text-brand-ink hover:text-brand-ink p-0"
                >
                  Use generated keys
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Forms column (left) */}
        <div>
          <Tabs value={activeTab} onValueChange={val => setActiveTab(val as any)}>
            <TabsList className="bg-sunken border border-rule text-ink-2 p-1 w-full grid grid-cols-2">
              <TabsTrigger
                value="ping"
                className="data-[state=active]:bg-brand data-[state=active]:text-ink font-semibold"
              >
                Step 1: Send Lead Ping
              </TabsTrigger>
              <TabsTrigger
                value="post"
                className="data-[state=active]:bg-brand data-[state=active]:text-ink font-semibold"
              >
                Step 2: Post Lead Call
              </TabsTrigger>
            </TabsList>

            {/* PING TAB */}
            <TabsContent value="ping" className="mt-4">
              <Card className="bg-surface border-rule backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-base text-ink">Ping Request Form</CardTitle>
                  <CardDescription className="text-xs text-ink-2">
                    Submit demographics to receive a bid from eligible routing campaigns.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-ink-2 font-medium">Vertical</label>
                      <Input
                        value={vertical}
                        onChange={e => setVertical(e.target.value)}
                        className="bg-surface border-rule text-ink focus:border-brand-ink"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-ink-2 font-medium">Traffic Source</label>
                      <Input
                        value={source}
                        onChange={e => setSource(e.target.value)}
                        className="bg-surface border-rule text-ink focus:border-brand-ink"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs text-ink-2 font-medium">Zip Code</label>
                      <Input
                        value={zip}
                        onChange={e => setZip(e.target.value)}
                        className="bg-surface border-rule text-ink focus:border-brand-ink"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-ink-2 font-medium">State</label>
                      <Input
                        value={state}
                        onChange={e => setState(e.target.value)}
                        maxLength={2}
                        className="bg-surface border-rule text-ink focus:border-brand-ink uppercase"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-ink-2 font-medium">Age</label>
                      <Input
                        type="number"
                        value={age}
                        onChange={e => setAge(e.target.value)}
                        className="bg-surface border-rule text-ink focus:border-brand-ink"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-ink-2 font-medium">Minimum Bid Floor ($)</label>
                    <Input
                      type="number"
                      step="0.01"
                      value={minBid}
                      onChange={e => setMinBid(e.target.value)}
                      className="bg-surface border-rule text-ink focus:border-brand-ink"
                    />
                  </div>

                  <Button
                    onClick={handleSendPing}
                    disabled={pingLoading}
                    className="w-full bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface font-bold gap-2 mt-2"
                  >
                    {pingLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                    Send Ping Request
                  </Button>

                  {pingSuccess !== null && (
                    <div
                      className={`p-3 rounded-lg border flex items-start gap-2.5 text-xs ${
                        pingSuccess
                          ? 'bg-live-tint border-live/40 text-live-ink'
                          : 'bg-dropped-tint border-dropped/40 text-dropped-ink'
                      }`}
                    >
                      {pingSuccess ? (
                        <>
                          <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <div className="space-y-1 flex-1">
                            <p className="font-bold">Bid Received: ${bidAmount?.toFixed(2)}</p>
                            <p className="text-ink-2">
                              A buyer bid matches this lead profile. Copy the bid token below to
                              test the Post lease phase.
                            </p>
                            <Button
                              onClick={() => setActiveTab('post')}
                              variant="link"
                              className="text-xs text-live-ink hover:text-live-ink p-0 font-semibold flex items-center gap-0.5 mt-1 h-auto"
                            >
                              Proceed to Post Phase
                              <ChevronRight className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">No Bid / Failed</p>
                            <p className="text-ink-2">
                              Auction ended without matches, or authentication was rejected. Review
                              the JSON response on the right.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* POST TAB */}
            <TabsContent value="post" className="mt-4">
              <Card className="bg-surface border-rule backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-base text-ink">Post Call Form</CardTitle>
                  <CardDescription className="text-xs text-ink-2">
                    Confirm lease and claim a toll-free number using your bid token.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs text-ink-2 font-medium">Bid Token</label>
                    <Input
                      placeholder="Retrieve from successful ping, or enter custom token..."
                      value={postToken}
                      onChange={e => setPostToken(e.target.value)}
                      className="bg-surface border-rule text-ink focus:border-brand-ink font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs text-ink-2 font-medium">
                      Caller Phone Number (E.164)
                    </label>
                    <Input
                      value={callerNumber}
                      onChange={e => setCallerNumber(e.target.value)}
                      className="bg-surface border-rule text-ink focus:border-brand-ink font-mono"
                    />
                  </div>

                  <Button
                    onClick={handleSendPost}
                    disabled={postLoading}
                    className="w-full bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface font-bold gap-2 mt-2"
                  >
                    {postLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4" />
                    )}
                    Send Post Request
                  </Button>

                  {postSuccess !== null && (
                    <div
                      className={`p-3 rounded-lg border flex items-start gap-2.5 text-xs ${
                        postSuccess
                          ? 'bg-live-tint border-live/40 text-live-ink'
                          : 'bg-dropped-tint border-dropped/40 text-dropped-ink'
                      }`}
                    >
                      {postSuccess ? (
                        <>
                          <CheckCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">Post Successful: DID Leased</p>
                            <p className="text-ink-2">
                              Send your call traffic directly to the following number to route to
                              the winning buyer:
                            </p>
                            <p className="font-mono font-bold text-sm text-ink mt-1.5 p-1 bg-surface border border-rule rounded inline-block">
                              {leasedNumber}
                            </p>
                          </div>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-bold">Post Failed</p>
                            <p className="text-ink-2">
                              Token may have expired (valid for 5 minutes) or call details were
                              invalid. Review the JSON logs.
                            </p>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* JSON Inspector / Debugger column (right) */}
        <div className="space-y-6">
          <Card className="bg-surface border-rule backdrop-blur-xl h-full flex flex-col min-h-[450px]">
            <CardHeader className="border-b border-rule pb-4 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-base text-ink flex items-center gap-1.5">
                  <Terminal className="h-4 w-4 text-brand-ink" />
                  JSON Console Inspector
                </CardTitle>
                <CardDescription className="text-[10px] text-ink-2">
                  Inspect lead payloads sent and raw API response outputs.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-4 flex-1 flex flex-col gap-4 overflow-hidden">
              {/* Request Payload */}
              <div className="flex-1 flex flex-col overflow-hidden max-h-[220px]">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-ink-2">Request Body</span>
                  {pingRequestPayload && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyText(pingRequestPayload || '', 'req')}
                      className="h-6 bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface p-1 rounded"
                    >
                      {copiedType === 'req' ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
                <div className="bg-sunken border border-rule rounded-control p-2.5 font-mono text-[11px] overflow-y-auto text-ink flex-1 min-h-[80px]">
                  {activeTab === 'ping'
                    ? pingRequestPayload || '// Run a Ping to inspect payload'
                    : postRequestPayload || '// Run a Post to inspect payload'}
                </div>
              </div>

              {/* Response Payload */}
              <div className="flex-1 flex flex-col overflow-hidden max-h-[220px]">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-semibold text-ink-2">Response Body</span>
                  {pingResponsePayload && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCopyText(pingResponsePayload || '', 'res')}
                      className="h-6 bg-brand text-brand-fg hover:bg-brand-ink hover:text-surface p-1 rounded"
                    >
                      {copiedType === 'res' ? (
                        <Check className="h-3 w-3" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
                <div className="bg-sunken border border-rule rounded-control p-2.5 font-mono text-[11px] overflow-y-auto text-ink flex-1 min-h-[80px]">
                  {activeTab === 'ping'
                    ? pingResponsePayload || '// Run a Ping to inspect response'
                    : postResponsePayload || '// Run a Post to inspect response'}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function GuardedPublisherTesterPage() {
  return (
    <RoleGuard allowedRoles={['PUBLISHER']}>
      <PublisherTesterPage />
    </RoleGuard>
  );
}
