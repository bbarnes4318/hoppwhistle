'use client';

import { Loader2, Building2 } from 'lucide-react';
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
import { apiClient } from '@/lib/api';

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface Buyer {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
}

const AVAILABLE_ROLES = [
  { value: 'ADMIN', label: 'Admin', description: 'Full system access' },
  { value: 'OWNER', label: 'Owner', description: 'Tenant owner privileges' },
  { value: 'ANALYST', label: 'Analyst', description: 'View-only access to reports' },
  { value: 'AGENT', label: 'Agent', description: 'Call center agent access' },
  { value: 'BUYER', label: 'Buyer (External)', description: 'External buyer portal access' },
] as const;

export function InviteUserDialog({ open, onOpenChange, onSuccess }: InviteUserDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loadingBuyers, setLoadingBuyers] = useState(false);
  const [formData, setFormData] = useState({
    email: '',
    firstName: '',
    lastName: '',
    role: 'ANALYST',
    buyerId: '',
  });

  // Fetch buyers when role is BUYER
  useEffect(() => {
    if (formData.role === 'BUYER' && buyers.length === 0) {
      loadBuyers();
    }
  }, [formData.role]);

  useEffect(() => {
    if (open) {
      // Reset form when dialog opens
      setFormData({
        email: '',
        firstName: '',
        lastName: '',
        role: 'ANALYST',
        buyerId: '',
      });
      setError(null);
    }
  }, [open]);

  const loadBuyers = async () => {
    setLoadingBuyers(true);
    try {
      const response = await apiClient.get<{ data: Buyer[] }>('/api/v1/buyers');
      if (response.data?.data) {
        setBuyers(response.data.data.filter(b => b.status === 'ACTIVE'));
      }
    } catch (err) {
      console.error('Failed to load buyers:', err);
    } finally {
      setLoadingBuyers(false);
    }
  };

  const handleInvite = async () => {
    if (!formData.email.trim()) {
      setError('Email is required');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email)) {
      setError('Invalid email format');
      return;
    }

    // Validate BUYER role requires buyerId
    if (formData.role === 'BUYER' && !formData.buyerId) {
      setError('Please select an associated buyer company');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const payload: {
        email: string;
        firstName?: string;
        lastName?: string;
        role: string;
        buyerId?: string;
      } = {
        email: formData.email.trim(),
        firstName: formData.firstName.trim() || undefined,
        lastName: formData.lastName.trim() || undefined,
        role: formData.role,
      };

      // Only include buyerId for BUYER role
      if (formData.role === 'BUYER' && formData.buyerId) {
        payload.buyerId = formData.buyerId;
      }

      const response = await apiClient.post<{
        id: string;
        email: string;
        firstName?: string;
        lastName?: string;
        tempPassword?: string;
      }>('/api/v1/users/invite', payload);

      if (response.error) {
        throw new Error(response.error.message || 'Failed to invite user');
      }

      if (response.data) {
        // Show success message with temp password (in dev only)
        if (response.data.tempPassword) {
          alert(
            `User invited successfully!\n\nTemporary password: ${response.data.tempPassword}\n\n(Note: In production, this would be sent via email)`
          );
        } else {
          alert('User invited successfully!');
        }
        onSuccess?.();
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setLoading(false);
    }
  };

  const isBuyerRole = formData.role === 'BUYER';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Invite User</DialogTitle>
          <DialogDescription>Send an invitation to a new team member</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
          <div className="space-y-2">
            <Label htmlFor="email">Email Address *</Label>
            <Input
              id="email"
              type="email"
              placeholder="user@example.com"
              value={formData.email}
              onChange={e => setFormData({ ...formData, email: e.target.value })}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="firstName">First Name</Label>
              <Input
                id="firstName"
                placeholder="John"
                value={formData.firstName}
                onChange={e => setFormData({ ...formData, firstName: e.target.value })}
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="lastName">Last Name</Label>
              <Input
                id="lastName"
                placeholder="Doe"
                value={formData.lastName}
                onChange={e => setFormData({ ...formData, lastName: e.target.value })}
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="role">Role *</Label>
            <Select
              value={formData.role}
              onValueChange={value =>
                setFormData({
                  ...formData,
                  role: value,
                  // Clear buyerId when switching away from BUYER
                  buyerId: value !== 'BUYER' ? '' : formData.buyerId,
                })
              }
              disabled={loading}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a role" />
              </SelectTrigger>
              <SelectContent>
                {AVAILABLE_ROLES.map(role => (
                  <SelectItem key={role.value} value={role.value}>
                    <div className="flex flex-col">
                      <span>{role.label}</span>
                      <span className="text-xs text-muted-foreground">{role.description}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Associated Buyer Company - only shown when BUYER role selected */}
          {isBuyerRole && (
            <div className="space-y-2 p-3 border rounded-md bg-muted/30">
              <Label htmlFor="buyerId" className="flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Associated Buyer Company *
              </Label>
              <Select
                value={formData.buyerId}
                onValueChange={value => setFormData({ ...formData, buyerId: value })}
                disabled={loading || loadingBuyers}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={loadingBuyers ? 'Loading buyers...' : 'Select a buyer company'}
                  />
                </SelectTrigger>
                <SelectContent>
                  {buyers.length === 0 && !loadingBuyers ? (
                    <SelectItem value="" disabled>
                      No active buyers found
                    </SelectItem>
                  ) : (
                    buyers.map(buyer => (
                      <SelectItem key={buyer.id} value={buyer.id}>
                        {buyer.name} ({buyer.code})
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The user will only have access to this buyer's portal and data.
              </p>
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleInvite}
            disabled={loading || !formData.email.trim() || (isBuyerRole && !formData.buyerId)}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Send Invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
