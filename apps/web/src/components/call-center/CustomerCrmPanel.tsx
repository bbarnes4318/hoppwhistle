import {
  User,
  Phone,
  Mail,
  MapPin,
  Calendar,
  Shield,
  Clipboard,
  CheckSquare,
  Plus,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  PlusCircle,
  FileText,
  Clock,
  Check,
  CheckCircle,
} from 'lucide-react';
import React, { useState } from 'react';
import type { CustomerLookupResponse } from '@/lib/api/leads';
import {
  completeInsuranceLeadTask,
  createInsuranceLeadTask,
  updateInsuranceLead,
} from '@/lib/api/leads';

interface CustomerCrmPanelProps {
  data: CustomerLookupResponse;
  loading: boolean;
  phone: string;
  onRefresh: () => void;
  onSwitchCustomer: (phone: string) => void;
  activeCall: {
    state: string;
    direction: string;
    duration?: number;
    callerId?: string;
    toNumber?: string;
    campaignName?: string;
    publisherName?: string;
    buyerName?: string;
  } | null;
}

export function CustomerCrmPanel({
  data,
  loading,
  phone,
  onRefresh,
  onSwitchCustomer,
  activeCall,
}: CustomerCrmPanelProps) {
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [newTaskDueAt, setNewTaskDueAt] = useState('');
  const [isAddingTask, setIsAddingTask] = useState(false);

  const [newNote, setNewNote] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);

  const customer = data.customer;

  // Format phone number for display
  const formatPhone = (num: string) => {
    const digits = num.replace(/\D/g, '');
    const d = digits.length === 11 ? digits.slice(1) : digits;
    if (d.length === 10) {
      return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    return num;
  };

  const handleCompleteTask = async (taskId: string) => {
    if (!customer?.id) return;
    try {
      await completeInsuranceLeadTask(customer.id, taskId);
      onRefresh();
    } catch (err) {
      console.error('[CrmPanel] Failed to complete task:', err);
    }
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer?.id || !newTaskTitle.trim()) return;
    try {
      await createInsuranceLeadTask(customer.id, {
        title: newTaskTitle,
        priority: newTaskPriority,
        dueAt: newTaskDueAt ? new Date(newTaskDueAt).toISOString() : undefined,
      });
      setNewTaskTitle('');
      setNewTaskDueAt('');
      setIsAddingTask(false);
      onRefresh();
    } catch (err) {
      console.error('[CrmPanel] Failed to create task:', err);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customer?.id || !newNote.trim()) return;
    try {
      setIsSavingNote(true);
      const updatedNotes = customer.notes
        ? `${String(customer.notes)}\n\n[Note added ${new Date().toLocaleDateString()}]: ${newNote}`
        : newNote;
      await updateInsuranceLead(customer.id, { notes: updatedNotes });
      setNewNote('');
      onRefresh();
    } catch (err) {
      console.error('[CrmPanel] Failed to add note:', err);
    } finally {
      setIsSavingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-muted-foreground space-y-3">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-400" />
        <p className="text-sm font-medium">Loading CRM customer profile...</p>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-4">
        <div className="p-4 bg-white/5 border border-white/10 rounded-full">
          <User className="w-10 h-10 text-muted-foreground" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-white mb-1">No CRM record found for this number</h3>
          <p className="text-xs text-muted-foreground max-w-sm">
            There are no leads, prospect intakes, or submissions matching {formatPhone(phone)}.
          </p>
        </div>
        <button
          onClick={onRefresh}
          className="flex items-center gap-2 px-4 py-2 text-xs font-mono uppercase tracking-widest text-cyan-400 bg-cyan-400/10 border border-cyan-400/30 rounded-lg hover:bg-cyan-400/20 transition-all"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry Lookup
        </button>
      </div>
    );
  }

  const isInsuranceLead = customer.recordType === 'InsuranceLead';

  return (
    <div className="flex-1 flex flex-col overflow-y-auto space-y-6 pr-1">
      {/* ───────────────────────────────────────────────────────────────────────
       * HEADER SECTION
       * ─────────────────────────────────────────────────────────────────────── */}
      <div className="p-4 bg-white/5 border border-white/10 rounded-xl relative overflow-hidden">
        {customer.doNotCall && (
          <div className="absolute top-0 right-0 left-0 bg-red-500/20 border-b border-red-500/30 px-4 py-1.5 flex items-center gap-2 text-red-400 text-xs font-bold uppercase tracking-wider">
            <AlertTriangle className="w-3.5 h-3.5" />
            DO NOT CALL WARNING: Client is listed on DNC registry
          </div>
        )}
        <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${customer.doNotCall ? 'mt-6' : ''}`}>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-white">
                {String(customer.fullName || `${String(customer.firstName ?? '')} ${String(customer.lastName ?? '')}`.trim() || 'Unnamed Lead')}
              </h1>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-cyan-400/20 text-cyan-400 rounded">
                {String(customer.recordType)}
              </span>
              {customer.vertical && (
                <span className="px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-widest bg-purple-400/20 text-purple-400 rounded">
                  {String(customer.vertical)}
                </span>
              )}
            </div>
            <p className="text-sm font-mono text-muted-foreground mt-1">{formatPhone(customer.phone)}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={onRefresh}
              title="Refresh CRM Data"
              className="p-2 text-muted-foreground hover:text-white bg-white/5 border border-white/10 rounded-lg hover:bg-white/10 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {isInsuranceLead && (
              <a
                href={`/insurance-leads?search=${customer.phone}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-2 text-xs font-mono uppercase tracking-widest text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 rounded-lg hover:bg-cyan-400/20 transition-all"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open Full Lead Record
              </a>
            )}
          </div>
        </div>

        {/* Basic Meta Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
          <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
            <span className="block text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Status / Stage</span>
            <span className="text-xs font-semibold text-white mt-0.5 block capitalize">{String(customer.status || 'N/A')}</span>
          </div>
          <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
            <span className="block text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Priority</span>
            <span className="text-xs font-semibold text-white mt-0.5 block">{String(customer.priority || 'NORMAL')}</span>
          </div>
          <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
            <span className="block text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Assigned User</span>
            <span className="text-xs font-semibold text-white mt-0.5 block truncate">{String(customer.assignedToId || 'Unassigned')}</span>
          </div>
          <div className="p-3 bg-white/5 border border-white/10 rounded-lg">
            <span className="block text-[10px] font-mono text-muted-foreground uppercase tracking-widest">Source</span>
            <span className="text-xs font-semibold text-white mt-0.5 block truncate">{String(customer.source || 'N/A')}</span>
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────
       * CALL CONTEXT SECTION
       * ─────────────────────────────────────────────────────────────────────── */}
      {activeCall && (
        <div className="p-4 bg-cyan-400/5 border border-cyan-400/20 rounded-xl">
          <div className="flex items-center gap-2 mb-3">
            <Phone className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold uppercase tracking-wider text-cyan-400">Active Call Context</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div>
              <span className="text-muted-foreground block">Call Direction</span>
              <span className="text-white font-mono font-medium capitalize mt-0.5 block">{activeCall.direction}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Status</span>
              <span className="text-white font-semibold capitalize mt-0.5 block flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${activeCall.state === 'active' ? 'bg-green-400 animate-pulse' : 'bg-yellow-400'}`}></span>
                {activeCall.state}
              </span>
            </div>
            {activeCall.campaignName && (
              <div>
                <span className="text-muted-foreground block">Campaign</span>
                <span className="text-white font-medium mt-0.5 block truncate">{activeCall.campaignName}</span>
              </div>
            )}
            {activeCall.publisherName && (
              <div>
                <span className="text-muted-foreground block">Publisher</span>
                <span className="text-white font-medium mt-0.5 block truncate">{activeCall.publisherName}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────────
       * MAIN GRID: CONTACT & INSURANCE DETAILS
       * ─────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Contact Info Card */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-2.5">
            <User className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Contact Information</h2>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="col-span-2">
              <span className="text-muted-foreground block">Street Address</span>
              <span className="text-white mt-0.5 block font-medium flex items-start gap-1">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 mt-0.5" />
                {String(customer.address || 'N/A')}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">City</span>
              <span className="text-white mt-0.5 block font-medium">{String(customer.city || 'N/A')}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">State</span>
              <span className="text-white mt-0.5 block font-medium font-mono">{String(customer.state || 'N/A')}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">ZIP Code</span>
              <span className="text-white mt-0.5 block font-medium font-mono">{String(customer.zipCode || 'N/A')}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">County</span>
              <span className="text-white mt-0.5 block font-medium">{String(customer.county || 'N/A')}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Email Address</span>
              <span className="text-white mt-0.5 block font-medium truncate flex items-center gap-1">
                <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                {customer.email ? (
                  <a href={`mailto:${customer.email}`} className="text-cyan-400 hover:underline">
                    {customer.email}
                  </a>
                ) : (
                  'N/A'
                )}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground block">Demographics</span>
              <span className="text-white mt-0.5 block font-medium">
                {customer.gender || 'N/A'} • {customer.age ? `${String(customer.age)} yrs` : 'N/A'}
              </span>
            </div>
            {customer.birthDate && (
              <div>
                <span className="text-muted-foreground block">Date of Birth</span>
                <span className="text-white mt-0.5 block font-medium font-mono flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
                  {customer.birthDate}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Insurance Details Card */}
        {customer.insurance && (
          <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
            <div className="flex items-center gap-2 border-b border-white/10 pb-2.5">
              <Shield className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">Insurance & Policy Details</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground block">Carrier</span>
                <span className="text-white mt-0.5 block font-medium">{String(customer.insurance.carrier || 'N/A')}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Product</span>
                <span className="text-white mt-0.5 block font-medium">{String(customer.insurance.product || 'N/A')}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Monthly Premium</span>
                <span className="text-white mt-0.5 block font-medium font-mono text-green-400">
                  {customer.insurance.monthlyPremium ? `$${String(customer.insurance.monthlyPremium)}` : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Face / Coverage Amount</span>
                <span className="text-white mt-0.5 block font-medium font-mono">
                  {customer.insurance.coverageAmount || customer.insurance.faceAmount
                    ? `$${String(customer.insurance.coverageAmount || customer.insurance.faceAmount)}`
                    : 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Life Type / Risk Type</span>
                <span className="text-white mt-0.5 block font-medium">
                  {[customer.insurance.lifeType, customer.insurance.riskType].filter(Boolean).join(' • ') || 'N/A'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground block">Smoker Status</span>
                <span className="text-white mt-0.5 block font-medium capitalize">
                  {customer.insurance.smoker === null ? 'N/A' : String(customer.insurance.smoker)}
                </span>
              </div>
              {customer.compliance?.trustedFormUrl && (
                <div className="col-span-2 border-t border-white/5 pt-2.5">
                  <span className="text-muted-foreground block mb-1">TrustedForm URL</span>
                  <a
                    href={customer.compliance.trustedFormUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-mono text-cyan-400 hover:underline flex items-center gap-1 truncate"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    {customer.compliance.trustedFormUrl}
                  </a>
                </div>
              )}
              {customer.compliance?.leadidToken && (
                <div>
                  <span className="text-muted-foreground block">Jornaya / LeadID Token</span>
                  <span className="text-white mt-0.5 block font-mono font-medium truncate">{String(customer.compliance.leadidToken)}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────────────────
       * CRM ACTIVITIES & TASKS CHECKLIST
       * ─────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Open Tasks Checklist */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
          <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white uppercase tracking-wider">CRM Tasks / Follow-ups</h2>
            </div>
            {isInsuranceLead && (
              <button
                onClick={() => setIsAddingTask(prev => !prev)}
                className="text-xs font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
              >
                <PlusCircle className="w-4 h-4" />
                Add Task
              </button>
            )}
          </div>

          {isAddingTask && (
            <form onSubmit={handleCreateTask} className="p-3 bg-white/5 border border-white/10 rounded-lg space-y-3">
              <input
                type="text"
                required
                placeholder="Task description..."
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                className="w-full bg-muted text-white text-xs border border-white/10 rounded p-2 focus:outline-none focus:border-cyan-500"
              />
              <div className="flex gap-2">
                <select
                  value={newTaskPriority}
                  onChange={e => setNewTaskPriority(e.target.value as any)}
                  className="bg-muted text-white text-xs border border-white/10 rounded p-2 focus:outline-none flex-1"
                >
                  <option value="LOW">Low Priority</option>
                  <option value="NORMAL">Normal Priority</option>
                  <option value="HIGH">High Priority</option>
                  <option value="URGENT">Urgent Priority</option>
                </select>
                <input
                  type="date"
                  value={newTaskDueAt}
                  onChange={e => setNewTaskDueAt(e.target.value)}
                  className="bg-muted text-white text-xs border border-white/10 rounded p-2 focus:outline-none flex-1"
                />
              </div>
              <div className="flex justify-end gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setIsAddingTask(false)}
                  className="px-3 py-1.5 text-muted-foreground hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-600 text-black font-semibold rounded"
                >
                  Create
                </button>
              </div>
            </form>
          )}

          <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
            {data.tasks.filter((t: any) => t.status === 'OPEN').length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No open tasks for this customer.</p>
            ) : (
              data.tasks
                .filter((t: any) => t.status === 'OPEN')
                .map((task: any) => (
                  <div
                    key={task.id}
                    className="p-2.5 bg-white/5 border border-white/10 rounded-lg flex items-center justify-between gap-3 group"
                  >
                    <div className="space-y-0.5">
                      <p className="text-xs text-white font-medium">{task.title}</p>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono">
                        <span className={`font-bold ${task.priority === 'URGENT' || task.priority === 'HIGH' ? 'text-red-400' : 'text-slate-400'}`}>
                          {task.priority}
                        </span>
                        {task.dueAt && (
                          <span>Due: {new Date(task.dueAt).toLocaleDateString()}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleCompleteTask(task.id)}
                      className="p-1.5 text-muted-foreground hover:text-green-400 bg-white/5 border border-white/10 rounded hover:border-green-500/30 transition-all flex items-center gap-1 text-[10px]"
                    >
                      <Check className="w-3.5 h-3.5" />
                      Complete
                    </button>
                  </div>
                ))
            )}
          </div>
        </div>

        {/* Activity Timeline Card */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-2.5">
            <Clipboard className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Activity Timeline</h2>
          </div>

          {isInsuranceLead && (
            <form onSubmit={handleAddNote} className="flex gap-2">
              <input
                type="text"
                required
                placeholder="Log a new activity note..."
                value={newNote}
                onChange={e => setNewNote(e.target.value)}
                className="flex-1 bg-muted text-white text-xs border border-white/10 rounded p-2 focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={isSavingNote}
                className="px-3 py-2 bg-cyan-400 hover:bg-cyan-500 disabled:opacity-50 text-black font-semibold text-xs rounded transition-colors"
              >
                Add Note
              </button>
            </form>
          )}

          <div className="space-y-3 max-h-[200px] overflow-y-auto pr-1">
            {data.activities.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No historical activities logged.</p>
            ) : (
              data.activities.map((act: any) => (
                <div key={act.id} className="text-xs flex gap-2.5 items-start">
                  <div className="p-1.5 bg-cyan-400/10 border border-cyan-400/20 text-cyan-400 rounded-full flex-shrink-0 mt-0.5">
                    <Clock className="w-3.5 h-3.5" />
                  </div>
                  <div className="flex-1 border-b border-white/5 pb-2">
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-white">{act.title}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(act.createdAt).toLocaleString()}
                      </span>
                    </div>
                    {act.description && (
                      <p className="text-muted-foreground mt-0.5 text-xs whitespace-pre-wrap">{act.description}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ───────────────────────────────────────────────────────────────────────
       * LATEST SUBMISSIONS AUDIT & POTENTIAL DUPLICATES
       * ─────────────────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 border-t border-white/5 pt-4">
        {/* Latest Inbound Submissions */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-2.5">
            <Shield className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Submissions / Delivery Audit</h2>
          </div>
          <div className="space-y-3">
            <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 rounded-lg text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-bold uppercase tracking-wide">External delivery disabled by owner request</p>
                <p className="text-muted-foreground mt-0.5">
                  Outbound lead post/retry workflows to Ameriquote/Boberdoo are deactivated.
                </p>
              </div>
            </div>

            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {data.submissions.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No submissions associated with this lead.</p>
              ) : (
                data.submissions.map((sub: any) => (
                  <div
                    key={sub.id}
                    className="p-3 bg-white/5 border border-white/10 rounded-lg text-xs space-y-1.5"
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-medium text-white text-[10px]">ID: {sub.id.slice(0, 8)}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {new Date(sub.receivedAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 font-mono text-[10px]">
                      <div>
                        <span className="text-muted-foreground block">Validation</span>
                        <span className={`font-semibold ${sub.validationStatus === 'VALID' ? 'text-green-400' : 'text-red-400'}`}>
                          {sub.validationStatus}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Post Mode</span>
                        <span className="text-white font-semibold">{sub.postMode}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block">Post Status</span>
                        <span className="text-yellow-400 font-bold uppercase">HOLD</span>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Potential Duplicates Panel */}
        <div className="p-4 bg-white/5 border border-white/10 rounded-xl space-y-4">
          <div className="flex items-center gap-2 border-b border-white/10 pb-2.5">
            <User className="w-4 h-4 text-cyan-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Potential Duplicate Matches</h2>
          </div>
          <div className="space-y-2">
            {data.duplicates.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No duplicates detected for this phone number.</p>
            ) : (
              <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                {data.duplicates.map((dup: any) => (
                  <div
                    key={dup.id}
                    className="p-3 bg-white/5 border border-white/10 rounded-lg flex items-center justify-between gap-3 text-xs"
                  >
                    <div>
                      <p className="font-semibold text-white">{dup.fullName}</p>
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground font-mono mt-0.5">
                        <span className="uppercase text-cyan-400">{dup.recordType}</span>
                        {dup.status && <span>Stage: {dup.status}</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => onSwitchCustomer(dup.phone)}
                      className="px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-cyan-400 hover:text-cyan-300 bg-cyan-400/5 hover:bg-cyan-400/10 border border-cyan-400/20 rounded transition-all"
                    >
                      View Profile
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
