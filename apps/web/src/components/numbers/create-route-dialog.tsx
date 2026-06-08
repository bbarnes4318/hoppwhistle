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
import { Loader2 } from 'lucide-react';

export interface AvailableNumber {
  id: string;
  number: string;
  status: string;
  campaign?: { id: string; name: string } | null;
}

interface Campaign {
  id: string;
  name: string;
}

interface CreateRouteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  availableNumbers: AvailableNumber[];
  onSuccess: () => void;
}

export function CreateRouteDialog({
  open,
  onOpenChange,
  availableNumbers,
  onSuccess,
}: CreateRouteDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [routeType, setRouteType] = useState<'CAMPAIGN' | 'STATIC'>('STATIC');
  const [destination, setDestination] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [label, setLabel] = useState('');
  const [recordingEnabled, setRecordingEnabled] = useState(true);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);

  useEffect(() => {
    if (open) {
      void loadCampaigns();
    }
  }, [open]);

  const loadCampaigns = async () => {
    setLoadingCampaigns(true);
    try {
      const response = await apiClient.get<{ data: Campaign[] }>('/api/v1/campaigns');
      if (response.data?.data) {
        setCampaigns(response.data.data);
      }
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    } finally {
      setLoadingCampaigns(false);
    }
  };

  // We only want active numbers that don't already have routes or are not assigned exclusively to something else.
  // The API will reject duplicates anyway.
  const activeNumbers = availableNumbers.filter(n => n.status === 'ACTIVE');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phoneNumberId) {
      toast({ title: 'Error', description: 'Please select a phone number', variant: 'destructive' });
      return;
    }
    if (routeType === 'STATIC' && !destination) {
      toast({ title: 'Error', description: 'Please enter a destination number', variant: 'destructive' });
      return;
    }
    if (routeType === 'CAMPAIGN' && !campaignId) {
      toast({ title: 'Error', description: 'Please select a campaign', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/api/v1/did-routes', {
        phoneNumberId,
        destination: routeType === 'CAMPAIGN' ? 'Campaign' : destination,
        campaignId: routeType === 'CAMPAIGN' ? campaignId : undefined,
        label: label || undefined,
        recordingEnabled,
      });

      toast({
        title: 'Route Created',
        description: 'Successfully mapped DID to destination.',
      });
      
      // Reset form
      setPhoneNumberId('');
      setDestination('');
      setCampaignId('');
      setRouteType('STATIC');
      setLabel('');
      setRecordingEnabled(true);
      
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error('Failed to create route:', err);
      toast({
        title: 'Failed to create route',
        description: err.response?.data?.error || err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Inbound Route</DialogTitle>
          <DialogDescription>
            Map one of your purchased DIDs to a buyer's destination number or campaign.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="phoneNumber">Hopwhistle DID</Label>
            <Select value={phoneNumberId} onValueChange={setPhoneNumberId} disabled={loading}>
              <SelectTrigger>
                <SelectValue placeholder="Select a phone number" />
              </SelectTrigger>
              <SelectContent>
                {activeNumbers.length === 0 ? (
                  <SelectItem value="none" disabled>
                    No active numbers available
                  </SelectItem>
                ) : (
                  activeNumbers.map(num => (
                    <SelectItem key={num.id} value={num.id}>
                      {formatPhoneNumber(num.number)} {num.campaign ? `(${num.campaign.name})` : ''}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="routeType">Route Type</Label>
            <Select
              value={routeType}
              onValueChange={(val: 'CAMPAIGN' | 'STATIC') => setRouteType(val)}
              disabled={loading}
            >
              <SelectTrigger id="routeType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="STATIC">Static Forwarding Number</SelectItem>
                <SelectItem value="CAMPAIGN">Route to Campaign</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {routeType === 'STATIC' ? (
            <div className="space-y-2">
              <Label htmlFor="destination">Buyer Destination Number</Label>
              <Input
                id="destination"
                placeholder="+12345678900"
                value={destination}
                onChange={e => setDestination(e.target.value)}
                disabled={loading}
                required
              />
              <p className="text-xs text-muted-foreground">The number where calls will be forwarded.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="campaign">Campaign Routing</Label>
              <Select
                value={campaignId}
                onValueChange={setCampaignId}
                disabled={loading || loadingCampaigns}
                required
              >
                <SelectTrigger id="campaign">
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

          <div className="space-y-2">
            <Label htmlFor="label">Label (Optional)</Label>
            <Input
              id="label"
              placeholder="e.g. Medicare Buyer A"
              value={label}
              onChange={e => setLabel(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex items-center justify-between space-x-2 pt-2">
            <Label htmlFor="recording" className="flex flex-col space-y-1">
              <span>Call Recording</span>
              <span className="font-normal text-xs text-muted-foreground">
                Record all inbound calls for this route
              </span>
            </Label>
            <Switch
              id="recording"
              checked={recordingEnabled}
              onCheckedChange={setRecordingEnabled}
              disabled={loading}
            />
          </div>

          <DialogFooter className="pt-4">
            <Button variant="outline" type="button" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Route
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
