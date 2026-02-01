'use client';

import { Save, Settings, User } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/use-toast';

export default function SettingsPage() {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  // Form state
  const [profile, setProfile] = useState({
    companyName: 'Acme Insurance',
    contactEmail: 'buyer@acme.com',
    contactPhone: '+15551234567',
  });

  const [notifications, setNotifications] = useState({
    emailAlerts: true,
    lowBalanceAlerts: true,
    dailyReports: false,
    weeklyReports: true,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      // In production, this would save to the API
      await new Promise(r => setTimeout(r, 1000));
      toast({
        title: 'Settings Saved',
        description: 'Your preferences have been updated successfully.',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to save settings. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Settings className="h-6 w-6" />
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Manage your account preferences and notifications
        </p>
      </div>

      {/* Profile Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Profile Information
          </CardTitle>
          <CardDescription>Update your company contact details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="companyName">Company Name</Label>
              <Input
                id="companyName"
                value={profile.companyName}
                onChange={e => setProfile({ ...profile, companyName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactEmail">Contact Email</Label>
              <Input
                id="contactEmail"
                type="email"
                value={profile.contactEmail}
                onChange={e => setProfile({ ...profile, contactEmail: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactPhone">Contact Phone</Label>
              <Input
                id="contactPhone"
                type="tel"
                value={profile.contactPhone}
                onChange={e => setProfile({ ...profile, contactPhone: e.target.value })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Configure your alert and reporting preferences</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Email Alerts</Label>
              <p className="text-sm text-muted-foreground">Receive alerts for important events</p>
            </div>
            <Switch
              checked={notifications.emailAlerts}
              onCheckedChange={checked =>
                setNotifications({ ...notifications, emailAlerts: checked })
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Low Balance Alerts</Label>
              <p className="text-sm text-muted-foreground">
                Notify when lead balance falls below 100
              </p>
            </div>
            <Switch
              checked={notifications.lowBalanceAlerts}
              onCheckedChange={checked =>
                setNotifications({ ...notifications, lowBalanceAlerts: checked })
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Daily Reports</Label>
              <p className="text-sm text-muted-foreground">
                Receive a daily summary of call activity
              </p>
            </div>
            <Switch
              checked={notifications.dailyReports}
              onCheckedChange={checked =>
                setNotifications({ ...notifications, dailyReports: checked })
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Weekly Reports</Label>
              <p className="text-sm text-muted-foreground">Receive a weekly performance summary</p>
            </div>
            <Switch
              checked={notifications.weeklyReports}
              onCheckedChange={checked =>
                setNotifications({ ...notifications, weeklyReports: checked })
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}
