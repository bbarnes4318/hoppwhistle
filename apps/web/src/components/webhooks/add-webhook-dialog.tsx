'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { apiClient } from '@/lib/api';

interface AddWebhookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const AVAILABLE_EVENTS = [
  { id: 'call.*', label: 'All Call Events' },
  { id: 'call.initiated', label: 'Call Initiated' },
  { id: 'call.ringing', label: 'Call Ringing' },
  { id: 'call.answered', label: 'Call Answered' },
  { id: 'call.completed', label: 'Call Completed' },
  { id: 'call.failed', label: 'Call Failed' },
  { id: 'recording.ready', label: 'Recording Ready' },
  { id: 'conversion.confirmed', label: 'Conversion Confirmed' },
];

export function AddWebhookDialog({
  open,
  onOpenChange,
  onSuccess,
}: AddWebhookDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    url: '',
    events: [] as string[],
    status: 'ACTIVE' as 'ACTIVE' | 'INACTIVE',
  });

  const handleSubmit = async () => {
    if (!formData.url.trim()) {
      setError('URL is required');
      return;
    }

    if (formData.events.length === 0) {
      setError('At least one event must be selected');
      return;
    }

    // Validate URL format
    try {
      new URL(formData.url);
    } catch {
      setError('Invalid URL format');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post<{
        id: string;
        url: string;
        events: string[];
        status: string;
      }>('/api/v1/webhooks', {
        url: formData.url.trim(),
        events: formData.events,
        status: formData.status,
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to create webhook');
      }

      if (response.data) {
        onSuccess?.();
        onOpenChange(false);
        // Reset form
        setFormData({
          url: '',
          events: [],
          status: 'ACTIVE',
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setLoading(false);
    }
  };

  const toggleEvent = (eventId: string) => {
    if (eventId === 'call.*') {
      // If selecting "all call events", toggle all call.* events
      if (formData.events.includes('call.*')) {
        setFormData({
          ...formData,
          events: formData.events.filter((e) => !e.startsWith('call.')),
        });
      } else {
        setFormData({
          ...formData,
          events: ['call.*', ...formData.events.filter((e) => !e.startsWith('call.'))],
        });
      }
    } else {
      // Remove call.* if selecting individual call events
      const newEvents = formData.events.includes(eventId)
        ? formData.events.filter((e) => e !== eventId)
        : [...formData.events.filter((e) => e !== 'call.*'), eventId];
      setFormData({ ...formData, events: newEvents });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add Webhook</DialogTitle>
          <DialogDescription>
            Configure a webhook endpoint to receive event notifications
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
          <div className="space-y-2">
            <Label htmlFor="url">Webhook URL *</Label>
            <Input
              id="url"
              type="url"
              placeholder="https://example.com/webhook"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              The URL where webhook events will be sent
            </p>
          </div>

          <div className="space-y-2">
            <Label>Events *</Label>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-3">
              {AVAILABLE_EVENTS.map((event) => (
                <div key={event.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={`event-${event.id}`}
                    checked={formData.events.includes(event.id)}
                    onCheckedChange={() => toggleEvent(event.id)}
                    disabled={loading}
                  />
                  <Label
                    htmlFor={`event-${event.id}`}
                    className="font-normal cursor-pointer text-sm"
                  >
                    {event.label}
                  </Label>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Select the events you want to receive notifications for
            </p>
          </div>

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
              {error}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading || !formData.url.trim() || formData.events.length === 0}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Add Webhook
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

