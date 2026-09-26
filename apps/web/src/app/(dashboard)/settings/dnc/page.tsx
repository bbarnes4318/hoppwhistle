'use client';

import { Upload, Trash2, Loader2 } from 'lucide-react';
import { useState, useEffect } from 'react';

import {
  EmptyState,
  Panel,
  PanelBody,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from '@/components/domain';
import { PageHeader } from '@/components/layout/page-header';
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
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from '@/components/ui/use-toast';
import { apiClient } from '@/lib/api';

interface DncList {
  id: string;
  name: string;
  type: string;
  status: string;
  entryCount: number;
  createdAt: string;
  updatedAt: string;
}

export default function DncPage() {
  const [dncLists, setDncLists] = useState<DncList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadDncLists();
  }, []);

  const loadDncLists = async () => {
    setLoading(true);
    try {
      const response = await apiClient.get<{ data: DncList[] }>('/api/v1/compliance/dnc-lists');
      if (response.data?.data) {
        setDncLists(response.data.data);
      }
    } catch (err) {
      console.error('Failed to load DNC lists:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleUploadList = () => {
    // Create a file input element
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.txt';
    input.onchange = e => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // TODO: Implement actual upload logic
        toast({
          title: 'Feature Coming Soon',
          description: `DNC list upload functionality coming soon. Selected file: ${file.name}`,
        });
      }
    };
    input.click();
  };

  const handleDeleteList = async (listId: string) => {
    if (!confirm('Are you sure you want to delete this DNC list? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await apiClient.delete(`/api/v1/compliance/dnc-lists/${listId}`);
      if (!response.error) {
        void loadDncLists();
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: `Failed to delete DNC list: ${response.error.message}`,
        });
      }
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: `Failed to delete DNC list: ${err instanceof Error ? err.message : 'Unknown error'}`,
      });
    }
  };

  return (
    <div className="page-canvas">
      <PageHeader
        description="Manage DNC lists and compliance"
        actions={
          <Button onClick={handleUploadList}>
            <Upload className="h-4 w-4" />
            Upload List
          </Button>
        }
      />

      <Panel className="min-w-0">
        <PanelHeader>
          <PanelTitle>DNC Lists</PanelTitle>
          <PanelDescription>View and manage your Do Not Call lists</PanelDescription>
        </PanelHeader>
        <PanelBody flush className="overflow-x-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-ink-3" />
            </div>
          ) : dncLists.length === 0 ? (
            <EmptyState headline="No DNC lists found" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Entries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dncLists.map(list => (
                  <TableRow key={list.id}>
                    <TableCell className="font-medium text-ink">{list.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{list.type.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell className="t-num text-right text-ink">
                      {list.entryCount.toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={list.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {list.status.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell className="t-data whitespace-nowrap text-ink-2">
                      {new Date(list.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <Tooltip content="Delete list" align="end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-dropped-tint hover:text-dropped-ink"
                          onClick={() => void handleDeleteList(list.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}
