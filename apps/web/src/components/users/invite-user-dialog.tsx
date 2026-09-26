'use client';

import { Loader2, Building2, UserPlus } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';

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
 { value: 'OWNER', label: 'Owner', description: 'Tenant owner privileges' },
 { value: 'ANALYST', label: 'Analyst', description: 'View-only access to reports' },
 { value: 'AGENT', label: 'Agent', description: 'Call center agent access' },
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
 return offered.some(role => role.value === 'ANALYST') ? 'ANALYST' : (offered[0]?.value ?? 'ANALYST');
}

export function InviteUserDialog({ open, onOpenChange, onSuccess, roles }: InviteUserDialogProps) {
 const offeredRoles = useMemo(() => rolesOffered(roles), [roles]);
 const [loading, setLoading] = useState(false);
 const [publishers, setPublishers] = useState<Publisher[]>([]);
 const [loadingPublishers, setLoadingPublishers] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [buyers, setBuyers] = useState<Buyer[]>([]);
 const [loadingBuyers, setLoadingBuyers] = useState(false);
 const [createNewBuyer, setCreateNewBuyer] = useState(true); // Default to creating new buyer
 const [newBuyerName, setNewBuyerName] = useState('');
 const [formData, setFormData] = useState({
 email: '',
 firstName: '',
 lastName: '',
 role: initialRole(offeredRoles),
 buyerId: '',
 publisherId: '',
 });

 // Fetch buyers when role is BUYER and not creating new
 useEffect(() => {
 if (formData.role === 'BUYER' && !createNewBuyer && buyers.length === 0) {
 void loadBuyers();
 }
 }, [formData.role, createNewBuyer, buyers.length]);

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
 firstName: '',
 lastName: '',
 role: initialRole(offeredRoles),
 buyerId: '',
 publisherId: '',
 });
 setCreateNewBuyer(true);
 setNewBuyerName('');
 setError(null);
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
 if (!emailRegex.test(formData.email)) {
 setError('Invalid email format');
 return;
 }

 // Validate BUYER role requirements
 if (formData.role === 'BUYER') {
 if (createNewBuyer && !newBuyerName.trim()) {
 setError('Please enter a buyer company name');
 return;
 }
 if (!createNewBuyer && !formData.buyerId) {
 setError('Please select an associated buyer company');
 return;
 }
 }

 if (formData.role === 'PUBLISHER' && !formData.publisherId) {
 setError('Please select the publisher this login is for');
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
 publisherId?: string;
 createNewBuyer?: boolean;
 newBuyerName?: string;
 } = {
 email: formData.email.trim(),
 firstName: formData.firstName.trim() || undefined,
 lastName: formData.lastName.trim() || undefined,
 role: formData.role,
 };

 // Handle BUYER role - either link to existing or create new
 if (formData.role === 'BUYER') {
 if (createNewBuyer) {
 payload.createNewBuyer = true;
 payload.newBuyerName = newBuyerName.trim();
 } else {
 payload.buyerId = formData.buyerId;
 }
 }

 if (formData.role === 'PUBLISHER') {
 payload.publisherId = formData.publisherId;
 }

 const response = await apiClient.post<{
 id: string;
 email: string;
 firstName?: string;
 lastName?: string;
 tempPassword?: string;
 buyerId?: string;
 buyerName?: string;
 }>('/api/v1/users/invite', payload);

 if (response.error) {
 throw new Error(response.error.message || 'Failed to invite user');
 }

 if (response.data) {
 // Show success message with temp password
 const message = !response.data.tempPassword
 ? 'User invited successfully!'
 : formData.role === 'PUBLISHER'
 ? `✅ Publisher invited successfully!\n\n📧 Email: ${response.data.email}\n🔑 Temporary Password: ${response.data.tempPassword}\n🏢 Publisher: ${publishers.find(p => p.id === formData.publisherId)?.name || 'Linked'}\n\n⚠️ Please share these credentials securely with the publisher.`
 : `✅ Buyer invited successfully!\n\n📧 Email: ${response.data.email}\n🔑 Temporary Password: ${response.data.tempPassword}\n🏢 Buyer Company: ${response.data.buyerName || 'Linked'}\n\n⚠️ Please share these credentials securely with the buyer.`;

 alert(message);
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
 const isPublisherRole = formData.role === 'PUBLISHER';

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
 <DialogHeader>
 <DialogTitle className="flex items-center gap-2">
 <UserPlus className="h-5 w-5" />
 {isBuyerRole ? 'Invite Buyer' : 'Invite User'}
 </DialogTitle>
 <DialogDescription>
 {isBuyerRole
 ? 'Create a new buyer account with dashboard access'
 : 'Send an invitation to a new team member'}
 </DialogDescription>
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

 {/* Buyer Company Section - only shown when BUYER role selected */}
 {isBuyerRole && (
 <div className="space-y-3 p-3 border rounded-md bg-primary/5 border-primary/20">
 <div className="flex items-center gap-2 text-sm font-medium text-primary">
 <Building2 className="h-4 w-4" />
 Buyer Company Setup
 </div>

 {/* Toggle between create new and select existing */}
 <div className="flex items-center space-x-2">
 <Checkbox
 id="createNewBuyer"
 checked={createNewBuyer}
 onCheckedChange={checked => {
 setCreateNewBuyer(!!checked);
 if (checked) {
 setFormData({ ...formData, buyerId: '' });
 } else {
 setNewBuyerName('');
 }
 }}
 disabled={loading}
 />
 <Label htmlFor="createNewBuyer" className="cursor-pointer">
 Create new buyer company
 </Label>
 </div>

 {createNewBuyer ? (
 <div className="space-y-2">
 <Label htmlFor="newBuyerName">New Buyer Company Name *</Label>
 <Input
 id="newBuyerName"
 placeholder="e.g., Acme Insurance Partners"
 value={newBuyerName}
 onChange={e => setNewBuyerName(e.target.value)}
 disabled={loading}
 />
 <p className="text-xs text-muted-foreground">
 A new buyer entity will be created and linked to this user.
 </p>
 </div>
 ) : (
 <div className="space-y-2">
 <Label htmlFor="buyerId">Select Existing Buyer Company *</Label>
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
 </div>
 )}
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
 placeholder={loadingPublishers ? 'Loading publishers...' : 'Select a publisher'}
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
 <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
 )}
 </div>

 <DialogFooter>
 <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
 Cancel
 </Button>
 <Button
 onClick={() => void handleInvite()}
 disabled={
 loading ||
 !formData.email.trim() ||
 (isBuyerRole && createNewBuyer && !newBuyerName.trim()) ||
 (isBuyerRole && !createNewBuyer && !formData.buyerId) ||
 (isPublisherRole && !formData.publisherId)
 }
 >
 {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
 {isBuyerRole ? 'Invite Buyer' : 'Send Invitation'}
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

