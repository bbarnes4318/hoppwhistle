'use client';

/**
 * The writes a customer record takes -- field edits, tasks, notes -- with
 * the state a screen needs to show them honestly (saving, saved, failed).
 * Shared by the customer page and the CRM sheet so both send the same
 * requests and refresh the same way.
 */

import { useCallback, useEffect, useState } from 'react';

import { toast } from '@/components/ui/use-toast';
import { useAuth } from '@/hooks/use-auth';
import {
  cancelInsuranceLeadTask,
  completeInsuranceLeadTask,
  createInsuranceLeadTask,
  fetchUsers,
  patchInsuranceLeadFields,
  type InsuranceLeadDetail,
  type UserSummary,
} from '@/lib/api/leads';

import { buildLeadPatch, changedEdits } from './lead-fields';

export interface LeadEditor {
  edits: Record<string, string>;
  /** Edits that change the record. */
  changed: Record<string, string>;
  dirty: boolean;
  setField: (key: string, value: string) => void;
  reset: () => void;
  /** Resolves true when the server took it. */
  save: () => Promise<boolean>;
  saving: boolean;
  error: string | null;
}

export function useLeadEditor(lead: InsuranceLeadDetail, onSaved: () => void): LeadEditor {
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another customer, another set of edits.
  useEffect(() => {
    setEdits({});
    setError(null);
  }, [lead.id]);

  const changed = changedEdits(lead, edits);
  const dirty = Object.keys(changed).length > 0;

  const setField = useCallback((key: string, value: string) => {
    setEdits(prev => ({ ...prev, [key]: value }));
  }, []);

  const reset = useCallback(() => {
    setEdits({});
    setError(null);
  }, []);

  const save = async (): Promise<boolean> => {
    if (!dirty) return true;
    setSaving(true);
    setError(null);
    try {
      await patchInsuranceLeadFields(lead.id, buildLeadPatch(lead, changed));
      setEdits({});
      onSaved();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The customer was not updated.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { edits, changed, dirty, setField, reset, save, saving, error };
}

/**
 * The agency's people, for "Assigned to". Only the principal may reassign
 * (the server refuses an agent), so only they load the list.
 */
export function useAssignableUsers(): { canAssign: boolean; users: UserSummary[] } {
  const { isOwner, isAdmin } = useAuth();
  const canAssign = Boolean(isOwner || isAdmin);
  const [users, setUsers] = useState<UserSummary[]>([]);

  useEffect(() => {
    if (!canAssign) return;
    let active = true;
    fetchUsers()
      .then(res => {
        if (active) setUsers(res.data || []);
      })
      .catch(err => console.error('Failed to load users:', err));
    return () => {
      active = false;
    };
  }, [canAssign]);

  return { canAssign, users };
}

export interface NewTask {
  title: string;
  description?: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  /** A calendar day, YYYY-MM-DD. */
  dueAt?: string;
}

export interface LeadTasks {
  create: (task: NewTask) => Promise<boolean>;
  complete: (taskId: string) => Promise<void>;
  cancel: (taskId: string) => Promise<void>;
  creating: boolean;
  /** The task a complete or cancel is in flight for. */
  pendingId: string | null;
}

export function useLeadTasks(leadId: string, onChanged: () => void): LeadTasks {
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const create = async (task: NewTask): Promise<boolean> => {
    setCreating(true);
    try {
      await createInsuranceLeadTask(leadId, {
        title: task.title,
        description: task.description || undefined,
        priority: task.priority,
        dueAt: task.dueAt || undefined,
      });
      onChanged();
      return true;
    } catch (err) {
      console.error('Failed to create task:', err);
      toast({ title: 'The task was not added', variant: 'destructive' });
      return false;
    } finally {
      setCreating(false);
    }
  };

  const settle = async (taskId: string, action: 'complete' | 'cancel') => {
    setPendingId(taskId);
    try {
      await (action === 'complete'
        ? completeInsuranceLeadTask(leadId, taskId)
        : cancelInsuranceLeadTask(leadId, taskId));
      onChanged();
    } catch (err) {
      console.error(`Failed to ${action} task:`, err);
      toast({
        title: action === 'complete' ? 'The task was not completed' : 'The task was not cancelled',
        variant: 'destructive',
      });
    } finally {
      setPendingId(null);
    }
  };

  return {
    create,
    complete: taskId => settle(taskId, 'complete'),
    cancel: taskId => settle(taskId, 'cancel'),
    creating,
    pendingId,
  };
}
