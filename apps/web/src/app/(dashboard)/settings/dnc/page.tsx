'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Plus, Upload, Trash2, Loader2 } from 'lucide-react';
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
    loadDncLists();
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
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        // TODO: Implement actual upload logic
        alert(`DNC list upload functionality coming soon. Selected file: ${file.name}`);
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
        loadDncLists();
      } else {
        alert(`Failed to delete DNC list: ${response.error.message}`);
      }
    } catch (err) {
      alert(`Failed to delete DNC list: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0 mb-4">
        <div>
          <h1 className="text-3xl font-bold">Do Not Call Lists</h1>
          <p className="text-muted-foreground">Manage DNC lists and compliance</p>
        </div>
        <Button onClick={handleUploadList}>
          <Upload className="mr-2 h-4 w-4" />
          Upload List
        </Button>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden min-h-0">
        <CardHeader className="flex-shrink-0">
          <CardTitle>DNC Lists</CardTitle>
          <CardDescription>View and manage your Do Not Call lists</CardDescription>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : dncLists.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">No DNC lists found</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Entries</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dncLists.map((list) => (
                  <TableRow key={list.id}>
                    <TableCell className="font-medium">{list.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{list.type.toLowerCase()}</Badge>
                    </TableCell>
                    <TableCell>{list.entryCount.toLocaleString()}</TableCell>
                    <TableCell>
                      <Badge variant={list.status === 'ACTIVE' ? 'success' : 'secondary'}>
                        {list.status.toLowerCase()}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(list.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteList(list.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
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

