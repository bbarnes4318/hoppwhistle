'use client';

import {
  Activity,
  Globe,
  Loader2,
  Lock,
  Pause,
  Play,
  Settings,
  Shield,
  Sliders,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api';
import { formatPhoneNumber } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { RoleGuard } from '@/components/auth/role-guard';

interface BuyerProfile {
  id: string;
  name: string;
  canPauseTargets: boolean;
  canSetCaps: boolean;
}

interface Target {
  id: string;
  buyerId: string;
  name: string;
  type: 'SIP' | 'PSTN' | 'WEBRTC';
  destination: string;
  priority: number;
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED';
  maxCap: number;
  capPeriod: 'HOUR' | 'DAY' | 'MONTH';
  maxConcurrency: number;
  weight: number;
  isNational: boolean;
  acceptedStates: string[];
}

function BuyerTargetsPage() {
  const { buyerId } = useAuth();

  const [profile, setProfile] = useState<BuyerProfile | null>(null);
  const [targets, setTargets] = useState<Target[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Cap Dialog State
  const [capDialogOpen, setCapDialogOpen] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);
  const [newMaxCap, setNewMaxCap] = useState<number>(0);
  const [newMaxConcurrency, setNewMaxConcurrency] = useState<number>(0);
  const [updating, setUpdating] = useState(false);

  const loadData = useCallback(async () => {
    if (!buyerId) return;
    setLoading(true);
    try {
      // 1. Fetch Profile
      const profileRes = await apiClient.get<BuyerProfile>(`/api/v1/buyers/${buyerId}`);
      if (profileRes.data) setProfile(profileRes.data);

      // 2. Fetch Targets
      const targetsRes = await apiClient.get<{ data: Target[] }>(
        `/api/v1/buyers/${buyerId}/targets`
      );
      if (targetsRes.data?.data) {
        setTargets(targetsRes.data.data);
      }
    } catch (err) {
      console.error('Failed to load targets data:', err);
      toast.error('Failed to load targets');
    } finally {
      setLoading(false);
    }
  }, [buyerId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleStatusToggle = async (target: Target) => {
    if (!profile?.canPauseTargets) {
      toast.error('You do not have permission to pause targets. Please contact support.');
      return;
    }

    const nextStatus = target.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await apiClient.patch(`/api/v1/buyers/${buyerId}/targets/${target.id}`, {
        status: nextStatus,
      });
      toast.success(`Target "${target.name}" is now ${nextStatus === 'ACTIVE' ? 'Active' : 'Paused'}`);
      setTargets(prev => prev.map(t => t.id === target.id ? { ...t, status: nextStatus } : t));
    } catch (err) {
      console.error('Failed to toggle status:', err);
      toast.error('Failed to update target status');
    }
  };

  const handleOpenCapDialog = (target: Target) => {
    if (!profile?.canSetCaps) {
      toast.error('You do not have permission to adjust caps. Please contact support.');
      return;
    }
    setSelectedTarget(target);
    setNewMaxCap(target.maxCap);
    setNewMaxConcurrency(target.maxConcurrency);
    setCapDialogOpen(true);
  };

  const handleSaveCaps = async () => {
    if (!buyerId || !selectedTarget) return;
    setUpdating(true);
    try {
      await apiClient.patch(`/api/v1/buyers/${buyerId}/targets/${selectedTarget.id}`, {
        maxCap: newMaxCap,
        maxConcurrency: newMaxConcurrency,
      });
      toast.success(`Limits updated for "${selectedTarget.name}"`);
      setTargets(prev =>
        prev.map(t =>
          t.id === selectedTarget.id
            ? { ...t, maxCap: newMaxCap, maxConcurrency: newMaxConcurrency }
            : t
        )
      );
      setCapDialogOpen(false);
    } catch (err) {
      console.error('Failed to update caps:', err);
      toast.error('Failed to update target limits');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between border-b pb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Target Endpoints</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your call receiving targets, concurrent channels, and daily caps.
          </p>
        </div>
        <Button onClick={loadData} variant="outline" size="sm">
          Refresh
        </Button>
      </div>

      {/* Permissions Indicator */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className={`p-2 rounded-lg ${profile?.canPauseTargets ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-500'}`}>
              {profile?.canPauseTargets ? <Sliders className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            </div>
            <div>
              <div className="text-sm font-semibold">Status Control</div>
              <div className="text-xs text-muted-foreground">
                {profile?.canPauseTargets
                  ? 'Allowed to pause/resume call routing to your targets.'
                  : 'Target pause control is disabled. Contact your account representative to enable.'}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="flex items-center gap-3 pt-6">
            <div className={`p-2 rounded-lg ${profile?.canSetCaps ? 'bg-emerald-500/10 text-emerald-400' : 'bg-yellow-500/10 text-yellow-500'}`}>
              {profile?.canSetCaps ? <Activity className="h-5 w-5" /> : <Lock className="h-5 w-5" />}
            </div>
            <div>
              <div className="text-sm font-semibold">Cap Management</div>
              <div className="text-xs text-muted-foreground">
                {profile?.canSetCaps
                  ? 'Allowed to modify daily routing caps and concurrency limits.'
                  : 'Capacity control is read-only. Contact support to request cap adjustments.'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Targets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {loading ? (
          <div className="col-span-full py-20 text-center">
            <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
            <p className="mt-2 text-sm text-muted-foreground">Loading target endpoints...</p>
          </div>
        ) : targets.length === 0 ? (
          <div className="col-span-full py-20 text-center border rounded-xl border-dashed">
            <p className="text-sm text-muted-foreground">No targets configured for your account.</p>
          </div>
        ) : (
          targets.map(target => (
            <Card key={target.id} className="bg-card border-border relative overflow-hidden">
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div>
                    <CardTitle className="text-lg font-bold text-slate-100">{target.name}</CardTitle>
                    <CardDescription className="text-xs font-mono mt-1 text-muted-foreground">
                      Destination: {formatPhoneNumber(target.destination)} ({target.type})
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={target.status === 'ACTIVE' ? 'success' : 'outline'} className="text-xs font-semibold">
                      {target.status === 'ACTIVE' ? 'Active' : 'Paused'}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/15 p-3 font-mono text-xs">
                  <div>
                    <span className="text-muted-foreground uppercase block text-[10px] tracking-wider mb-1">Priority</span>
                    <span className="text-slate-100 font-bold">{target.priority}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase block text-[10px] tracking-wider mb-1">Geography</span>
                    <span className="text-slate-100 font-bold flex items-center gap-1">
                      <Globe className="h-3 w-3 text-cyan-400" />
                      {target.isNational ? 'National' : `${target.acceptedStates.length} States`}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase block text-[10px] tracking-wider mb-1">Max Daily Cap</span>
                    <span className="text-slate-100 font-bold">{target.maxCap || 'Unlimited'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground uppercase block text-[10px] tracking-wider mb-1">Max Concurrency</span>
                    <span className="text-slate-100 font-bold">{target.maxConcurrency || 'Unlimited'}</span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-between border-t pt-4 border-border">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={target.status === 'ACTIVE'}
                      onCheckedChange={() => void handleStatusToggle(target)}
                      disabled={!profile?.canPauseTargets}
                      id={`status-${target.id}`}
                    />
                    <Label htmlFor={`status-${target.id}`} className="text-xs text-muted-foreground cursor-pointer">
                      {target.status === 'ACTIVE' ? 'Route Calls' : 'Pause Routing'}
                    </Label>
                  </div>
                  
                  {profile?.canSetCaps && (
                    <Button onClick={() => handleOpenCapDialog(target)} size="xs" variant="outline" className="flex items-center gap-1 text-xs">
                      <Settings className="h-3.5 w-3.5" /> Adjust Limits
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Cap Adjustment Dialog */}
      {selectedTarget && (
        <Dialog open={capDialogOpen} onOpenChange={setCapDialogOpen}>
          <DialogContent className="sm:max-w-[425px] bg-card border-border">
            <DialogHeader>
              <DialogTitle>Adjust Routing Limits</DialogTitle>
              <DialogDescription>
                Modify daily caps and concurrent channels for {selectedTarget.name}.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="maxCap" className="text-right text-xs">Daily Cap</Label>
                <Input
                  id="maxCap"
                  type="number"
                  value={newMaxCap}
                  onChange={e => setNewMaxCap(Number(e.target.value))}
                  className="col-span-3 border-border bg-background"
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="maxConcurrency" className="text-right text-xs">Concurrency</Label>
                <Input
                  id="maxConcurrency"
                  type="number"
                  value={newMaxConcurrency}
                  onChange={e => setNewMaxConcurrency(Number(e.target.value))}
                  className="col-span-3 border-border bg-background"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCapDialogOpen(false)} disabled={updating}>Cancel</Button>
              <Button onClick={handleSaveCaps} disabled={updating}>
                {updating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

export default function GuardedBuyerTargetsPage() {
  return (
    <RoleGuard allowedRoles={['BUYER']}>
      <BuyerTargetsPage />
    </RoleGuard>
  );
}
