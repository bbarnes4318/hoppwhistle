'use client';

import { Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

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
import { Label } from '@/components/ui/label';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { apiClient } from '@/lib/api';

interface EditNumberDialogProps {
 open: boolean;
 onOpenChange: (open: boolean) => void;
 numberId: string;
 number: string;
 currentStatus: string;
 currentCampaignId?: string | null;
 currentUserId?: string | null;
 currentCapabilities?: {
 voice?: boolean;
 sms?: boolean;
 mms?: boolean;
 fax?: boolean;
 };
 currentPoolType?: 'POOL' | 'STATIC' | 'BUYER' | null;
 currentPoolStatus?: 'AVAILABLE' | 'ASSIGNED' | 'RESERVED' | null;
 onSuccess?: () => void;
}

interface Campaign {
 id: string;
 name: string;
}

export function EditNumberDialog({
 open,
 onOpenChange,
 numberId,
 number,
 currentStatus,
 currentCampaignId,
 currentUserId,
 currentCapabilities = {},
 currentPoolType,
 currentPoolStatus,
 onSuccess,
}: EditNumberDialogProps) {
 const [loading, setLoading] = useState(false);
 const [loadingCampaigns, setLoadingCampaigns] = useState(false);
 const [loadingUsers, setLoadingUsers] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [campaigns, setCampaigns] = useState<Campaign[]>([]);
 interface User {
 id: string;
 email: string;
 firstName?: string;
 lastName?: string;
 }
 const [users, setUsers] = useState<User[]>([]);
 const caps = typeof currentCapabilities === 'string' ? JSON.parse(currentCapabilities as string) : (currentCapabilities || {});
 const [formData, setFormData] = useState({
 status: (currentStatus || 'ACTIVE').toString().toUpperCase() as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
 campaignId: currentCampaignId || 'none',
 userId: currentUserId || 'none',
 capabilities: {
 voice: caps?.voice ?? true,
 sms: caps?.sms ?? false,
 mms: caps?.mms ?? false,
 fax: caps?.fax ?? false,
 },
 rtbPoolEnabled: currentPoolType === 'POOL',
 });

 useEffect(() => {
 if (open) {
 const caps = typeof currentCapabilities === 'string' ? JSON.parse(currentCapabilities as string) : (currentCapabilities || {});
 setFormData({
 status: (currentStatus || 'ACTIVE').toString().toUpperCase() as 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
 campaignId: currentCampaignId || 'none',
 userId: currentUserId || 'none',
 capabilities: {
 voice: caps?.voice ?? true,
 sms: caps?.sms ?? false,
 mms: caps?.mms ?? false,
 fax: caps?.fax ?? false,
 },
 rtbPoolEnabled: currentPoolType === 'POOL',
 });
 loadCampaigns();
 loadUsers();
 }
 }, [open, currentStatus, currentCampaignId, currentUserId, currentCapabilities, currentPoolType]);

 const loadUsers = async () => {
 setLoadingUsers(true);
 try {
 const response = await apiClient.get<{ data: User[] }>('/api/v1/users');
 if (response.data?.data) {
 setUsers(response.data.data);
 }
 } catch (err) {
 console.error('Failed to load users:', err);
 } finally {
 setLoadingUsers(false);
 }
 };

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

 const handleRtbToggle = (enabled: boolean) => {
 if (enabled) {
 // Mutual exclusivity: Clear campaign when enabling RTB
 setFormData({ ...formData, rtbPoolEnabled: true, campaignId: 'none' });
 } else {
 setFormData({ ...formData, rtbPoolEnabled: false });
 }
 };

 const handleSave = async () => {
 setLoading(true);
 setError(null);

 try {
 const response = await apiClient.patch<{
 id: string;
 number: string;
 status: string;
 campaign: { id: string; name: string } | null;
 }>(`/api/v1/numbers/${numberId}`, {
 status: formData.status,
 campaignId: formData.rtbPoolEnabled || formData.campaignId === 'none' ? null : formData.campaignId,
 userId: formData.userId === 'none' ? null : formData.userId,
 capabilities: formData.capabilities,
 poolType: formData.rtbPoolEnabled ? 'POOL' : 'STATIC',
 poolStatus: formData.rtbPoolEnabled ? 'AVAILABLE' : null,
 });

 if (response.error) {
 throw new Error(response.error.message || 'Failed to update number');
 }

 if (response.data) {
 onSuccess?.();
 onOpenChange(false);
 }
 } catch (err) {
 setError(err instanceof Error ? err.message : 'Failed to update number');
 } finally {
 setLoading(false);
 }
 };

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
 <DialogHeader>
 <DialogTitle>Edit Phone Number</DialogTitle>
 <DialogDescription>Update settings for {number}</DialogDescription>
 </DialogHeader>

 <div className="space-y-4 py-4 overflow-y-auto flex-1 min-h-0">
 <div className="space-y-2">
 <Label htmlFor="status">Status</Label>
 <Select
 value={formData.status}
 onValueChange={(value: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED') =>
 setFormData({ ...formData, status: value })
 }
 disabled={loading}
 >
 <SelectTrigger id="status">
 <SelectValue />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="ACTIVE">Active</SelectItem>
 <SelectItem value="INACTIVE">Inactive</SelectItem>
 <SelectItem value="SUSPENDED">Suspended</SelectItem>
 </SelectContent>
 </Select>
 </div>

 <div className="space-y-2">
 <Label htmlFor="campaign">
 Campaign{' '}
 {formData.rtbPoolEnabled && (
 <span className="text-muted-foreground">(disabled for RTB)</span>
 )}
 </Label>
 <Select
 value={formData.campaignId}
 onValueChange={value => setFormData({ ...formData, campaignId: value })}
 disabled={loading || loadingCampaigns || formData.rtbPoolEnabled}
 >
 <SelectTrigger id="campaign" className={formData.rtbPoolEnabled ? 'opacity-50' : ''}>
 <SelectValue
 placeholder={
 formData.rtbPoolEnabled ? 'N/A (RTB Pool)' : 'Select a campaign (optional)'
 }
 />
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

 <div className="space-y-2">
 <Label htmlFor="assigned-user">Assigned Agent</Label>
 <Select
 value={formData.userId}
 onValueChange={value => setFormData({ ...formData, userId: value })}
 disabled={loading || loadingUsers}
 >
 <SelectTrigger id="assigned-user">
 <SelectValue placeholder="Select an agent (optional)" />
 </SelectTrigger>
 <SelectContent>
 <SelectItem value="none">None</SelectItem>
 {users.map(u => (
 <SelectItem key={u.id} value={u.id}>
 {u.firstName || u.lastName ? `${u.firstName || ''} ${u.lastName || ''}`.trim() : u.email}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 </div>

 <div className="space-y-3">
 <Label>Capabilities</Label>
 <div className="space-y-2">
 <div className="flex items-center space-x-2">
 <Checkbox
 id="edit-voice"
 checked={formData.capabilities.voice}
 onCheckedChange={checked =>
 setFormData({
 ...formData,
 capabilities: { ...formData.capabilities, voice: !!checked },
 })
 }
 />
 <Label htmlFor="edit-voice" className="font-normal cursor-pointer">
 Voice
 </Label>
 </div>
 <div className="flex items-center space-x-2">
 <Checkbox
 id="edit-sms"
 checked={formData.capabilities.sms}
 onCheckedChange={checked =>
 setFormData({
 ...formData,
 capabilities: { ...formData.capabilities, sms: !!checked },
 })
 }
 />
 <Label htmlFor="edit-sms" className="font-normal cursor-pointer">
 SMS
 </Label>
 </div>
 <div className="flex items-center space-x-2">
 <Checkbox
 id="edit-mms"
 checked={formData.capabilities.mms}
 onCheckedChange={checked =>
 setFormData({
 ...formData,
 capabilities: { ...formData.capabilities, mms: !!checked },
 })
 }
 />
 <Label htmlFor="edit-mms" className="font-normal cursor-pointer">
 MMS
 </Label>
 </div>
 <div className="flex items-center space-x-2">
 <Checkbox
 id="edit-fax"
 checked={formData.capabilities.fax}
 onCheckedChange={checked =>
 setFormData({
 ...formData,
 capabilities: { ...formData.capabilities, fax: !!checked },
 })
 }
 />
 <Label htmlFor="edit-fax" className="font-normal cursor-pointer">
 Fax
 </Label>
 </div>
 </div>
 </div>

 {/* RTB Pool Section */}
 <div className="border-t pt-4 mt-4">
 <div className="flex items-center justify-between">
 <div className="space-y-0.5">
 <Label htmlFor="rtb-pool">RTB Pool</Label>
 <p className="text-sm text-muted-foreground">Available for dynamic routing</p>
 </div>
 <Switch
 id="rtb-pool"
 checked={formData.rtbPoolEnabled}
 onCheckedChange={handleRtbToggle}
 disabled={loading}
 />
 </div>
 {formData.rtbPoolEnabled && (
 <p className="text-xs text-muted-foreground mt-2 bg-muted/50 p-2 rounded">
 This number will be leased on-demand for inbound RTB calls. Campaign assignment is
 disabled.
 </p>
 )}
 </div>

 {error && (
 <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>
 )}
 </div>

 <DialogFooter>
 <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
 Cancel
 </Button>
 <Button onClick={handleSave} disabled={loading}>
 {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
 Save Changes
 </Button>
 </DialogFooter>
 </DialogContent>
 </Dialog>
 );
}

