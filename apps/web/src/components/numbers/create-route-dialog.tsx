'use client';

import { useState } from 'react';
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
  const [destination, setDestination] = useState('');
  const [label, setLabel] = useState('');
  const [recordingEnabled, setRecordingEnabled] = useState(true);

  // We only want active numbers that don't already have routes or are not assigned exclusively to something else.
  // The API will reject duplicates anyway.
  const activeNumbers = availableNumbers.filter(n => n.status === 'ACTIVE');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!phoneNumberId) {
      toast({ title: 'Error', description: 'Please select a phone number', variant: 'destructive' });
      return;
    }
    if (!destination) {
      toast({ title: 'Error', description: 'Please enter a destination number', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      await apiClient.post('/api/v1/did-routes', {
        phoneNumberId,
        destination,
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
            Map one of your purchased DIDs to a buyer's destination number.
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
            <Label htmlFor="destination">Buyer Destination Number</Label>
            <Input
              id="destination"
              placeholder="+12345678900"
              value={destination}
              onChange={e => setDestination(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">The number where calls will be forwarded.</p>
          </div>

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
