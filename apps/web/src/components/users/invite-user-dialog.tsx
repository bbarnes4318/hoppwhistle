'use client';

import { Loader2, UserPlus } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';

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
import {
  ACTIVATION_GRANTS_PATH,
  InviteResult,
  type ActivationGrant,
} from '@/components/users/invite-result';
import { apiClient } from '@/lib/api';

/**
 * Inviting a person to the agency.
 *
 * It issues an activation grant (`POST /api/v1/auth/activation-grants`): the
 * person is emailed a link and sets their own password. The old
 * temporary-password route is gone, and with it the "create a new buyer
 * company" shortcut -- a BUYER login is tied to a buyer that already exists.
 *
 * OWNER is not offered: an additional owner is arranged with NetEnroll, and
 * the server refuses it with a 403 that says so.
 */

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** Offer only these roles. Every role in AVAILABLE_ROLES when absent. */
  roles?: readonly string[];
}

interface Publisher {
  id: string;
  name: string;
  status?: string;
}

interface Buyer {
  id: string;
  name: string;
  code: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PAUSED';
}

const AVAILABLE_ROLES = [
  { value: 'ADMIN', label: 'Admin', description: 'Full system access' },
  { value: 'ANALYST', label: 'Analyst', description: 'View-only access to reports' },
  { value: 'AGENT', label: 'Agent', description: 'Call center agent access' },
  {
    value: 'MANAGER',
    label: 'Manager',
    description: "Supervises the live floor and can listen in on agents' calls",
  },
  { value: 'BUYER', label: 'Buyer (External)', description: 'External buyer portal access' },
  {
    value: 'PUBLISHER',
    label: 'Publisher (External)',
    description: 'External publisher portal access',
  },
] as const;

/** The roles the dialog offers: these, in AVAILABLE_ROLES' order, or every one. */
export function rolesOffered(roles?: readonly string[]) {
  return roles ? AVAILABLE_ROLES.filter(role => roles.includes(role.value)) : AVAILABLE_ROLES;
}

/** The role a fresh form starts on: Analyst, unless it is not on offer. */
function initialRole(offered: ReadonlyArray<{ value: string }>): string {
  return offered.some(role => role.value === 'ANALYST')
    ? 'ANALYST'
    : (offered[0]?.value ?? 'ANALYST');
}

