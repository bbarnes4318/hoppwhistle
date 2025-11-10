'use client';

import { Info } from 'lucide-react';
import { useState, useEffect } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { apiClient } from '@/lib/api';

export function DemoToggle() {
  const [demoMode, setDemoMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Check demo mode status from localStorage
    const stored = localStorage.getItem('demoMode');
    if (stored === 'true') {
      setDemoMode(true);
    }
  }, []);

  const handleToggle = async (enabled: boolean) => {
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post<{ enabled: boolean; tenantId: string | null; message: string }>('/api/v1/demo/toggle', { enabled });
      
      if (response.error) {
        // Check if it's a connection error (backend not running)
        if (response.error.message?.includes('ERR_CONNECTION_REFUSED') || 
            response.error.message?.includes('Failed to fetch') ||
            response.error.message?.includes('NetworkError')) {
          // Backend isn't running - use localStorage only
          setDemoMode(enabled);
          if (enabled) {
            localStorage.setItem('demoMode', 'true');
            localStorage.setItem('demoTenantId', 'demo-tenant');
          } else {
            localStorage.removeItem('demoMode');
            localStorage.removeItem('demoTenantId');
          }
          setLoading(false);
          setError('Backend API not available. Using local demo mode.');
          // Reload after a short delay to show the message
          setTimeout(() => {
            window.location.reload();
          }, 1000);
          return;
        }
        throw new Error(response.error.message || 'Failed to toggle demo mode');
      }
      
      const data = response.data;
      if (data) {
        if (data.enabled && data.tenantId) {
          // Activate demo mode
          setDemoMode(true);
          localStorage.setItem('demoMode', 'true');
          localStorage.setItem('demoTenantId', data.tenantId);
          // Reload page to show demo data
          window.location.reload();
        } else {
          // Deactivate demo mode
          setDemoMode(false);
          localStorage.removeItem('demoMode');
          localStorage.removeItem('demoTenantId');
          // Reload page to show live data
          window.location.reload();
        }
      } else {
        // If no data but no error, assume success
        setDemoMode(enabled);
        if (enabled) {
          localStorage.setItem('demoMode', 'true');
        } else {
          localStorage.removeItem('demoMode');
          localStorage.removeItem('demoTenantId');
        }
        window.location.reload();
      }
    } catch (err) {
      // Handle network errors gracefully
      const errorMessage = err instanceof Error ? err.message : 'Failed to toggle demo mode';
      if (errorMessage.includes('ERR_CONNECTION_REFUSED') || 
          errorMessage.includes('Failed to fetch') ||
          errorMessage.includes('NetworkError')) {
        // Backend isn't running - use localStorage only
        setDemoMode(enabled);
        if (enabled) {
          localStorage.setItem('demoMode', 'true');
          localStorage.setItem('demoTenantId', 'demo-tenant');
        } else {
          localStorage.removeItem('demoMode');
          localStorage.removeItem('demoTenantId');
        }
        setError('Backend API not available. Using local demo mode.');
        setTimeout(() => {
          window.location.reload();
        }, 1000);
      } else {
        setError(errorMessage);
        setLoading(false);
      }
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="demo-mode">Demo Mode</Label>
          <p className="text-sm text-muted-foreground">
            Switch to demo data for presentations
          </p>
        </div>
        <Switch
          id="demo-mode"
          checked={demoMode}
          onCheckedChange={handleToggle}
          disabled={loading}
        />
      </div>
      
      {demoMode && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Demo mode is active. You're viewing synthetic data generated for demonstration purposes.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

