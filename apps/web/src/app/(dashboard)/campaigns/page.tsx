'use client';

import { Plus, Play, Edit } from 'lucide-react';
import { useState } from 'react';

import { CreateCampaignDialog } from '@/components/campaigns/create-campaign-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Mock data
const mockCampaigns = [
  {
    id: '1',
    name: 'Summer Campaign',
    status: 'active',
    flow: 'Default Flow',
    calls: 1234,
    asr: 0.65,
    createdAt: '2024-01-15',
  },
  {
    id: '2',
    name: 'Winter Campaign',
    status: 'paused',
    flow: 'Holiday Flow',
    calls: 567,
    asr: 0.58,
    createdAt: '2024-01-10',
  },
];

export default function CampaignsPage() {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const handleNewCampaign = () => {
    setCreateDialogOpen(true);
  };

  const handleCreateSuccess = () => {
    // Refresh the campaigns list or show success message
    // For now, just reload the page
    window.location.reload();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-3xl font-bold">Campaigns</h1>
          <p className="text-muted-foreground">Manage your call campaigns and flows</p>
        </div>
        <Button onClick={handleNewCampaign}>
          <Plus className="mr-2 h-4 w-4" />
          New Campaign
        </Button>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardHeader className="flex-shrink-0">
          <CardTitle>Campaigns</CardTitle>
          <CardDescription>View and manage all campaigns</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Flow</TableHead>
                <TableHead>Calls</TableHead>
                <TableHead>ASR</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mockCampaigns.map((campaign) => (
                <TableRow key={campaign.id}>
                  <TableCell className="font-medium">{campaign.name}</TableCell>
                  <TableCell>
                    <Badge variant={campaign.status === 'active' ? 'success' : 'secondary'}>
                      {campaign.status}
                    </Badge>
                  </TableCell>
                  <TableCell>{campaign.flow}</TableCell>
                  <TableCell>{campaign.calls.toLocaleString()}</TableCell>
                  <TableCell>{(campaign.asr * 100).toFixed(1)}%</TableCell>
                  <TableCell>{new Date(campaign.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm">
                        <Play className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm">
                        <Edit className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <CreateCampaignDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}

