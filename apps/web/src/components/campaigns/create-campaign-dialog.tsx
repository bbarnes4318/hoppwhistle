'use client';

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
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
import { Loader2 } from 'lucide-react';

interface Publisher {
  id: string;
  name: string;
  code: string;
}

interface Flow {
  id: string;
  name: string;
  version: number;
}

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreateCampaignDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateCampaignDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loadingData, setLoadingData] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    publisherId: '' as string,
    flowId: '' as string,
    status: 'ACTIVE' as 'ACTIVE' | 'PAUSED',
  });

  useEffect(() => {
    if (open) {
      // Reset form when dialog opens
      setFormData({
        name: '',
        publisherId: '',
        flowId: '',
        status: 'ACTIVE',
      });
      setError(null);
      loadInitialData();
    }
  }, [open]);

  const loadInitialData = async () => {
    setLoadingData(true);
    try {
      // Load publishers (mock for now - API endpoint may not exist)
      // In a real implementation, you'd fetch from /api/v1/publishers
      const demoMode = localStorage.getItem('demoMode') === 'true';
      if (demoMode) {
        // Use mock publishers in demo mode
        setPublishers([
          { id: 'pub1', name: 'Publisher 1', code: 'PUB001' },
          { id: 'pub2', name: 'Publisher 2', code: 'PUB002' },
        ]);
      } else {
        // Try to fetch real publishers
        const publishersResponse = await apiClient.get<{ data: Publisher[] }>('/api/v1/publishers');
        if (publishersResponse.data?.data) {
          setPublishers(publishersResponse.data.data);
        } else {
          // Fallback to mock
          setPublishers([
            { id: 'pub1', name: 'Publisher 1', code: 'PUB001' },
            { id: 'pub2', name: 'Publisher 2', code: 'PUB002' },
          ]);
        }
      }

      // Load flows
      const flowsResponse = await apiClient.get<{ data: Flow[] }>('/api/v1/flows');
      if (flowsResponse.data?.data) {
        setFlows(flowsResponse.data.data);
      } else {
        // Fallback to mock
        setFlows([
          { id: 'flow1', name: 'Default Flow', version: 1 },
          { id: 'flow2', name: 'Holiday Flow', version: 1 },
        ]);
      }
    } catch (err) {
      console.warn('Failed to load initial data, using mock data:', err);
      // Use mock data as fallback
      setPublishers([
        { id: 'pub1', name: 'Publisher 1', code: 'PUB001' },
        { id: 'pub2', name: 'Publisher 2', code: 'PUB002' },
      ]);
      setFlows([
        { id: 'flow1', name: 'Default Flow', version: 1 },
        { id: 'flow2', name: 'Holiday Flow', version: 1 },
      ]);
    } finally {
      setLoadingData(false);
    }
  };

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      setError('Campaign name is required');
      return;
    }

    if (!formData.publisherId) {
      setError('Publisher is required');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post<{
        id: string;
        name: string;
        status: string;
        tenantId: string;
        publisherId: string;
        createdAt: string;
        updatedAt: string;
      }>('/api/v1/campaigns', {
        name: formData.name.trim(),
        publisherId: formData.publisherId,
        flowId: formData.flowId || undefined,
        status: formData.status,
      });

      if (response.error) {
        // Check for connection errors
        if (response.error.code === 'NETWORK_ERROR' || response.error.message?.includes('Failed to fetch')) {
          throw new Error('Unable to connect to the server. Please make sure the API server is running.');
        }
        throw new Error(response.error.message || 'Failed to create campaign');
      }

      if (response.data) {
        onSuccess?.();
        onOpenChange(false);
        // Form will be reset when dialog reopens via useEffect
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create campaign';
      setError(errorMessage);
      
      // Show alert for connection errors
      if (errorMessage.includes('connect to the server') || errorMessage.includes('Failed to fetch')) {
        alert('Cannot connect to the API server. Please make sure the backend is running on port 3001.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create New Campaign</DialogTitle>
          <DialogDescription>
            Create a new call campaign to manage your outbound calling operations.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
          {loadingData ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="name">Campaign Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Summer Campaign 2024"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  disabled={loading}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="publisher">Publisher *</Label>
                <Select
                  value={formData.publisherId || undefined}
                  onValueChange={(value) =>
                    setFormData({ ...formData, publisherId: value })
                  }
                  disabled={loading || loadingData}
                >
                  <SelectTrigger id="publisher">
                    <SelectValue placeholder="Select a publisher" />
                  </SelectTrigger>
                  <SelectContent>
                    {publishers.length === 0 ? (
                      <SelectItem value="no-publishers" disabled>
                        No publishers available
                      </SelectItem>
                    ) : (
                      publishers.map((publisher) => (
                        <SelectItem key={publisher.id} value={publisher.id}>
                          {publisher.name} ({publisher.code})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="flow">Flow (Optional)</Label>
                <Select
                  value={formData.flowId || undefined}
                  onValueChange={(value) =>
                    setFormData({ ...formData, flowId: value || '' })
                  }
                  disabled={loading || loadingData}
                >
                  <SelectTrigger id="flow">
                    <SelectValue placeholder="Select a flow (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {flows.length === 0 ? (
                      <SelectItem value="no-flows" disabled>
                        No flows available
                      </SelectItem>
                    ) : (
                      flows.map((flow) => (
                        <SelectItem key={flow.id} value={flow.id}>
                          {flow.name} (v{flow.version})
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value: 'ACTIVE' | 'PAUSED') =>
                    setFormData({ ...formData, status: value })
                  }
                  disabled={loading}
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Active</SelectItem>
                    <SelectItem value="PAUSED">Paused</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {error && (
                <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading || loadingData}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={loading || loadingData || !formData.name.trim() || !formData.publisherId}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Campaign
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

