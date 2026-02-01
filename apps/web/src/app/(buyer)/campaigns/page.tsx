'use client';

import {
  Clock,
  Edit,
  Globe,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Target,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';

interface Campaign {
  id: string;
  name: string;
  type: 'SIP' | 'PSTN' | 'WEBRTC';
  destination: string;
  priority: number;
  status: 'ACTIVE' | 'INACTIVE' | 'FAILED';
  maxCap: number;
  capPeriod: 'HOUR' | 'DAY' | 'MONTH';
  maxConcurrency: number;
  acceptedStates: string[];
  isNational: boolean;
  hoursOfOperation: unknown | null;
  timezone: string | null;
  basePrice: number;
  pricingRules: unknown[] | null;
  createdAt: string;
  updatedAt: string;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [buyerId, setBuyerId] = useState<string | null>(null);
  const { toast } = useToast();

  // Fetch buyerId from user context
  useEffect(() => {
    const fetchBuyerId = async () => {
      try {
        const response = await fetch('/api/v1/auth/me', {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          // For now, using first buyer from user's tenant
          // In production, this would come from user.buyerId
          setBuyerId(data?.data?.buyerId || 'demo-buyer');
        }
      } catch (error) {
        console.error('Failed to get buyer ID:', error);
      }
    };
    void fetchBuyerId();
  }, []);

  // Fetch campaigns
  const fetchCampaigns = async () => {
    if (!buyerId) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/v1/buyers/${buyerId}/targets`, {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        setCampaigns(data.data || []);
      } else {
        // Demo data if API fails
        setCampaigns([
          {
            id: '1',
            name: 'Primary Call Center',
            type: 'PSTN',
            destination: '+15551234567',
            priority: 0,
            status: 'ACTIVE',
            maxCap: 100,
            capPeriod: 'DAY',
            maxConcurrency: 10,
            acceptedStates: [],
            isNational: true,
            hoursOfOperation: null,
            timezone: 'America/New_York',
            basePrice: 30,
            pricingRules: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          {
            id: '2',
            name: 'Florida Office',
            type: 'SIP',
            destination: 'sip:florida@callcenter.com',
            priority: 1,
            status: 'ACTIVE',
            maxCap: 50,
            capPeriod: 'DAY',
            maxConcurrency: 5,
            acceptedStates: ['FL', 'GA', 'AL'],
            isNational: false,
            hoursOfOperation: { mon: [{ start: '09:00', end: '17:00' }] },
            timezone: 'America/New_York',
            basePrice: 35,
            pricingRules: [{ field: 'age', op: 'gt', val: 65, adjustment: '+5.00' }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ]);
      }
    } catch (error) {
      console.error('Failed to fetch campaigns:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchCampaigns();
  }, [buyerId]);

  const toggleStatus = async (campaign: Campaign) => {
    if (!buyerId) return;

    const newStatus = campaign.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      const response = await fetch(`/api/v1/buyers/${buyerId}/targets/${campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        setCampaigns(campaigns.map(c => (c.id === campaign.id ? { ...c, status: newStatus } : c)));
        toast({
          title: 'Status Updated',
          description: `${campaign.name} is now ${newStatus.toLowerCase()}.`,
        });
      }
    } catch (error) {
      console.error('Failed to toggle status:', error);
      toast({
        title: 'Error',
        description: 'Failed to update campaign status.',
        variant: 'destructive',
      });
    }
  };

  const deleteCampaign = async (campaign: Campaign) => {
    if (!buyerId) return;
    if (!confirm(`Are you sure you want to delete "${campaign.name}"?`)) return;

    try {
      const response = await fetch(`/api/v1/buyers/${buyerId}/targets/${campaign.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (response.ok) {
        setCampaigns(campaigns.filter(c => c.id !== campaign.id));
        toast({
          title: 'Campaign Deleted',
          description: `${campaign.name} has been removed.`,
        });
      }
    } catch (error) {
      console.error('Failed to delete campaign:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete campaign.',
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return (
          <Badge className="bg-green-500/10 text-green-500 hover:bg-green-500/20">Active</Badge>
        );
      case 'INACTIVE':
        return <Badge variant="secondary">Inactive</Badge>;
      case 'FAILED':
        return <Badge variant="destructive">Failed</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6" />
            Campaigns
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage your call routing targets and endpoints
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchCampaigns} title="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Link href="/buyer/campaigns/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Campaign
            </Button>
          </Link>
        </div>
      </div>

      {/* Campaigns Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Geo</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead className="text-right">Bid</TableHead>
                <TableHead className="text-right">Cap</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                // Loading skeletons
                Array.from({ length: 3 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell>
                      <Skeleton className="h-5 w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-24" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-16" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-5 w-8" />
                    </TableCell>
                  </TableRow>
                ))
              ) : campaigns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                    <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>No campaigns configured yet.</p>
                    <Link href="/buyer/campaigns/new">
                      <Button variant="link" className="mt-2">
                        Create your first campaign
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              ) : (
                campaigns.map(campaign => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{campaign.name}</p>
                        <p className="text-xs text-muted-foreground">
                          Priority: {campaign.priority}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{getStatusBadge(campaign.status)}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{campaign.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                        {campaign.destination.length > 25
                          ? campaign.destination.substring(0, 25) + '...'
                          : campaign.destination}
                      </code>
                    </TableCell>
                    <TableCell>
                      {campaign.isNational ? (
                        <span className="flex items-center gap-1 text-sm">
                          <Globe className="h-3 w-3" />
                          National
                        </span>
                      ) : (
                        <span className="text-sm">
                          {campaign.acceptedStates.slice(0, 3).join(', ')}
                          {campaign.acceptedStates.length > 3 && (
                            <span className="text-muted-foreground">
                              {' '}
                              +{campaign.acceptedStates.length - 3}
                            </span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {campaign.hoursOfOperation === null ? (
                        <span className="text-sm text-muted-foreground">24/7</span>
                      ) : (
                        <span className="flex items-center gap-1 text-sm">
                          <Clock className="h-3 w-3" />
                          Scheduled
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${campaign.basePrice.toFixed(2)}
                      {campaign.pricingRules && campaign.pricingRules.length > 0 && (
                        <span className="text-xs text-muted-foreground block">
                          +{campaign.pricingRules.length} rules
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {campaign.maxCap === 0 ? (
                        <span className="text-muted-foreground">∞</span>
                      ) : (
                        <span>
                          {campaign.maxCap}/{campaign.capPeriod.toLowerCase()}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link href={`/buyer/campaigns/${campaign.id}`}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleStatus(campaign)}>
                            {campaign.status === 'ACTIVE' ? (
                              <>
                                <Pause className="h-4 w-4 mr-2" />
                                Pause
                              </>
                            ) : (
                              <>
                                <Play className="h-4 w-4 mr-2" />
                                Activate
                              </>
                            )}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => deleteCampaign(campaign)}
                            className="text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
