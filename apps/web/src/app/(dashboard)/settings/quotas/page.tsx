'use client';

import { AlertCircle, CheckCircle2, DollarSign, Phone, Clock, HardDrive } from 'lucide-react';
import { useState, useEffect } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiClient } from '@/lib/api';

interface QuotaStatus {
  concurrentCalls: {
    current: number;
    limit: number | null;
    remaining: number | null;
  };
  dailyMinutes: {
    current: number;
    limit: number | null;
    remaining: number | null;
  };
  phoneNumbers: {
    current: number;
    limit: number | null;
    remaining: number | null;
  };
  budget: {
    daily: {
      current: number;
      limit: number | null;
      percentage: number | null;
    };
    monthly: {
      current: number;
      limit: number | null;
      percentage: number | null;
    };
  } | null;
}

export default function QuotasPage() {
  const [tenantId, setTenantId] = useState<string>('');
  const [quotaStatus, setQuotaStatus] = useState<QuotaStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Quota form state
  const [quota, setQuota] = useState({
    maxConcurrentCalls: '',
    maxMinutesPerDay: '',
    maxRecordingRetentionDays: '',
    maxPhoneNumbers: '',
    maxStorageGB: '',
    enabled: true,
  });

  // Budget form state
  const [budget, setBudget] = useState({
    monthlyBudget: '',
    dailyBudget: '',
    alertThreshold: '80',
    alertEmails: '',
    alertSlackWebhook: '',
    hardStopEnabled: true,
    enabled: true,
  });

  // Override token
  const [overrideToken, setOverrideToken] = useState<string | null>(null);
  const [tokenExpiresAt, setTokenExpiresAt] = useState<string | null>(null);

  useEffect(() => {
    // Load tenant ID from context or URL
    // For now, using a placeholder
    setTenantId('00000000-0000-0000-0000-000000000000');
  }, []);

  const loadQuotaStatus = async () => {
    if (!tenantId) return;

    try {
      setLoading(true);
      const response = await apiClient.get<QuotaStatus>(`/admin/api/v1/tenants/${tenantId}/quota/status`);
      if (response.data) {
        setQuotaStatus(response.data);
      } else if (response.error) {
        setError(response.error.message || 'Failed to load quota status');
      }
    } catch (err) {
      setError('Failed to load quota status');
    } finally {
      setLoading(false);
    }
  };

  const loadQuota = async () => {
    if (!tenantId) return;

    try {
      const response = await apiClient.get(`/admin/api/v1/tenants/${tenantId}/quota`);
      if (response.data) {
        setQuota({
          maxConcurrentCalls: response.data.maxConcurrentCalls?.toString() || '',
          maxMinutesPerDay: response.data.maxMinutesPerDay?.toString() || '',
          maxRecordingRetentionDays: response.data.maxRecordingRetentionDays?.toString() || '',
          maxPhoneNumbers: response.data.maxPhoneNumbers?.toString() || '',
          maxStorageGB: response.data.maxStorageGB?.toString() || '',
          enabled: response.data.enabled ?? true,
        });
      }
    } catch (err) {
      // Quota doesn't exist yet, that's okay
    }
  };

  const loadBudget = async () => {
    if (!tenantId) return;

    try {
      const response = await apiClient.get(`/admin/api/v1/tenants/${tenantId}/budget`);
      if (response.data) {
        setBudget({
          monthlyBudget: response.data.monthlyBudget?.toString() || '',
          dailyBudget: response.data.dailyBudget?.toString() || '',
          alertThreshold: response.data.alertThreshold?.toString() || '80',
          alertEmails: response.data.alertEmails?.join(', ') || '',
          alertSlackWebhook: response.data.alertSlackWebhook || '',
          hardStopEnabled: response.data.hardStopEnabled ?? true,
          enabled: response.data.enabled ?? true,
        });
      }
    } catch (err) {
      // Budget doesn't exist yet, that's okay
    }
  };

  useEffect(() => {
    if (tenantId) {
      loadQuotaStatus();
      loadQuota();
      loadBudget();
    }
  }, [tenantId]);

  const saveQuota = async () => {
    if (!tenantId) return;

    try {
      setLoading(true);
      setError(null);
      await apiClient.patch(`/admin/api/v1/tenants/${tenantId}/quota`, {
        maxConcurrentCalls: quota.maxConcurrentCalls ? parseInt(quota.maxConcurrentCalls) : null,
        maxMinutesPerDay: quota.maxMinutesPerDay ? parseInt(quota.maxMinutesPerDay) : null,
        maxRecordingRetentionDays: quota.maxRecordingRetentionDays ? parseInt(quota.maxRecordingRetentionDays) : null,
        maxPhoneNumbers: quota.maxPhoneNumbers ? parseInt(quota.maxPhoneNumbers) : null,
        maxStorageGB: quota.maxStorageGB ? parseFloat(quota.maxStorageGB) : null,
        enabled: quota.enabled,
      });
      setSuccess('Quota settings saved');
      loadQuotaStatus();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to save quota settings');
    } finally {
      setLoading(false);
    }
  };

  const saveBudget = async () => {
    if (!tenantId) return;

    try {
      setLoading(true);
      setError(null);
      await apiClient.patch(`/admin/api/v1/tenants/${tenantId}/budget`, {
        monthlyBudget: budget.monthlyBudget ? parseFloat(budget.monthlyBudget) : null,
        dailyBudget: budget.dailyBudget ? parseFloat(budget.dailyBudget) : null,
        alertThreshold: parseFloat(budget.alertThreshold),
        alertEmails: budget.alertEmails.split(',').map(e => e.trim()).filter(Boolean),
        alertSlackWebhook: budget.alertSlackWebhook || null,
        hardStopEnabled: budget.hardStopEnabled,
        enabled: budget.enabled,
      });
      setSuccess('Budget settings saved');
      loadQuotaStatus();
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to save budget settings');
    } finally {
      setLoading(false);
    }
  };

  const generateOverrideToken = async () => {
    if (!tenantId) return;

    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.post<{ token: string; expiresAt: string; expiresInHours: number }>(
        `/admin/api/v1/tenants/${tenantId}/budget/override-token`,
        { expiresInHours: 24 }
      );
      setOverrideToken(response.token);
      setTokenExpiresAt(response.expiresAt);
      setSuccess('Override token generated');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to generate override token');
    } finally {
      setLoading(false);
    }
  };

  const revokeOverrideToken = async () => {
    if (!tenantId) return;

    try {
      setLoading(true);
      setError(null);
      await apiClient.delete(`/admin/api/v1/tenants/${tenantId}/budget/override-token`);
      setOverrideToken(null);
      setTokenExpiresAt(null);
      setSuccess('Override token revoked');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError('Failed to revoke override token');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 mb-2">
        <h1 className="text-xl font-bold">Quotas & Budgets</h1>
        <p className="text-sm text-muted-foreground">Manage tenant quotas and budget controls</p>
      </div>

      {error && (
        <Alert variant="destructive" className="flex-shrink-0 mb-2 py-2">
          <AlertCircle className="h-3 w-3" />
          <AlertDescription className="text-sm">{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="flex-shrink-0 mb-2 py-2">
          <CheckCircle2 className="h-3 w-3" />
          <AlertDescription className="text-sm">{success}</AlertDescription>
        </Alert>
      )}

      {/* Quota Status Dashboard */}
      {quotaStatus && quotaStatus.concurrentCalls && (
        <Card className="flex-shrink-0 mb-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Current Usage</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">Concurrent Calls</span>
                </div>
                <div className="text-lg font-bold">
                  {quotaStatus.concurrentCalls.current ?? 0}
                  {quotaStatus.concurrentCalls.limit && ` / ${quotaStatus.concurrentCalls.limit}`}
                </div>
                {quotaStatus.concurrentCalls.remaining !== null && (
                  <div className="text-xs text-muted-foreground">
                    {quotaStatus.concurrentCalls.remaining} remaining
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">Daily Minutes</span>
                </div>
                <div className="text-lg font-bold">
                  {quotaStatus.dailyMinutes?.current ?? 0}
                  {quotaStatus.dailyMinutes?.limit && ` / ${quotaStatus.dailyMinutes.limit}`}
                </div>
                {quotaStatus.dailyMinutes?.remaining !== null && (
                  <div className="text-xs text-muted-foreground">
                    {quotaStatus.dailyMinutes.remaining} remaining
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs font-medium">Phone Numbers</span>
                </div>
                <div className="text-lg font-bold">
                  {quotaStatus.phoneNumbers?.current ?? 0}
                  {quotaStatus.phoneNumbers?.limit && ` / ${quotaStatus.phoneNumbers.limit}`}
                </div>
                {quotaStatus.phoneNumbers?.remaining !== null && (
                  <div className="text-xs text-muted-foreground">
                    {quotaStatus.phoneNumbers.remaining} remaining
                  </div>
                )}
              </div>

              {quotaStatus.budget && (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5">
                    <DollarSign className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium">Monthly Budget</span>
                  </div>
                  <div className="text-lg font-bold">
                    ${(quotaStatus.budget.monthly?.current ?? 0).toFixed(2)}
                    {quotaStatus.budget.monthly?.limit && ` / $${quotaStatus.budget.monthly.limit.toFixed(2)}`}
                  </div>
                  {quotaStatus.budget.monthly?.percentage !== null && (
                    <div className="text-xs text-muted-foreground">
                      {quotaStatus.budget.monthly.percentage.toFixed(1)}% used
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="quotas" className="flex-1 flex flex-col overflow-hidden min-h-0">
        <TabsList className="flex-shrink-0 h-9">
          <TabsTrigger value="quotas" className="text-sm">Quotas</TabsTrigger>
          <TabsTrigger value="budget" className="text-sm">Budget</TabsTrigger>
          <TabsTrigger value="overrides" className="text-sm">Overrides</TabsTrigger>
        </TabsList>

        <TabsContent value="quotas" className="flex-1 overflow-y-auto min-h-0 mt-2">
          <Card className="h-full flex flex-col overflow-hidden">
            <CardHeader className="pb-2 flex-shrink-0">
              <CardTitle className="text-base">Quota Settings</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-3 pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Enable Quotas</Label>
                </div>
                <Switch
                  checked={quota.enabled}
                  onCheckedChange={(checked) => setQuota({ ...quota, enabled: checked })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="maxConcurrentCalls" className="text-sm">Max Concurrent Calls</Label>
                  <Input
                    id="maxConcurrentCalls"
                    type="number"
                    value={quota.maxConcurrentCalls}
                    onChange={(e) => setQuota({ ...quota, maxConcurrentCalls: e.target.value })}
                    placeholder="Unlimited"
                    className="h-8"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="maxMinutesPerDay" className="text-sm">Max Minutes Per Day</Label>
                  <Input
                    id="maxMinutesPerDay"
                    type="number"
                    value={quota.maxMinutesPerDay}
                    onChange={(e) => setQuota({ ...quota, maxMinutesPerDay: e.target.value })}
                    placeholder="Unlimited"
                    className="h-8"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="maxPhoneNumbers" className="text-sm">Max Phone Numbers</Label>
                  <Input
                    id="maxPhoneNumbers"
                    type="number"
                    value={quota.maxPhoneNumbers}
                    onChange={(e) => setQuota({ ...quota, maxPhoneNumbers: e.target.value })}
                    placeholder="Unlimited"
                    className="h-8"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="maxRecordingRetentionDays" className="text-sm">Max Recording Retention (Days)</Label>
                  <Input
                    id="maxRecordingRetentionDays"
                    type="number"
                    value={quota.maxRecordingRetentionDays}
                    onChange={(e) => setQuota({ ...quota, maxRecordingRetentionDays: e.target.value })}
                    placeholder="Unlimited"
                    className="h-8"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="maxStorageGB" className="text-sm">Max Storage (GB)</Label>
                  <Input
                    id="maxStorageGB"
                    type="number"
                    step="0.01"
                    value={quota.maxStorageGB}
                    onChange={(e) => setQuota({ ...quota, maxStorageGB: e.target.value })}
                    placeholder="Unlimited"
                    className="h-8"
                  />
                </div>
              </div>

              <Button onClick={saveQuota} disabled={loading} size="sm" className="mt-2">
                Save Quota Settings
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="budget" className="flex-1 overflow-y-auto min-h-0 mt-2">
          <Card className="h-full flex flex-col overflow-hidden">
            <CardHeader className="pb-2 flex-shrink-0">
              <CardTitle className="text-base">Budget Settings</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto space-y-3 pt-0">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Enable Budget</Label>
                </div>
                <Switch
                  checked={budget.enabled}
                  onCheckedChange={(checked) => setBudget({ ...budget, enabled: checked })}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="monthlyBudget" className="text-sm">Monthly Budget ($)</Label>
                  <Input
                    id="monthlyBudget"
                    type="number"
                    step="0.01"
                    value={budget.monthlyBudget}
                    onChange={(e) => setBudget({ ...budget, monthlyBudget: e.target.value })}
                    placeholder="Unlimited"
                    className="h-8"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="dailyBudget" className="text-sm">Daily Budget ($)</Label>
                  <Input
                    id="dailyBudget"
                    type="number"
                    step="0.01"
                    value={budget.dailyBudget}
                    onChange={(e) => setBudget({ ...budget, dailyBudget: e.target.value })}
                    placeholder="Unlimited"
                    className="h-8"
                  />
                </div>

                <div className="space-y-1">
                  <Label htmlFor="alertThreshold" className="text-sm">Alert Threshold (%)</Label>
                  <Input
                    id="alertThreshold"
                    type="number"
                    value={budget.alertThreshold}
                    onChange={(e) => setBudget({ ...budget, alertThreshold: e.target.value })}
                    placeholder="80"
                    className="h-8"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="alertEmails" className="text-sm">Alert Email Addresses</Label>
                <Input
                  id="alertEmails"
                  value={budget.alertEmails}
                  onChange={(e) => setBudget({ ...budget, alertEmails: e.target.value })}
                  placeholder="admin@example.com, finance@example.com"
                  className="h-8"
                />
              </div>

              <div className="space-y-1">
                <Label htmlFor="alertSlackWebhook" className="text-sm">Slack Webhook URL</Label>
                <Input
                  id="alertSlackWebhook"
                  value={budget.alertSlackWebhook}
                  onChange={(e) => setBudget({ ...budget, alertSlackWebhook: e.target.value })}
                  placeholder="https://hooks.slack.com/services/..."
                  className="h-8"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Hard Stop Enabled</Label>
                </div>
                <Switch
                  checked={budget.hardStopEnabled}
                  onCheckedChange={(checked) => setBudget({ ...budget, hardStopEnabled: checked })}
                />
              </div>

              <Button onClick={saveBudget} disabled={loading} size="sm" className="mt-2">
                Save Budget Settings
              </Button>
            </CardContent>
          </Card>

          {/* Override Token */}
          <Card className="mt-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Override Token</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {overrideToken ? (
                <div className="space-y-2">
                  <Alert className="py-2">
                    <AlertDescription className="text-sm">
                      <div className="font-mono text-xs break-all">{overrideToken}</div>
                      {tokenExpiresAt && (
                        <div className="text-xs text-muted-foreground mt-1">
                          Expires: {new Date(tokenExpiresAt).toLocaleString()}
                        </div>
                      )}
                    </AlertDescription>
                  </Alert>
                  <p className="text-xs text-muted-foreground">
                    Use this token in the <code className="text-xs">X-Quota-Override</code> header to bypass quota limits.
                  </p>
                  <Button variant="destructive" onClick={revokeOverrideToken} disabled={loading} size="sm">
                    Revoke Token
                  </Button>
                </div>
              ) : (
                <Button onClick={generateOverrideToken} disabled={loading} size="sm">
                  Generate Override Token
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overrides" className="flex-1 overflow-y-auto min-h-0 mt-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Quota Overrides</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground">
                Quota overrides allow temporarily increasing limits for specific quota types.
                Use the API to create overrides programmatically.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

