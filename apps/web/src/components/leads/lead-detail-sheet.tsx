'use client';

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Save,
  X,
  Plus,
  Calendar,
  Activity,
  Check,
  Ban,
  MessageSquare,
  PhoneCall,
} from 'lucide-react';
import { useState, useEffect } from 'react';

import { VerticalBadge } from './leads-table';

import { usePhone } from '@/components/phone';
import type { InsuranceLeadDetail, UserSummary } from '@/lib/api/leads';
import {
  updateInsuranceLead,
  fetchUsers,
  createInsuranceLeadTask,
  completeInsuranceLeadTask,
  cancelInsuranceLeadTask,
} from '@/lib/api/leads';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LeadDetailSheetProps {
  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  lead: InsuranceLeadDetail | null;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

// ---------------------------------------------------------------------------
// Collapsible Section
// ---------------------------------------------------------------------------

function Section({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-white/5">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3 text-xs font-semibold uppercase tracking-widest text-slate-500 hover:bg-white/[0.02] transition-colors"
      >
        {title}
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable Field
// ---------------------------------------------------------------------------

function EditField({
  label,
  value,
  fieldKey,
  edits,
  onEdit,
  type = 'text',
}: {
  label: string;
  value: string | number | null;
  fieldKey: string;
  edits: Record<string, string>;
  onEdit: (key: string, val: string) => void;
  type?: 'text' | 'number' | 'datetime-local' | 'date';
}) {
  let currentValue = edits[fieldKey] !== undefined ? edits[fieldKey] : (value ?? '');
  if (type === 'datetime-local' && currentValue) {
    try {
      currentValue = new Date(currentValue).toISOString().slice(0, 16);
    } catch {
      // Ignore
    }
  } else if (type === 'date' && currentValue) {
    try {
      currentValue = new Date(currentValue).toISOString().slice(0, 10);
    } catch {
      // Ignore
    }
  }
  const isModified = edits[fieldKey] !== undefined && edits[fieldKey] !== (value ?? '');

  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <input
        type={type}
        value={String(currentValue)}
        onChange={e => onEdit(fieldKey, e.target.value)}
        className={`w-full rounded-md border px-2.5 py-1.5 text-sm transition-colors
        bg-slate-900/50 text-slate-200 placeholder-slate-600
        ${
          isModified
            ? 'border-amber-500/50 ring-1 ring-amber-500/20'
            : 'border-white/10 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20'
        }
        outline-none`}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  fieldKey,
  options,
  edits,
  onEdit,
}: {
  label: string;
  value: string | null;
  fieldKey: string;
  options: Array<{ value: string; label: string }>;
  edits: Record<string, string>;
  onEdit: (key: string, val: string) => void;
}) {
  const currentValue = edits[fieldKey] !== undefined ? edits[fieldKey] : (value ?? '');
  const isModified = edits[fieldKey] !== undefined && edits[fieldKey] !== (value ?? '');

  return (
    <div className="space-y-1">
      <label className="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </label>
      <select
        value={currentValue}
        onChange={e => onEdit(fieldKey, e.target.value)}
        className={`w-full rounded-md border px-2.5 py-1.5 text-sm transition-colors
        bg-slate-900/50 text-slate-200 outline-none
        ${
          isModified
            ? 'border-amber-500/50 ring-1 ring-amber-500/20'
            : 'border-white/10 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20'
        }`}
      >
        <option value="">Select...</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function CheckboxField({
  label,
  value,
  fieldKey,
  edits,
  onEdit,
}: {
  label: string;
  value: boolean;
  fieldKey: string;
  edits: Record<string, string>;
  onEdit: (key: string, val: string) => void;
}) {
  const currentValue = edits[fieldKey] !== undefined ? edits[fieldKey] === 'true' : value;

  return (
    <div className="flex items-center gap-2 py-2">
      <input
        type="checkbox"
        id={fieldKey}
        checked={currentValue}
        onChange={e => onEdit(fieldKey, e.target.checked ? 'true' : 'false')}
        className="h-4 w-4 rounded border-white/10 bg-slate-900/50 text-emerald-500 focus:ring-emerald-500/20 focus:ring-opacity-50"
      />
      <label
        htmlFor={fieldKey}
        className="text-xs font-semibold uppercase tracking-widest text-slate-500 cursor-pointer select-none"
      >
        {label}
      </label>
    </div>
  );
}

export function LeadDetailSheet({ lead, loading, onClose, onRefresh }: LeadDetailSheetProps) {
  const { makeCall } = usePhone();
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  // CRM State
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPriority, setTaskPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [taskDueAt, setTaskDueAt] = useState('');
  const [taskLoading, setTaskLoading] = useState(false);

  const hasEdits = Object.keys(edits).length > 0;

  const handleEdit = (key: string, value: string) => {
    setEdits(prev => ({ ...prev, [key]: value }));
  };

  useEffect(() => {
    if (lead) {
      fetchUsers()
        .then(res => {
          setUsers(res.data || []);
        })
        .catch(err => console.error('Failed to load users:', err));
    }
  }, [lead]);

  const handleSave = () => {
    if (!lead || !hasEdits) return;
    setSaving(true);
    setSaveMsg(null);

    // Transform boolean string back to boolean for backend validation
    const transformedEdits = { ...edits };
    if (transformedEdits.doNotCall !== undefined) {
      transformedEdits.doNotCall = (transformedEdits.doNotCall === 'true') as unknown as boolean;
    }

    void updateInsuranceLead(lead.id, transformedEdits)
      .then(() => {
        setEdits({});
        setSaveMsg('Saved');
        onRefresh();
        setTimeout(() => setSaveMsg(null), 2000);
      })
      .catch(() => {
        setSaveMsg('Failed to save');
      })
      .finally(() => {
        setSaving(false);
      });
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead || !taskTitle.trim()) return;
    setTaskLoading(true);
    try {
      await createInsuranceLeadTask(lead.id, {
        title: taskTitle,
        description: taskDesc || undefined,
        priority: taskPriority,
        dueAt: taskDueAt || undefined,
      });
      setTaskTitle('');
      setTaskDesc('');
      setTaskPriority('NORMAL');
      setTaskDueAt('');
      onRefresh();
    } catch (err) {
      console.error('Failed to create task:', err);
    } finally {
      setTaskLoading(false);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    if (!lead) return;
    try {
      await completeInsuranceLeadTask(lead.id, taskId);
      onRefresh();
    } catch (err) {
      console.error('Failed to complete task:', err);
    }
  };

  const handleCancelTask = async (taskId: string) => {
    if (!lead) return;
    try {
      await cancelInsuranceLeadTask(lead.id, taskId);
      onRefresh();
    } catch (err) {
      console.error('Failed to cancel task:', err);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/40 " onClick={onClose} />

      {/* Sheet */}
      <div className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-2xl flex-col border-l border-white/10 bg-slate-900/95 shadow-sm animate-in slide-in-from-right duration-250">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-3">
            {lead && <VerticalBadge vertical={lead.vertical} />}
            <h2 className="text-sm font-semibold text-slate-200">
              {lead
                ? lead.fullName ||
                  `${lead.firstName || ''} ${lead.lastName || ''}`.trim() ||
                  'Unnamed Lead'
                : '…'}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {hasEdits && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium
                bg-emerald-500/15 text-emerald-400 border border-emerald-500/30
                hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save Changes'}
              </button>
            )}
            {saveMsg && (
              <span
                className={`text-xs ${saveMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}
              >
                {saveMsg}
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading || !lead ? (
            <div className="flex items-center justify-center h-full text-sm text-slate-500">
              Loading lead details…
            </div>
          ) : (
            <>
              {/* Contact Information */}
              <Section title="Contact Information" defaultOpen={true}>
                <div className="grid grid-cols-2 gap-3">
                  <EditField
                    label="First Name"
                    value={lead.firstName}
                    fieldKey="firstName"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <EditField
                    label="Last Name"
                    value={lead.lastName}
                    fieldKey="lastName"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <div className="space-y-1">
                    <label className="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
                      Phone
                    </label>
                    <div className="flex gap-2">
                      <div className="flex-grow">
                        <input
                          type="text"
                          value={edits.phone !== undefined ? edits.phone : (lead.phone ?? '')}
                          onChange={e => handleEdit('phone', e.target.value)}
                          className="w-full rounded-md border px-2.5 py-1.5 text-sm transition-colors bg-slate-900/50 text-slate-200 placeholder-slate-600 border-white/10 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20"
                        />
                      </div>
                      {lead.phone && (
                        <button
                          onClick={() => void makeCall(lead.phone)}
                          className="flex items-center justify-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-semibold text-white shadow-lg transition-colors border border-emerald-500/30"
                          title="Click to dial"
                        >
                          <PhoneCall className="h-4 w-4" />
                          <span>Call</span>
                        </button>
                      )}
                    </div>
                  </div>
                  <EditField
                    label="Email"
                    value={lead.email}
                    fieldKey="email"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                </div>
              </Section>

              {/* CRM & Assignment */}
              <Section title="CRM & Assignment" defaultOpen={true}>
                <div className="grid grid-cols-2 gap-3">
                  <SelectField
                    label="Assigned To"
                    value={lead.assignedToId}
                    fieldKey="assignedToId"
                    options={users.map(u => ({
                      value: u.id,
                      label: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email,
                    }))}
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <SelectField
                    label="Priority"
                    value={lead.priority}
                    fieldKey="priority"
                    options={[
                      { value: 'LOW', label: 'Low' },
                      { value: 'NORMAL', label: 'Normal' },
                      { value: 'HIGH', label: 'High' },
                      { value: 'URGENT', label: 'Urgent' },
                    ]}
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <SelectField
                    label="Lead Stage"
                    value={lead.leadStage}
                    fieldKey="leadStage"
                    options={[
                      { value: 'NEW', label: 'New' },
                      { value: 'CONTACTED', label: 'Contacted' },
                      { value: 'PROPOSAL', label: 'Proposal' },
                      { value: 'UNDERWRITING', label: 'Underwriting' },
                      { value: 'HOLD', label: 'Hold' },
                      { value: 'CLOSED_WON', label: 'Closed Won' },
                      { value: 'CLOSED_LOST', label: 'Closed Lost' },
                    ]}
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <EditField
                    label="Next Follow Up"
                    value={lead.nextFollowUpAt}
                    fieldKey="nextFollowUpAt"
                    type="datetime-local"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <EditField
                    label="Last Contacted"
                    value={lead.lastContactedAt}
                    fieldKey="lastContactedAt"
                    type="datetime-local"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <div className="col-span-2 pt-2">
                    <CheckboxField
                      label="Do Not Call (DNC)"
                      value={lead.doNotCall}
                      fieldKey="doNotCall"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                  </div>
                </div>
              </Section>

              {/* Address */}
              <Section title="Address" defaultOpen={true}>
                <div className="grid grid-cols-2 gap-3">
                  <div className="col-span-2">
                    <EditField
                      label="Address"
                      value={lead.address}
                      fieldKey="address"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                  </div>
                  <EditField
                    label="Address 2"
                    value={lead.address2}
                    fieldKey="address2"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <EditField
                    label="City"
                    value={lead.city}
                    fieldKey="city"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <EditField
                    label="State"
                    value={lead.state}
                    fieldKey="state"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <EditField
                    label="ZIP Code"
                    value={lead.zipCode}
                    fieldKey="zipCode"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <EditField
                    label="County"
                    value={lead.county}
                    fieldKey="county"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                </div>
              </Section>

              {/* Demographics */}
              <Section title="Demographics" defaultOpen={true}>
                <div className="grid grid-cols-2 gap-3">
                  <EditField
                    label="Date of Birth"
                    value={lead.birthDate}
                    fieldKey="birthDate"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                  <EditField
                    label="Age"
                    value={lead.age}
                    fieldKey="age"
                    edits={edits}
                    onEdit={handleEdit}
                    type="number"
                  />
                  <EditField
                    label="Gender"
                    value={lead.gender}
                    fieldKey="gender"
                    edits={edits}
                    onEdit={handleEdit}
                  />
                </div>
              </Section>

              {/* Final Expense Specific (FE vertical only) */}
              {lead.vertical === 'FE' && (
                <Section title="Final Expense Details" defaultOpen={true}>
                  <div className="grid grid-cols-2 gap-3">
                    <SelectField
                      label="Smoker"
                      value={lead.smoker}
                      fieldKey="smoker"
                      options={[
                        { value: 'YES', label: 'Yes' },
                        { value: 'NO', label: 'No' },
                      ]}
                      edits={edits}
                      onEdit={handleEdit}
                    />
                    <EditField
                      label="Face Amount"
                      value={lead.faceAmount}
                      fieldKey="faceAmount"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                    <EditField
                      label="Monthly Premium"
                      value={lead.monthlyPremium}
                      fieldKey="monthlyPremium"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                    <EditField
                      label="Coverage Amount"
                      value={lead.coverageAmount}
                      fieldKey="coverageAmount"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                    <EditField
                      label="Carrier"
                      value={lead.carrier}
                      fieldKey="carrier"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                    <EditField
                      label="Product"
                      value={lead.product}
                      fieldKey="product"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                    <EditField
                      label="Life Type"
                      value={lead.lifeType}
                      fieldKey="lifeType"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                    <EditField
                      label="Risk Type"
                      value={lead.riskType}
                      fieldKey="riskType"
                      edits={edits}
                      onEdit={handleEdit}
                    />
                    <div className="col-span-2">
                      <EditField
                        label="TrustedForm URL"
                        value={lead.trustedFormUrl}
                        fieldKey="trustedFormUrl"
                        edits={edits}
                        onEdit={handleEdit}
                      />
                    </div>
                    <div className="col-span-2">
                      <EditField
                        label="LeadId Token"
                        value={lead.leadidToken}
                        fieldKey="leadidToken"
                        edits={edits}
                        onEdit={handleEdit}
                      />
                    </div>
                    <div className="col-span-2">
                      <EditField
                        label="Consent Language"
                        value={lead.consentLanguage}
                        fieldKey="consentLanguage"
                        edits={edits}
                        onEdit={handleEdit}
                      />
                    </div>
                    <div className="col-span-2">
                      <EditField
                        label="Recording URL"
                        value={lead.recordingUrl}
                        fieldKey="recordingUrl"
                        edits={edits}
                        onEdit={handleEdit}
                      />
                    </div>
                  </div>
                </Section>
              )}

              {/* Tasks & Follow-ups */}
              <Section title={`Tasks & Follow-ups (${lead.tasks?.length || 0})`}>
                <div className="space-y-4">
                  {/* Task Creation Form */}
                  <form
                    onSubmit={e => {
                      void handleAddTask(e);
                    }}
                    className="rounded-lg border border-white/5 bg-slate-950/20 p-3 space-y-3"
                  >
                    <div className="text-xs font-semibold text-slate-300">Create New Task</div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <input
                          type="text"
                          placeholder="Task Title..."
                          value={taskTitle}
                          onChange={e => setTaskTitle(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-slate-900/50 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
                          required
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="text"
                          placeholder="Description (optional)..."
                          value={taskDesc}
                          onChange={e => setTaskDesc(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-slate-900/50 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div>
                        <select
                          value={taskPriority}
                          onChange={e =>
                            setTaskPriority(e.target.value as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT')
                          }
                          className="w-full rounded-md border border-white/10 bg-slate-900/50 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
                        >
                          <option value="LOW">Low Priority</option>
                          <option value="NORMAL">Normal Priority</option>
                          <option value="HIGH">High Priority</option>
                          <option value="URGENT">Urgent Priority</option>
                        </select>
                      </div>
                      <div>
                        <input
                          type="date"
                          value={taskDueAt}
                          onChange={e => setTaskDueAt(e.target.value)}
                          className="w-full rounded-md border border-white/10 bg-slate-900/50 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="submit"
                        disabled={taskLoading || !taskTitle.trim()}
                        className="flex items-center gap-1 rounded px-3 py-1 text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 disabled:opacity-50 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        Add Task
                      </button>
                    </div>
                  </form>

                  {/* Task List */}
                  <div className="space-y-2">
                    {!lead.tasks || lead.tasks.length === 0 ? (
                      <div className="text-xs text-slate-500 italic">No tasks created yet</div>
                    ) : (
                      lead.tasks.map(task => {
                        const isOverdue =
                          task.status === 'OPEN' && task.dueAt && new Date(task.dueAt) < new Date();
                        return (
                          <div
                            key={task.id}
                            className="flex items-center justify-between p-3 rounded-lg border border-white/5 bg-slate-950/30"
                          >
                            <div className="min-w-0 flex-1 pr-2">
                              <div className="flex items-center gap-2">
                                <span
                                  className={`text-xs font-semibold ${task.status !== 'OPEN' ? 'line-through text-slate-500' : 'text-slate-200'}`}
                                >
                                  {task.title}
                                </span>
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                    task.priority === 'URGENT'
                                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                                      : task.priority === 'HIGH'
                                        ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                                        : task.priority === 'LOW'
                                          ? 'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  }`}
                                >
                                  {task.priority}
                                </span>
                                {task.status !== 'OPEN' && (
                                  <span className="text-[9px] uppercase tracking-wider text-slate-500 font-medium">
                                    ({task.status})
                                  </span>
                                )}
                              </div>
                              {task.description && (
                                <p
                                  className={`text-xs mt-0.5 ${task.status !== 'OPEN' ? 'line-through text-slate-600' : 'text-slate-400'}`}
                                >
                                  {task.description}
                                </p>
                              )}
                              {task.dueAt && (
                                <div className="flex items-center gap-1 mt-1 text-[10px]">
                                  <Calendar className="h-3 w-3 text-slate-500" />
                                  <span
                                    className={
                                      isOverdue ? 'text-red-400 font-medium' : 'text-slate-500'
                                    }
                                  >
                                    Due: {new Date(task.dueAt).toLocaleDateString()}
                                    {isOverdue && ' (Overdue)'}
                                  </span>
                                </div>
                              )}
                              {task.completedAt && (
                                <div className="text-[10px] text-slate-500 mt-1">
                                  Completed: {new Date(task.completedAt).toLocaleString()}
                                </div>
                              )}
                            </div>

                            {task.status === 'OPEN' && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => {
                                    void handleCompleteTask(task.id);
                                  }}
                                  className="p-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
                                  title="Complete Task"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    void handleCancelTask(task.id);
                                  }}
                                  className="p-1 rounded bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                                  title="Cancel Task"
                                >
                                  <Ban className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              </Section>

              {/* Notes */}
              <Section title="Notes">
                <textarea
                  value={edits.notes !== undefined ? edits.notes : lead.notes || ''}
                  onChange={e => handleEdit('notes', e.target.value)}
                  rows={3}
                  placeholder="Add notes…"
                  className="w-full rounded-md border border-white/10 bg-slate-900/50 text-sm text-slate-200
                  placeholder-slate-600 px-3 py-2 outline-none focus:border-emerald-500/50
                  focus:ring-1 focus:ring-emerald-500/20 transition-colors resize-none"
                />
              </Section>

              {/* Activity Timeline */}
              <Section
                title={`Activity Timeline (${lead.activities?.length || 0})`}
                defaultOpen={true}
              >
                <div className="flow-root">
                  <ul className="-mb-8">
                    {!lead.activities || lead.activities.length === 0 ? (
                      <div className="text-xs text-slate-500 italic">No activity recorded</div>
                    ) : (
                      lead.activities.map((act, actIdx) => {
                        const iconColor =
                          act.type === 'NOTE'
                            ? 'bg-amber-500/15 text-amber-400'
                            : act.type === 'CALL'
                              ? 'bg-cyan-500/15 text-cyan-400'
                              : act.type === 'STATUS_CHANGE'
                                ? 'bg-indigo-500/15 text-indigo-400'
                                : act.type === 'VALIDATION'
                                  ? 'bg-red-500/15 text-red-400'
                                  : act.type === 'SUBMISSION'
                                    ? 'bg-emerald-500/15 text-emerald-400'
                                    : 'bg-slate-500/15 text-slate-400';

                        const Icon =
                          act.type === 'NOTE'
                            ? MessageSquare
                            : act.type === 'CALL'
                              ? PhoneCall
                              : act.type === 'STATUS_CHANGE'
                                ? Activity
                                : act.type === 'VALIDATION'
                                  ? AlertTriangle
                                  : act.type === 'TASK'
                                    ? CheckCircle2
                                    : Activity;

                        return (
                          <li key={act.id}>
                            <div className="relative pb-8">
                              {actIdx !== lead.activities.length - 1 ? (
                                <span
                                  className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-white/5"
                                  aria-hidden="true"
                                />
                              ) : null}
                              <div className="relative flex space-x-3">
                                <div>
                                  <span
                                    className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/5 ${iconColor}`}
                                  >
                                    <Icon className="h-4 w-4" aria-hidden="true" />
                                  </span>
                                </div>
                                <div className="flex min-w-0 flex-1 justify-between space-x-4 pt-1.5">
                                  <div>
                                    <p className="text-xs font-semibold text-slate-300">
                                      {act.title}
                                    </p>
                                    {act.description && (
                                      <p className="text-xs text-slate-400 mt-0.5 whitespace-pre-wrap leading-relaxed">
                                        {act.description}
                                      </p>
                                    )}
                                  </div>
                                  <div className="whitespace-nowrap text-right text-[10px] text-slate-500">
                                    <time dateTime={act.createdAt}>
                                      {new Date(act.createdAt).toLocaleString()}
                                    </time>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      })
                    )}
                  </ul>
                </div>
              </Section>

              {/* Captured Script Data */}
              {lead.customFields && Object.keys(lead.customFields).length > 0 && (
                <Section title="Captured Script Data">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-xs max-h-[400px] overflow-y-auto pr-1">
                    {Object.entries(lead.customFields).map(([key, val]) => (
                      <div key={key} className="space-y-0.5 border-b border-white/5 pb-1">
                        <span className="text-[9px] font-mono uppercase tracking-wider text-slate-500 block">
                          {key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}
                        </span>
                        <span
                          className="font-mono text-slate-300 block truncate"
                          title={String(val)}
                        >
                          {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val ?? '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {/* Metadata */}
              <Section title="Metadata">
                <div className="space-y-2 text-xs text-slate-500">
                  <div className="flex justify-between">
                    <span>Lead ID</span>
                    <span className="font-mono text-slate-400">{lead.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Vertical</span>
                    <span>{lead.vertical}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Created</span>
                    <span>{new Date(lead.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Updated</span>
                    <span>{new Date(lead.updatedAt).toLocaleString()}</span>
                  </div>
                </div>
              </Section>
            </>
          )}
        </div>
      </div>
    </>
  );
}