export function InviteUserDialog({ open, onOpenChange, onSuccess, roles }: InviteUserDialogProps) {
  const offeredRoles = useMemo(() => rolesOffered(roles), [roles]);
  const [loading, setLoading] = useState(false);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [loadingPublishers, setLoadingPublishers] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [buyers, setBuyers] = useState<Buyer[]>([]);
  const [loadingBuyers, setLoadingBuyers] = useState(false);
  const [result, setResult] = useState<ActivationGrant | null>(null);
  const [formData, setFormData] = useState({
    email: '',
    role: initialRole(offeredRoles),
    buyerId: '',
    publisherId: '',
  });

  // A buyer login is always tied to an existing buyer.
  useEffect(() => {
    if (formData.role === 'BUYER' && buyers.length === 0) {
      void loadBuyers();
    }
  }, [formData.role, buyers.length]);

  // Fetch publishers when role is PUBLISHER: a publisher login is always tied to one.
  useEffect(() => {
    if (formData.role === 'PUBLISHER' && publishers.length === 0) {
      void loadPublishers();
    }
  }, [formData.role, publishers.length]);

  useEffect(() => {
    if (open) {
      // Reset form when dialog opens
      setFormData({
        email: '',
        role: initialRole(offeredRoles),
        buyerId: '',
        publisherId: '',
      });
      setError(null);
      setResult(null);
    }
  }, [open, offeredRoles]);

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

  const loadPublishers = async () => {
    setLoadingPublishers(true);
    try {
      const response = await apiClient.get<{ data: Publisher[] }>('/api/v1/publishers');
      if (response.data?.data) {
        setPublishers(response.data.data.filter(p => !p.status || p.status === 'ACTIVE'));
      }
    } catch (err) {
      console.error('Failed to load publishers:', err);
    } finally {
      setLoadingPublishers(false);
    }
  };

  const handleInvite = async () => {
    if (!formData.email.trim()) {
      setError('Email is required');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      setError('Invalid email format');
      return;
    }

    // An agent is only sent calls from the states they are licensed in, and
    // this form has no way to record them. "Add an agent" does.
    if (formData.role === 'AGENT') {
      setError(
        'Agents are added with "Add an agent", which records the states they are licensed in.'
      );
      return;
    }

    if (formData.role === 'BUYER' && !formData.buyerId) {
      setError('Please select the buyer this login is for');
      return;
    }

    if (formData.role === 'PUBLISHER' && !formData.publisherId) {
      setError('Please select the publisher this login is for');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post<ActivationGrant>(ACTIVATION_GRANTS_PATH, {
        email: formData.email.trim().toLowerCase(),
        role: formData.role,
        ...(formData.role === 'BUYER' ? { buyerId: formData.buyerId } : {}),
        ...(formData.role === 'PUBLISHER' ? { publisherId: formData.publisherId } : {}),
      });

      if (response.error || !response.data) {
        throw new Error(response.error?.message || 'Failed to invite user');
      }

      setResult(response.data);
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite user');
    } finally {
      setLoading(false);
    }
  };

  const isBuyerRole = formData.role === 'BUYER';
  const isPublisherRole = formData.role === 'PUBLISHER';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Invite User
          </DialogTitle>
          <DialogDescription>
            They are emailed a link to set up their account and choose their own password.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="py-4">
            <InviteResult grant={result} />
          </div>
        ) : (
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

            <div className="space-y-2">
              <Label htmlFor="role">Role *</Label>
              <Select
                value={formData.role}
                onValueChange={value =>
                  setFormData({
                    ...formData,
                    role: value,
                    buyerId: value !== 'BUYER' ? '' : formData.buyerId,
                    publisherId: value !== 'PUBLISHER' ? '' : formData.publisherId,
                  })
                }
                disabled={loading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a role" />
                </SelectTrigger>
                <SelectContent>
                  {offeredRoles.map(role => (
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

            {isBuyerRole && (
              <div className="space-y-2">
                <Label htmlFor="buyerId">Buyer *</Label>
                <Select
                  value={formData.buyerId}
                  onValueChange={value => setFormData({ ...formData, buyerId: value })}
                  disabled={loading || loadingBuyers}
                >
                  <SelectTrigger id="buyerId">
                    <SelectValue
                      placeholder={loadingBuyers ? 'Loading buyers...' : 'Select a buyer'}
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
                  This login sees that buyer&apos;s calls, and nothing else. Add the buyer first if
                  it is not listed.
                </p>
              </div>
            )}

            {isPublisherRole && (
              <div className="space-y-2">
                <Label htmlFor="publisherId">Publisher *</Label>
                <Select
                  value={formData.publisherId}
                  onValueChange={value => setFormData({ ...formData, publisherId: value })}
                  disabled={loading || loadingPublishers}
                >
                  <SelectTrigger id="publisherId">
                    <SelectValue
                      placeholder={
                        loadingPublishers ? 'Loading publishers...' : 'Select a publisher'
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {publishers.length === 0 && !loadingPublishers ? (
                      <SelectItem value="" disabled>
                        No active publishers found
                      </SelectItem>
                    ) : (
                      publishers.map(publisher => (
                        <SelectItem key={publisher.id} value={publisher.id}>
                          {publisher.name}
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  This login sees that publisher&apos;s calls and payouts, and nothing else.
                </p>
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {result ? (
            <>
              <Button variant="outline" onClick={() => setResult(null)}>
                Invite another
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                Cancel
              </Button>
              <Button
                onClick={() => void handleInvite()}
                disabled={
                  loading ||
                  !formData.email.trim() ||
                  (isBuyerRole && !formData.buyerId) ||
                  (isPublisherRole && !formData.publisherId)
                }
              >
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Send Invitation
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
