'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CampaignForm } from '@/components/buyer/CampaignForm';

export default function NewCampaignPage() {
  const [buyerId, setBuyerId] = useState<string | null>(null);

  useEffect(() => {
    const fetchBuyerId = async () => {
      try {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setBuyerId(data?.data?.buyerId || 'demo-buyer');
        }
      } catch (error) {
        console.error('Failed to get buyer ID:', error);
        setBuyerId('demo-buyer');
      }
    };
    void fetchBuyerId();
  }, []);

  if (!buyerId) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <Link href="/buyer/campaigns">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">New Campaign</h1>
          <p className="text-sm text-muted-foreground">Configure a new call routing endpoint</p>
        </div>
      </div>

      {/* Form */}
      <CampaignForm buyerId={buyerId} />
    </div>
  );
}
