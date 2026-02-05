'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// OpenAI compatible voices (commonly used)
const VOICES = [
  { id: 'alloy', name: 'Alloy', description: 'Neutral, balanced' },
  { id: 'echo', name: 'Echo', description: 'Warm, conversational' },
  { id: 'fable', name: 'Fable', description: 'British, expressive' },
  { id: 'onyx', name: 'Onyx', description: 'Deep, authoritative' },
  { id: 'nova', name: 'Nova', description: 'Bright, friendly' },
  { id: 'shimmer', name: 'Shimmer', description: 'Soft, pleasant' },
];

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
];

interface PhoneNumber {
  id: string;
  number: string;
  displayName: string | null;
}

const campaignSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  assistantName: z.string().min(1, 'Assistant name is required').max(50),
  voiceId: z.string().min(1, 'Voice is required'),
  firstMessage: z.string().min(10, 'First message is required').max(500),
  systemPrompt: z.string().max(5000).optional(),
  phoneNumberId: z.string().min(1, 'Phone number is required'),
  maxConcurrent: z.number().min(1).max(10),
  callsPerMinute: z.number().min(1).max(60),
  scheduleEnabled: z.boolean(),
  timezone: z.string(),
});

type CampaignFormValues = z.infer<typeof campaignSchema>;

export default function NewCampaignPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([]);
  const [loadingNumbers, setLoadingNumbers] = useState(true);

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignSchema),
    defaultValues: {
      name: '',
      description: '',
      assistantName: 'AI Agent',
      voiceId: 'alloy',
      firstMessage:
        'Hello! This is a quick call regarding your recent inquiry. Is this a good time to speak?',
      systemPrompt: '',
      phoneNumberId: '',
      maxConcurrent: 1,
      callsPerMinute: 10,
      scheduleEnabled: false,
      timezone: 'America/New_York',
    },
  });

  useEffect(() => {
    const fetchPhoneNumbers = async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/numbers`, {
          credentials: 'include',
        });
        if (!res.ok) throw new Error('Failed to fetch phone numbers');
        const data = await res.json();
        // Filter to only active numbers
        const active = (data.data || data).filter((n: { status: string }) => n.status === 'ACTIVE');
        setPhoneNumbers(active);
      } catch (error) {
        console.error('Error fetching phone numbers:', error);
        toast({
          title: 'Warning',
          description:
            'Could not load phone numbers. Please ensure you have numbers in your inventory.',
          variant: 'destructive',
        });
      } finally {
        setLoadingNumbers(false);
      }
    };

    void fetchPhoneNumbers();
  }, [toast]);

  const onSubmit = async (values: CampaignFormValues) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to create campaign');
      }

      const campaign = await res.json();

      toast({
        title: 'Campaign Created',
        description: 'Your AI campaign has been created. Now upload your contacts.',
      });

      router.push(`/ai-campaigns/${campaign.id}`);
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create campaign',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Create AI Campaign</h1>
          <p className="text-muted-foreground">Set up a new automated outbound calling campaign</p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={e => void form.handleSubmit(onSubmit)(e)} className="space-y-6">
          {/* Basic Info */}
          <Card>
            <CardHeader>
              <CardTitle>Campaign Details</CardTitle>
              <CardDescription>Basic information about your campaign</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Campaign Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Q1 Lead Follow-up" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Brief description of the campaign purpose..."
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* AI Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>AI Assistant Configuration</CardTitle>
              <CardDescription>Configure how your AI assistant behaves on calls</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="assistantName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Assistant Name</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g., Sarah" {...field} />
                    </FormControl>
                    <FormDescription>
                      The name your AI will use when introducing itself
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="voiceId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Voice</FormLabel>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a voice" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {VOICES.map(voice => (
                          <SelectItem key={voice.id} value={voice.id}>
                            <span className="font-medium">{voice.name}</span>
                            <span className="text-muted-foreground ml-2">
                              - {voice.description}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="firstMessage"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Opening Message</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="The first thing the AI says when the call connects..."
                        className="min-h-[100px]"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Use {'{name}'} to personalize with contact name
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="systemPrompt"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Conversation Script / Instructions (Optional)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Detailed instructions for how the AI should handle the conversation..."
                        className="min-h-[150px] font-mono text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormDescription>
                      Provide detailed guidance for the AI&apos;s behavior, objection handling, and
                      goals
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Phone & Calling Config */}
          <Card>
            <CardHeader>
              <CardTitle>Calling Configuration</CardTitle>
              <CardDescription>Configure how calls are placed</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormField
                control={form.control}
                name="phoneNumberId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Caller ID Number</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      disabled={loadingNumbers}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              loadingNumbers
                                ? 'Loading numbers...'
                                : phoneNumbers.length === 0
                                  ? 'No numbers available'
                                  : 'Select a phone number'
                            }
                          />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {phoneNumbers.map(num => (
                          <SelectItem key={num.id} value={num.id}>
                            {num.number}
                            {num.displayName && (
                              <span className="text-muted-foreground ml-2">
                                ({num.displayName})
                              </span>
                            )}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      The phone number that will appear on caller ID
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid gap-6 md:grid-cols-2">
                <FormField
                  control={form.control}
                  name="maxConcurrent"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Max Concurrent Calls: {field.value}</FormLabel>
                      <FormControl>
                        <Slider
                          min={1}
                          max={10}
                          step={1}
                          value={[field.value]}
                          onValueChange={([value]) => field.onChange(value)}
                        />
                      </FormControl>
                      <FormDescription>Maximum simultaneous calls (1-10)</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="callsPerMinute"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Calls Per Minute: {field.value}</FormLabel>
                      <FormControl>
                        <Slider
                          min={1}
                          max={60}
                          step={1}
                          value={[field.value]}
                          onValueChange={([value]) => field.onChange(value)}
                        />
                      </FormControl>
                      <FormDescription>Rate limit for outbound calls</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <FormLabel>Schedule Calling</FormLabel>
                  <FormDescription>Only place calls during specific hours</FormDescription>
                </div>
                <FormField
                  control={form.control}
                  name="scheduleEnabled"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              {form.watch('scheduleEnabled') && (
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select timezone" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {TIMEZONES.map(tz => (
                            <SelectItem key={tz} value={tz}>
                              {tz}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-4">
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Campaign
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
