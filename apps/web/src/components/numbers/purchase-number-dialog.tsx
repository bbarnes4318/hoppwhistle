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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { apiClient } from '@/lib/api';

interface PurchaseNumberDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function PurchaseNumberDialog({
  open,
  onOpenChange,
  onSuccess,
}: PurchaseNumberDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    areaCode: '',
    country: 'US',
    region: '',
    provider: 'local',
    features: {
      voice: true,
      sms: false,
      mms: false,
      fax: false,
    },
  });

  const handlePurchase = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post<{
        id: string;
        number: string;
        status: string;
        tenantId: string;
        createdAt: string;
        updatedAt: string;
      }>('/api/v1/numbers', {
        areaCode: formData.areaCode || undefined,
        country: formData.country,
        region: formData.region || undefined,
        provider: formData.provider,
        features: formData.features,
      });

      if (response.error) {
        throw new Error(response.error.message || 'Failed to purchase number');
      }

      if (response.data) {
        onSuccess?.();
        onOpenChange(false);
        // Reset form
        setFormData({
          areaCode: '',
          country: 'US',
          region: '',
          provider: 'local',
          features: {
            voice: true,
            sms: false,
            mms: false,
            fax: false,
          },
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to purchase number');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Purchase Phone Number</DialogTitle>
          <DialogDescription>
            Search and purchase a new phone number for your account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <Select
              value={formData.provider}
              onValueChange={(value) =>
                setFormData({ ...formData, provider: value })
              }
            >
              <SelectTrigger id="provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local (Test)</SelectItem>
                <SelectItem value="signalwire">SignalWire</SelectItem>
                <SelectItem value="telnyx">Telnyx</SelectItem>
                <SelectItem value="bandwidth">Bandwidth</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Country</Label>
            <Select
              value={formData.country}
              onValueChange={(value) =>
                setFormData({ ...formData, country: value })
              }
            >
              <SelectTrigger id="country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="US">United States</SelectItem>
                <SelectItem value="CA">Canada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="areaCode">Area Code (Optional)</Label>
            <Input
              id="areaCode"
              placeholder="e.g., 212, 310, 415"
              value={formData.areaCode}
              onChange={(e) =>
                setFormData({ ...formData, areaCode: e.target.value })
              }
              maxLength={3}
              pattern="[0-9]{3}"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to get any available number
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="region">Region/State (Optional)</Label>
            <Input
              id="region"
              placeholder="e.g., CA, NY, TX"
              value={formData.region}
              onChange={(e) =>
                setFormData({ ...formData, region: e.target.value })
              }
              maxLength={2}
            />
          </div>

          <div className="space-y-3">
            <Label>Capabilities</Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="voice"
                  checked={formData.features.voice}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      features: { ...formData.features, voice: !!checked },
                    })
                  }
                />
                <Label htmlFor="voice" className="font-normal cursor-pointer">
                  Voice
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="sms"
                  checked={formData.features.sms}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      features: { ...formData.features, sms: !!checked },
                    })
                  }
                />
                <Label htmlFor="sms" className="font-normal cursor-pointer">
                  SMS
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="mms"
                  checked={formData.features.mms}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      features: { ...formData.features, mms: !!checked },
                    })
                  }
                />
                <Label htmlFor="mms" className="font-normal cursor-pointer">
                  MMS
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="fax"
                  checked={formData.features.fax}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      features: { ...formData.features, fax: !!checked },
                    })
                  }
                />
                <Label htmlFor="fax" className="font-normal cursor-pointer">
                  Fax
                </Label>
              </div>
            </div>
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
          <Button onClick={handlePurchase} disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Purchase Number
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

