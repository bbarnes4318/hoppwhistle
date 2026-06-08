'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';
import { formatPhoneNumber } from '@/lib/utils';
import { Loader2, Trash2 } from 'lucide-react';

interface Buyer {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
}

interface Campaign {
  id: string;
  name: string;
}

export interface DidRoute {
  id: string;
  did: string;
  destination: string;
  status: string;
  recordingEnabled: boolean;
  label?: string;
  buyer?: { id: string; name: string };
  campaign?: { id: string; name: string };
  createdAt: string;
}

interface EditRouteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  route: DidRoute;
  onSuccess: () => void;
}

export function EditRouteDialog({
  open,
  onOpenChange,
  route,
  onSuccess,
}: EditRouteDialogProps) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [destination, setDestination] = useState('');
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [buyerId, setBuyerId] = useState('none');
  const [campaignId, setCampaignId] = useState('none');
  const [routeType, setRouteType] = useState<'CAMPAIGN' | 'STATIC'>('STATIC');

  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);

  useEffect(() => {
    if (open && route) {
      setDestination(route.destination);
      setLabel(route.label || '');
      setStatus(route.status);
      setRecordingEnabled(route.recordingEnabled);
      setBuyerId(route.buyer?.id || 'none');
      setCampaignId(route.campaign?.id || 'none');
      setRouteType(route.campaign?.id ? 'CAMPAIGN' : 'STATIC');
      setConfirmDelete(false);
      void loadOptions();
    }
  }, [open, route]);

  const loadOptions = async () => {
    setLoadingOptions(true);
    try {
      const [buyersRes, campaignsRes] = await Promise.all([
        apiClient.get<{ data: Buyer[] }>('/api/v1/buyers'),
        apiClient.get<{ data: Campaign[] }>('/api/v1/campaigns'),
      ]);
      if (buyersRes.data?.data) {
        setBuyers(buyersRes.data.data.filter(b => b.status === 'ACTIVE'));
      }
      if (campaignsRes.data?.data) {
        setCampaigns(campaignsRes.data.data);
      }
    } catch (err) {
      console.error('Failed to load buyers/campaigns:', err);
    } finally {
      setLoadingOptions(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (routeType === 'STATIC' && !destination) {
      toast({ title: 'Error', description: 'Please enter a destination number', variant: 'destructive' });
      return;
    }
    if (routeType === 'CAMPAIGN' && (!campaignId || campaignId === 'none')) {
      toast({ title: 'Error', description: 'Please select a campaign', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      await apiClient.patch(`/api/v1/did-routes/${route.id}`, {
        destination: routeType === 'CAMPAIGN' ? 'Campaign' : destination,
        label: label || null,
        status,
        recordingEnabled,
        buyerId: routeType === 'STATIC' && buyerId !== 'none' ? buyerId : null,
        campaignId: routeType === 'CAMPAIGN' ? campaignId : null,
      });

      toast({
        title: 'Route Updated',
        description: 'Successfully updated inbound route configuration.',
      });
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Failed to update route:', err);
      toast({
        title: 'Failed to update route',
        description: err.response?.data?.error || err.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await apiClient.delete(`/api/v1/did-routes/${route.id}`);
      toast({
        title: 'Route Deleted',
        description: 'Successfully deleted inbound route.',
      });
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Failed to delete route:', err);
      toast({
        title: 'Failed to delete route',
        description: err.response?.data?.error || err.message,
        variant: 'destructive',
      });
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Inbound Route</DialogTitle>
          <DialogDescription>
            Modify or delete the routing for DID: <span className="font-mono text-foreground font-semibold">{formatPhoneNumber(route.did)}</span>.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="edit-routeType">Route Type</Label>
            <Select
              value={routeType}
              onValueChange={(val: 'CAMPAIGN' | 'STATIC') => setRouteType(val)}
              disabled={saving || deleting}
            >
              <SelectTrigger id="edit-routeType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STATIC">Static Forwarding Number</SelectItem>
                <SelectItem value="CAMPAIGN">Route to Campaign</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {routeType === 'STATIC' ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-destination">Buyer Destination Number</Label>
                <Input
                  id="edit-destination"
                  placeholder="+12345678900"
                  value={destination}
                  onChange={e => setDestination(e.target.value)}
                  disabled={saving || deleting}
                  required
                />
                <p className="text-xs text-muted-foreground">The number where calls will be forwarded.</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="edit-buyer">Associated Buyer (Optional)</Label>
                <Select value={buyerId} onValueChange={setBuyerId} disabled={saving || deleting || loadingOptions}>
                  <SelectTrigger id="edit-buyer">
                    <SelectValue placeholder="Select a buyer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {buyers.map(b => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="edit-campaign">Associated Campaign</Label>
              <Select value={campaignId} onValueChange={setCampaignId} disabled={saving || deleting || loadingOptions} required>
                <SelectTrigger id="edit-campaign">
                  <SelectValue placeholder="Select a campaign" />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Calls will follow the dynamic buyer routing rules of the campaign.</p>
            </div>
          )}

          <div className="flex items-center justify-between space-x-2 pt-2">
            <Label htmlFor="edit-recording" className="flex flex-col space-y-1">
              <span>Call Recording</span>
              <span className="font-normal text-xs text-muted-foreground">
                Record all inbound calls for this route
              </span>
            </Label>
            <Switch
              id="edit-recording"
              checked={recordingEnabled}
              onCheckedChange={setRecordingEnabled}
              disabled={saving || deleting}
            />
          </div>

          <DialogFooter className="pt-4 flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
            <Button
              variant="destructive"
              type="button"
              onClick={handleDelete}
              disabled={saving || deleting}
            >
              {deleting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              {confirmDelete ? 'Confirm Delete?' : 'Delete Route'}
            </Button>
            <div className="flex flex-col-reverse sm:flex-row gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={saving || deleting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving || deleting}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
