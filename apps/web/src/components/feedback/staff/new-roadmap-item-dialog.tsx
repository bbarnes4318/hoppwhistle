'use client';

import {
  FEEDBACK_CATEGORIES,
  type FeedbackCategory,
  type FeedbackStatus,
} from '@hopwhistle/shared';
import { Loader2 } from 'lucide-react';
import * as React from 'react';

import { Notice } from '@/components/domain';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { apiClient, payload, type Envelope } from '@/lib/api';
import {
  categoryLabel,
  statusLabel,
  type ProductArea,
  type StaffFeedbackDetail,
} from '@/lib/product-feedback';

const STARTING: FeedbackStatus[] = [
  'UNDER_REVIEW',
  'CONSIDERING',
  'PLANNED',
  'IN_PROGRESS',
  'TESTING',
  'SHIPPED',
];

/**
 * The product team putting something on the roadmap themselves: work that did
 * not start as one agency's request. With no agency chosen it is on the public
 * roadmap, which every agency reads; with one, it is that agency's.
 */
export function NewRoadmapItemDialog({
  open,
  onOpenChange,
  tenants,
  areas,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenants: Array<{ id: string; name: string }>;
  areas: ProductArea[];
  onCreated: (id: string) => void;
}) {
  const [title, setTitle] = React.useState('');
  const [summary, setSummary] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState<FeedbackCategory>('IMPROVEMENT');
  const [status, setStatus] = React.useState<FeedbackStatus>('PLANNED');
  const [area, setArea] = React.useState('none');
  const [tenantId, setTenantId] = React.useState('none');
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setTitle('');
    setSummary('');
    setDescription('');
    setCategory('IMPROVEMENT');
    setStatus('PLANNED');
    setArea('none');
    setTenantId('none');
    setError(null);
  }, [open]);

  async function create() {
    setSending(true);
    setError(null);
    try {
      const response = await apiClient.post<Envelope<StaffFeedbackDetail>>(
        '/api/v1/admin/product-feedback',
        {
          title: title.trim(),
          description: description.trim(),
          publicSummary: summary.trim() || null,
          category,
          status,
          productArea: area === 'none' ? null : area,
          tenantId: tenantId === 'none' ? null : tenantId,
          visibility: tenantId === 'none' ? 'PUBLIC' : 'TENANT',
        }
      );
      const data = payload(response);
      if (response.error || !data) {
        setError(response.error?.message ?? 'Not created.');
        return;
      }
      onOpenChange(false);
      onCreated(data.id);
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px]">
        <div>
          <DialogTitle className="t-section text-ink">New roadmap item</DialogTitle>
          <DialogDescription className="mt-1 t-body text-ink-2">
            Work the product team is doing that did not start as one agency’s request.
          </DialogDescription>
        </div>
        <form
          className="space-y-3"
          onSubmit={event => {
            event.preventDefault();
            void create();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="roadmap-title">Title</Label>
            <Input
              id="roadmap-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={140}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roadmap-summary">Summary agencies read</Label>
            <Textarea
              id="roadmap-summary"
              value={summary}
              onChange={e => setSummary(e.target.value)}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="roadmap-description">Internal description</Label>
            <Textarea
              id="roadmap-description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="At least a sentence: what it is and why."
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Kind</Label>
              <Select value={category} onValueChange={v => setCategory(v as FeedbackCategory)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FEEDBACK_CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>
                      {categoryLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Starts as</Label>
              <Select value={status} onValueChange={v => setStatus(v as FeedbackStatus)}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STARTING.map(s => (
                    <SelectItem key={s} value={s}>
                      {statusLabel(s, true)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Product area</Label>
              <Select value={area} onValueChange={setArea}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not set</SelectItem>
                  {areas.map(a => (
                    <SelectItem key={a.value} value={a.value}>
                      {a.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>For</Label>
              <Select value={tenantId} onValueChange={setTenantId}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Every agency (public roadmap)</SelectItem>
                  {tenants.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name} only
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {error ? <Notice tone="error" title={error} /> : null}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={sending || title.trim().length < 3 || description.trim().length < 10}
            >
              {sending ? <Loader2 aria-hidden className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Add to roadmap
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
