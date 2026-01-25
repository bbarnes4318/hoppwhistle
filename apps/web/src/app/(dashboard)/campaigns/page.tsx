'use client';

import { Plus, Play, Edit } from 'lucide-react';
import { useState } from 'react';

import { CreateCampaignDialog } from '@/components/campaigns/create-campaign-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

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
    window.location.reload();
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 gap-4">
      {/* Compact Controls Bar */}
      <div className="flex items-center justify-between shrink-0">
        <span className="font-mono text-[10px] text-text-muted">
          {mockCampaigns.length} CAMPAIGNS
        </span>
        <Button size="sm" onClick={handleNewCampaign} className="h-7 gap-1">
          <Plus className="h-3 w-3" />
          <span className="font-mono text-[10px]">NEW</span>
        </Button>
      </div>

      {/* Table - Full height */}
      <div className="flex-1 overflow-auto rounded-xl bg-panel/60 border border-white/5">
        <Table>
          <TableHeader>
            <TableRow className="border-white/5">
              <TableHead className="font-mono text-[10px] text-neon-cyan uppercase">Name</TableHead>
              <TableHead className="font-mono text-[10px] text-neon-cyan uppercase">
                Status
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neon-cyan uppercase">Flow</TableHead>
              <TableHead className="font-mono text-[10px] text-neon-cyan uppercase">
                Calls
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neon-cyan uppercase">ASR</TableHead>
              <TableHead className="font-mono text-[10px] text-neon-cyan uppercase">
                Created
              </TableHead>
              <TableHead className="font-mono text-[10px] text-neon-cyan uppercase text-right">
                Actions
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mockCampaigns.map(campaign => (
              <TableRow key={campaign.id} className="border-white/5 hover:bg-neon-cyan/5">
                <TableCell className="font-mono text-xs">{campaign.name}</TableCell>
                <TableCell>
                  <Badge
                    variant={campaign.status === 'active' ? 'default' : 'secondary'}
                    className={cn(
                      'font-mono text-[10px]',
                      campaign.status === 'active' &&
                        'bg-neon-mint/20 text-neon-mint border-neon-mint/30'
                    )}
                  >
                    {campaign.status}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs text-text-muted">{campaign.flow}</TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {campaign.calls.toLocaleString()}
                </TableCell>
                <TableCell className="font-mono text-xs tabular-nums">
                  {(campaign.asr * 100).toFixed(1)}%
                </TableCell>
                <TableCell className="font-mono text-xs text-text-muted">
                  {new Date(campaign.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-text-muted hover:text-neon-cyan"
                    >
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-text-muted hover:text-neon-cyan"
                    >
                      <Edit className="h-3 w-3" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <CreateCampaignDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSuccess={handleCreateSuccess}
      />
    </div>
  );
}
