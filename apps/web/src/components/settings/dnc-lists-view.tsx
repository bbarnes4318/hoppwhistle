'use client';

import { Plus, Trash2, Loader2 } from 'lucide-react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

/**
 * The agency's Do Not Call lists: `GET`, `POST` and `DELETE
 * /api/v1/compliance/dnc-lists`, every one scoped to the acting tenant.
 *
 * Rendered by /settings/dnc, and as the DNC lists tab of Settings. `embedded`
 * drops the page canvas for the second, which already sits in one.
 *
 * There is no endpoint that loads numbers into a list, so there is no upload
 * here: the button that used to say "Upload List" only ever showed "coming
 * soon". Creating a list is real, and is what the button does now.
 */
export function DncListsView({ embedded = false }: { embedded?: boolean } = {}) {
  const [dncLists, setDncLists] = useState<DncList[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

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
    <div className={embedded ? 'flex min-w-0 flex-col gap-6' : 'page-canvas'}>
      <PageHeader
        description="Manage DNC lists and compliance"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" />
            New list
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
                      <Badge
                        variant={list.status.toUpperCase() === 'ACTIVE' ? 'success' : 'secondary'}
                      >
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

      <NewDncListDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={() => {
          setCreating(false);
          void loadDncLists();
        }}
      />
    </div>
  );
}

/** Name a new list and say whether it applies to every call or is your own. */
function NewDncListDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [type, setType] = useState<'GLOBAL' | 'CUSTOM'>('CUSTOM');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName('');
      setType('CUSTOM');
      setProblem(null);
    }
  }, [open]);

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const response = await apiClient.post('/api/v1/compliance/dnc-lists', {
        name: name.trim(),
        type,
      });
      if (response.error) {
        setProblem(response.error.message);
        return;
      }
      toast({ title: 'DNC list created', description: name.trim() });
      onCreated();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>New DNC list</DialogTitle>
          <DialogDescription>A list of numbers your calls must not reach.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="dnc-list-name">Name</Label>
            <Input
              id="dnc-list-name"
              value={name}
              maxLength={120}
              onChange={event => setName(event.target.value)}
              placeholder="Internal do-not-call"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dnc-list-type">Type</Label>
            <Select value={type} onValueChange={value => setType(value as 'GLOBAL' | 'CUSTOM')}>
              <SelectTrigger id="dnc-list-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CUSTOM">Custom</SelectItem>
                <SelectItem value="GLOBAL">Global</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {problem ? <p className="t-meta text-dropped-ink">{problem}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving || !name.trim()}>
            {saving ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
            Create list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
