'use client';

import { Plus, PhoneOutgoing, Pause, Play, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback } from 'react';

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

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface AICampaign {
  id: string;
  name: string;
  description: string | null;
  status: 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'COMPLETED';
  assistantName: string;
  createdAt: string;
  updatedAt: string;
}

interface CampaignListResponse {
  data: AICampaign[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

const statusColors: Record<string, string> = {
  DRAFT: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  READY: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  RUNNING: 'bg-green-500/20 text-green-400 border-green-500/30',
  PAUSED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  COMPLETED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const statusLabels: Record<string, string> = {
  DRAFT: 'Draft',
  READY: 'Ready',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
};

export default function AICampaignsPage() {
  const router = useRouter();
  const { toast } = useToast();
  const [campaigns, setCampaigns] = useState<AICampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns`, {
        credentials: 'include',
      });

      if (!res.ok) throw new Error('Failed to fetch campaigns');

      const data: CampaignListResponse = await res.json();
      setCampaigns(data.data);
    } catch (error) {
      console.error('Error fetching campaigns:', error);
      toast({
        title: 'Error',
        description: 'Failed to load campaigns',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchCampaigns();
  }, [fetchCampaigns]);

  const handleStartCampaign = async (campaignId: string) => {
    setActionLoading(campaignId);
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}/start`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to start campaign');
      }

      toast({
        title: 'Campaign Started',
        description: 'The AI campaign is now running',
      });
      void fetchCampaigns();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to start campaign',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handlePauseCampaign = async (campaignId: string) => {
    setActionLoading(campaignId);
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}/pause`, {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) throw new Error('Failed to pause campaign');

      toast({
        title: 'Campaign Paused',
        description: 'The AI campaign has been paused',
      });
      void fetchCampaigns();
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to pause campaign',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteCampaign = async (campaignId: string) => {
    if (!confirm('Are you sure you want to delete this campaign?')) return;

    setActionLoading(campaignId);
    try {
      const res = await fetch(`${API_URL}/api/v1/ai-campaigns/${campaignId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to delete campaign');
      }

      toast({
        title: 'Campaign Deleted',
        description: 'The campaign has been deleted',
      });
      void fetchCampaigns();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete campaign',
        variant: 'destructive',
      });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Campaigns</h1>
          <p className="text-muted-foreground">
            Manage your automated AI outbound calling campaigns
          </p>
        </div>
        <Button onClick={() => router.push('/ai-campaigns/new')} className="gap-2">
          <Plus className="h-4 w-4" />
          New Campaign
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-green-500/10 to-emerald-500/10 border-green-500/20">
          <CardHeader className="pb-2">
            <CardDescription>Running</CardDescription>
            <CardTitle className="text-2xl text-green-400">
              {campaigns.filter(c => c.status === 'RUNNING').length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 border-blue-500/20">
          <CardHeader className="pb-2">
            <CardDescription>Ready</CardDescription>
            <CardTitle className="text-2xl text-blue-400">
              {campaigns.filter(c => c.status === 'READY').length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-gradient-to-br from-yellow-500/10 to-amber-500/10 border-yellow-500/20">
          <CardHeader className="pb-2">
            <CardDescription>Paused</CardDescription>
            <CardTitle className="text-2xl text-yellow-400">
              {campaigns.filter(c => c.status === 'PAUSED').length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500/10 to-violet-500/10 border-purple-500/20">
          <CardHeader className="pb-2">
            <CardDescription>Completed</CardDescription>
            <CardTitle className="text-2xl text-purple-400">
              {campaigns.filter(c => c.status === 'COMPLETED').length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Campaign Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Campaigns</CardTitle>
          <CardDescription>View and manage your AI calling campaigns</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : campaigns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <PhoneOutgoing className="h-12 w-12 text-muted-foreground/50 mb-4" />
              <h3 className="text-lg font-semibold">No Campaigns Yet</h3>
              <p className="text-muted-foreground mb-4">
                Create your first AI outbound calling campaign to get started.
              </p>
              <Button onClick={() => router.push('/ai-campaigns/new')}>
                <Plus className="h-4 w-4 mr-2" />
                Create Campaign
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>AI Assistant</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map(campaign => (
                  <TableRow
                    key={campaign.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => router.push(`/ai-campaigns/${campaign.id}`)}
                  >
                    <TableCell>
                      <div>
                        <div className="font-medium">{campaign.name}</div>
                        {campaign.description && (
                          <div className="text-sm text-muted-foreground truncate max-w-xs">
                            {campaign.description}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusColors[campaign.status]}>
                        {statusLabels[campaign.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>{campaign.assistantName}</TableCell>
                    <TableCell>{new Date(campaign.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={actionLoading === campaign.id}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {campaign.status === 'RUNNING' ? (
                            <DropdownMenuItem
                              onClick={e => {
                                e.stopPropagation();
                                void handlePauseCampaign(campaign.id);
                              }}
                            >
                              <Pause className="h-4 w-4 mr-2" />
                              Pause
                            </DropdownMenuItem>
                          ) : (
                            campaign.status !== 'COMPLETED' && (
                              <DropdownMenuItem
                                onClick={e => {
                                  e.stopPropagation();
                                  void handleStartCampaign(campaign.id);
                                }}
                              >
                                <Play className="h-4 w-4 mr-2" />
                                Start
                              </DropdownMenuItem>
                            )
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={e => {
                              e.stopPropagation();
                              void handleDeleteCampaign(campaign.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
