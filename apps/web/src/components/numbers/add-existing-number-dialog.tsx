'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

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
import { apiClient } from '@/lib/api';

interface Campaign {
  id: string;
  name: string;
}

const CARRIERS: Array<{ value: string; label: string }> = [
  { value: 'anveo', label: 'Anveo' },
  { value: 'fractel', label: 'FracTEL' },
  { value: 'bulkvs', label: 'BulkVS' },
  { value: 'signalwire', label: 'SignalWire' },
  { value: 'telnyx', label: 'Telnyx' },
  { value: 'twilio', label: 'Twilio' },
];

/**
 * Add a number the platform already owns at a carrier to the agency being
 * viewed, and point it at one of its campaigns. For numbers that exist already;
 * "Buy Number" is for new ones.
 */
export function AddExistingNumberDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}): JSX.Element {
  const [number, setNumber] = useState('');
  const [provider, setProvider] = useState('anveo');
  const [campaignId, setCampaignId] = useState('none');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNumber('');
    setProvider('anveo');
    setError(null);
    void apiClient.get<{ data: Campaign[] }>('/api/v1/campaigns').then(response => {
      const list = response.data?.data ?? [];
      setCampaigns(list);
      // One campaign is the common case for an agency: pick it for them.
      setCampaignId(list.length === 1 ? list[0].id : 'none');
    });
  }, [open]);

  const submit = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    const response = await apiClient.post('/api/v1/numbers/existing', {
      number,
      provider,
      campaignId: campaignId === 'none' ? null : campaignId,
    });
    setSaving(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    onOpenChange(false);
    onSuccess?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Add existing number</DialogTitle>
          <DialogDescription>
            A number you already own at a carrier. It is added to the agency you are viewing.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4 py-2"
          onSubmit={event => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="existing-number">Phone number</Label>
            <Input
              id="existing-number"
              type="tel"
              inputMode="tel"
              placeholder="(865) 555-1234"
              value={number}
              onChange={event => setNumber(event.target.value)}
              disabled={saving}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="existing-carrier">Carrier</Label>
            <Select value={provider} onValueChange={setProvider} disabled={saving}>
              <SelectTrigger id="existing-carrier">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CARRIERS.map(carrier => (
                  <SelectItem key={carrier.value} value={carrier.value}>
                    {carrier.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="existing-campaign">Campaign</Label>
            <Select value={campaignId} onValueChange={setCampaignId} disabled={saving}>
              <SelectTrigger id="existing-campaign">
                <SelectValue placeholder="Select a campaign" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {campaigns.map(campaign => (
                  <SelectItem key={campaign.id} value={campaign.id}>
                    {campaign.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || number.trim() === ''}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add number
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
