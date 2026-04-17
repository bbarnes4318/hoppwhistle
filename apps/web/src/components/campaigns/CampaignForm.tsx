'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { PricingRule, PricingRulesEditor } from './PricingRulesEditor';
import { HoursOfOperation, ScheduleEditor } from './ScheduleEditor';
import { StateSelector } from './StateSelector';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
 Form,
 FormControl,
 FormDescription,
 FormField,
 FormItem,
 FormLabel,
 FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import {
 Select,
 SelectContent,
 SelectItem,
 SelectTrigger,
 SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { useToast } from '@/components/ui/use-toast';

// Zod Schema for form validation
const campaignFormSchema = z.object({
 name: z.string().min(1, 'Name is required').max(100),
 type: z.enum(['SIP', 'PSTN', 'WEBRTC']),
 destination: z.string().min(1, 'Destination is required'),
 priority: z.number().min(0).max(100),
 maxConcurrency: z.number().min(1).max(100),
 maxCap: z.number().min(0),
 capPeriod: z.enum(['HOUR', 'DAY', 'MONTH']),
 acceptedStates: z.array(z.string()),
 hoursOfOperation: z.any().nullable(), // JSON - validated separately
 timezone: z.string(),
 basePrice: z.number().min(0),
 pricingRules: z.array(z.any()).nullable(), // JSON - validated separately
});

type CampaignFormValues = z.infer<typeof campaignFormSchema>;

interface CampaignFormProps {
 buyerId: string;
 initialData?: CampaignFormValues & { id?: string };
 onSuccess?: () => void;
}

const TIMEZONES = [
 'America/New_York',
 'America/Chicago',
 'America/Denver',
 'America/Los_Angeles',
 'America/Phoenix',
 'America/Anchorage',
 'Pacific/Honolulu',
];

export function CampaignForm({ buyerId, initialData, onSuccess }: CampaignFormProps) {
 const router = useRouter();
 const { toast } = useToast();
 const [submitting, setSubmitting] = useState(false);

 const isEditing = !!initialData?.id;

 const form = useForm<CampaignFormValues>({
 resolver: zodResolver(campaignFormSchema),
 defaultValues: initialData || {
 name: '',
 type: 'PSTN',
 destination: '',
 priority: 0,
 maxConcurrency: 10,
 maxCap: 0,
 capPeriod: 'DAY',
 acceptedStates: [],
 hoursOfOperation: null,
 timezone: 'America/New_York',
 basePrice: 30,
 pricingRules: null,
 },
 });

 const onSubmit = async (data: CampaignFormValues) => {
 setSubmitting(true);
 try {
 const endpoint = isEditing
 ? `/api/v1/buyers/${buyerId}/targets/${initialData?.id}`
 : `/api/v1/buyers/${buyerId}/targets`;

 const method = isEditing ? 'PATCH' : 'POST';

 const response = await fetch(endpoint, {
 method,
 headers: { 'Content-Type': 'application/json' },
 credentials: 'include',
 body: JSON.stringify({
 ...data,
 // Ensure numeric types are sent correctly
 basePrice: Number(data.basePrice),
 maxConcurrency: Number(data.maxConcurrency),
 maxCap: Number(data.maxCap),
 priority: Number(data.priority),
 }),
 });

 if (!response.ok) {
 const error = await response.json();
 throw new Error(error?.error?.message || 'Failed to save campaign');
 }

 toast({
 title: isEditing ? 'Campaign Updated' : 'Campaign Created',
 description: `${data.name} has been ${isEditing ? 'updated' : 'created'} successfully.`,
 });

 onSuccess?.();
 router.push('/campaigns');
 } catch (error) {
 console.error('Failed to save campaign:', error);
 toast({
 title: 'Error',
 description: error instanceof Error ? error.message : 'Failed to save campaign',
 variant: 'destructive',
 });
 } finally {
 setSubmitting(false);
 }
 };

 return (
 <Form {...form}>
 <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
 {/* Endpoint Details */}
 <Card>
 <CardHeader>
 <CardTitle>Endpoint Details</CardTitle>
 <CardDescription>
 Configure how calls will be routed to your call center
 </CardDescription>
 </CardHeader>
 <CardContent className="grid gap-6 sm:grid-cols-2">
 {/* Name */}
 <FormField
 control={form.control}
 name="name"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Campaign Name</FormLabel>
 <FormControl>
 <Input placeholder="e.g., Primary Call Center" {...field} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 {/* Type */}
 <FormField
 control={form.control}
 name="type"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Endpoint Type</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger>
 <SelectValue placeholder="Select type" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 <SelectItem value="PSTN">PSTN (Phone Number)</SelectItem>
 <SelectItem value="SIP">SIP URI</SelectItem>
 <SelectItem value="WEBRTC">WebRTC</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />

 {/* Destination */}
 <FormField
 control={form.control}
 name="destination"
 render={({ field }) => (
 <FormItem className="sm:col-span-2">
 <FormLabel>Destination</FormLabel>
 <FormControl>
 <Input
 placeholder={
 form.watch('type') === 'SIP' ? 'sip:user@domain.com' : '+15551234567'
 }
 {...field}
 />
 </FormControl>
 <FormDescription>
 {form.watch('type') === 'SIP'
 ? 'Your SIP URI for receiving calls'
 : 'The phone number where calls will be routed'}
 </FormDescription>
 <FormMessage />
 </FormItem>
 )}
 />

 {/* Priority */}
 <FormField
 control={form.control}
 name="priority"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Priority</FormLabel>
 <FormControl>
 <div className="pt-2">
 <Slider
 min={0}
 max={100}
 step={1}
 value={[field.value]}
 onValueChange={([val]) => field.onChange(val)}
 />
 <p className="text-sm text-muted-foreground mt-1">
 Priority: {field.value} (lower = higher priority)
 </p>
 </div>
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />

 {/* Max Concurrency */}
 <FormField
 control={form.control}
 name="maxConcurrency"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Max Concurrent Calls</FormLabel>
 <FormControl>
 <div className="pt-2">
 <Slider
 min={1}
 max={100}
 step={1}
 value={[field.value]}
 onValueChange={([val]) => field.onChange(val)}
 />
 <p className="text-sm text-muted-foreground mt-1">
 {field.value} simultaneous calls
 </p>
 </div>
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </CardContent>
 </Card>

 {/* Capacity Limits */}
 <Card>
 <CardHeader>
 <CardTitle>Capacity Limits</CardTitle>
 <CardDescription>Set limits on how many calls you can receive</CardDescription>
 </CardHeader>
 <CardContent className="grid gap-6 sm:grid-cols-2">
 {/* Max Cap */}
 <FormField
 control={form.control}
 name="maxCap"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Maximum Calls</FormLabel>
 <FormControl>
 <Input
 type="number"
 min={0}
 placeholder="0 = unlimited"
 {...field}
 onChange={e => field.onChange(parseInt(e.target.value, 10) || 0)}
 />
 </FormControl>
 <FormDescription>0 means no limit</FormDescription>
 <FormMessage />
 </FormItem>
 )}
 />

 {/* Cap Period */}
 <FormField
 control={form.control}
 name="capPeriod"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Cap Period</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger>
 <SelectValue placeholder="Select period" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 <SelectItem value="HOUR">Per Hour</SelectItem>
 <SelectItem value="DAY">Per Day</SelectItem>
 <SelectItem value="MONTH">Per Month</SelectItem>
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />
 </CardContent>
 </Card>

 {/* Geo-Routing */}
 <Card>
 <CardHeader>
 <CardTitle>Geo-Routing</CardTitle>
 <CardDescription>Choose which states you want to accept calls from</CardDescription>
 </CardHeader>
 <CardContent>
 <FormField
 control={form.control}
 name="acceptedStates"
 render={({ field }) => (
 <FormItem>
 <FormControl>
 <StateSelector value={field.value} onChange={field.onChange} />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </CardContent>
 </Card>

 {/* Schedule */}
 <Card>
 <CardHeader>
 <CardTitle>Operating Hours</CardTitle>
 <CardDescription>Define when you are available to receive calls</CardDescription>
 </CardHeader>
 <CardContent className="space-y-4">
 {/* Timezone */}
 <FormField
 control={form.control}
 name="timezone"
 render={({ field }) => (
 <FormItem>
 <FormLabel>Timezone</FormLabel>
 <Select onValueChange={field.onChange} value={field.value}>
 <FormControl>
 <SelectTrigger className="w-64">
 <SelectValue placeholder="Select timezone" />
 </SelectTrigger>
 </FormControl>
 <SelectContent>
 {TIMEZONES.map(tz => (
 <SelectItem key={tz} value={tz}>
 {tz.replace('_', ' ')}
 </SelectItem>
 ))}
 </SelectContent>
 </Select>
 <FormMessage />
 </FormItem>
 )}
 />

 <Separator />

 {/* Schedule Editor */}
 <FormField
 control={form.control}
 name="hoursOfOperation"
 render={({ field }) => (
 <FormItem>
 <FormControl>
 <ScheduleEditor
 value={field.value as HoursOfOperation | null}
 onChange={field.onChange}
 />
 </FormControl>
 <FormMessage />
 </FormItem>
 )}
 />
 </CardContent>
 </Card>

 {/* Pricing */}
 <Card>
 <CardHeader>
 <CardTitle>Pricing & Bid Rules</CardTitle>
 <CardDescription>Set your bid price and adjustment rules</CardDescription>
 </CardHeader>
 <CardContent>
 <PricingRulesEditor
 basePrice={form.watch('basePrice')}
 onBasePriceChange={val => form.setValue('basePrice', val)}
 rules={(form.watch('pricingRules') as PricingRule[]) || []}
 onRulesChange={rules =>
 form.setValue('pricingRules', rules.length > 0 ? rules : null)
 }
 />
 </CardContent>
 </Card>

 {/* Actions */}
 <div className="flex justify-end gap-4">
 <Button type="button" variant="outline" onClick={() => router.push('/campaigns')}>
 Cancel
 </Button>
 <Button type="submit" disabled={submitting}>
 {submitting ? 'Saving...' : isEditing ? 'Update Campaign' : 'Create Campaign'}
 </Button>
 </div>
 </form>
 </Form>
 );
}

