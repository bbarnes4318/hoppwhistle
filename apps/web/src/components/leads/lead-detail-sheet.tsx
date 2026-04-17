'use client';

import {
 AlertTriangle,
 CheckCircle2,
 ChevronDown,
 ChevronRight,
 Clock,
 RotateCcw,
 Save,
 X,
 XCircle,
} from 'lucide-react';
import { useState } from 'react';

import { StatusBadge, VerticalBadge } from './leads-table';

import type { InsuranceLeadDetail, InsuranceLeadSubmission } from '@/lib/api/leads';
import { updateInsuranceLead, retryInsuranceSubmission } from '@/lib/api/leads';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface LeadDetailSheetProps {
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
 type?: 'text' | 'number';
}) {
 const currentValue = edits[fieldKey] !== undefined ? edits[fieldKey] : (value ?? '');
 const isModified = edits[fieldKey] !== undefined && edits[fieldKey] !== (value ?? '');

 return (
 <div className="space-y-1">
 <label className="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
 {label}
 </label>
 <input
 type={type === 'number' ? 'number' : 'text'}
 value={String(currentValue)}
 onChange={(e) => onEdit(fieldKey, e.target.value)}
 className={`w-full rounded-md border px-2.5 py-1.5 text-sm transition-colors
 bg-slate-900/50 text-slate-200 placeholder-slate-600
 ${isModified
 ? 'border-amber-500/50 ring-1 ring-amber-500/20'
 : 'border-white/10 focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20'
 }
 outline-none`}
 />
 </div>
 );
}

// ---------------------------------------------------------------------------
// JSON Viewer
// ---------------------------------------------------------------------------

function JsonViewer({ data, redactKeys }: { data: unknown; redactKeys?: string[] }) {
 if (!data) return <div className="text-xs text-slate-600 italic">No data</div>;

 let display = data;
 if (redactKeys && typeof data === 'object' && data !== null) {
 const copy = { ...(data as Record<string, unknown>) };
 for (const key of redactKeys) {
 if (copy[key]) copy[key] = '[REDACTED]';
 }
 display = copy;
 }

 return (
 <pre className="max-h-64 overflow-auto rounded-md bg-slate-950/80 border border-white/5 p-3 text-[11px] font-mono text-slate-400 leading-relaxed">
 {JSON.stringify(display, null, 2)}
 </pre>
 );
}

// ---------------------------------------------------------------------------
// Submission Timeline Item
// ---------------------------------------------------------------------------

function SubmissionItem({
 submission,
 leadId,
 onRetried,
}: {
 submission: InsuranceLeadSubmission;
 leadId: string;
 onRetried: () => void;
}) {
 const [retrying, setRetrying] = useState(false);
 const [expanded, setExpanded] = useState(false);

 const canRetry =
 submission.validationStatus === 'VALID' &&
 submission.postStatus !== 'MATCHED';

 const handleRetry = async () => {
 setRetrying(true);
 try {
 await retryInsuranceSubmission(leadId, submission.id);
 onRetried();
 } catch {
 // Error handled by parent refresh
 } finally {
 setRetrying(false);
 }
 };

 const statusIcon = () => {
 switch (submission.postStatus) {
 case 'MATCHED':
 return <CheckCircle2 className="h-4 w-4 text-emerald-400" />;
 case 'ERROR':
 return <XCircle className="h-4 w-4 text-red-400" />;
 case 'UNMATCHED':
 return <AlertTriangle className="h-4 w-4 text-orange-400" />;
 case 'SKIPPED':
 return <XCircle className="h-4 w-4 text-slate-500" />;
 default:
 return <Clock className="h-4 w-4 text-amber-400" />;
 }
 };

 return (
 <div className="rounded-lg border border-white/5 bg-slate-950/50">
 {/* Header */}
 <div
 onClick={() => setExpanded(!expanded)}
 className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
 >
 {statusIcon()}
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 text-xs">
 <span className="text-slate-300">{new Date(submission.receivedAt).toLocaleString()}</span>
 <StatusBadge status={submission.validationStatus} />
 <StatusBadge status={submission.postStatus} />
 <StatusBadge status={submission.postMode} />
 </div>
 {submission.ameriquoteResponseStatus && (
 <div className="text-[10px] text-slate-500 mt-0.5">
 Ameriquote: {submission.ameriquoteResponseStatus}
 {submission.ameriquoteLeadId && ` · Lead #${submission.ameriquoteLeadId}`}
 {submission.ameriquotePrice && ` · $${submission.ameriquotePrice}`}
 </div>
 )}
 {submission.ameriquoteErrorMessage && (
 <div className="text-[10px] text-red-400/80 mt-0.5">
 {submission.ameriquoteErrorMessage}
 </div>
 )}
 </div>
 <div className="flex items-center gap-2">
 {canRetry && (
 <button
 onClick={(e) => {
 e.stopPropagation();
 void handleRetry();
 }}
 disabled={retrying}
 className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wider
 text-amber-400 bg-amber-500/10 border border-amber-500/20
 hover:bg-amber-500/20 disabled:opacity-50 transition-colors"
 >
 <RotateCcw className={`h-3 w-3 ${retrying ? 'animate-spin' : ''}`} />
 {retrying ? 'Retrying…' : 'Retry'}
 </button>
 )}
 {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500" />}
 </div>
 </div>

 {/* Expanded Detail */}
 {expanded && (
 <div className="border-t border-white/5 px-4 py-3 space-y-3">
 {/* Validation Errors */}
 {submission.validationErrors && Array.isArray(submission.validationErrors) && submission.validationErrors.length > 0 && (
 <div>
 <div className="text-[10px] font-semibold uppercase tracking-widest text-red-400 mb-1.5">
 Validation Errors
 </div>
 <div className="space-y-1">
 {(submission.validationErrors as Array<{ path: string; message: string }>).map((err, i) => (
 <div key={i} className="flex gap-2 text-xs">
 <span className="text-red-400/60 font-mono">{err.path || 'root'}</span>
 <span className="text-red-300">{err.message}</span>
 </div>
 ))}
 </div>
 </div>
 )}

 {/* Raw Inbound */}
 <div>
 <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
 Raw Inbound Payload
 </div>
 <JsonViewer data={submission.rawPayload} />
 </div>

 {/* Normalized */}
 {submission.normalizedPayload && (
 <div>
 <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
 Normalized Payload
 </div>
 <JsonViewer data={submission.normalizedPayload} />
 </div>
 )}

 {/* Mapped Outbound */}
 {submission.mappedOutboundPayload && (
 <div>
 <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
 Mapped Outbound Payload
 </div>
 <JsonViewer data={submission.mappedOutboundPayload} redactKeys={['Key']} />
 </div>
 )}

 {/* Raw Ameriquote Response */}
 {submission.ameriquoteResponseRaw && (
 <div>
 <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">
 Ameriquote Raw Response
 </div>
 <pre className="max-h-32 overflow-auto rounded-md bg-slate-950/80 border border-white/5 p-3 text-[11px] font-mono text-slate-400">
 {submission.ameriquoteResponseRaw}
 </pre>
 </div>
 )}

 {/* Attempt Info */}
 <div className="flex gap-4 text-[10px] text-slate-500">
 <span>Attempts: {submission.attemptCount}</span>
 {submission.postedAt && <span>Posted: {new Date(submission.postedAt).toLocaleString()}</span>}
 {submission.lastAttemptAt && <span>Last attempt: {new Date(submission.lastAttemptAt).toLocaleString()}</span>}
 </div>
 </div>
 )}
 </div>
 );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function LeadDetailSheet({ lead, loading, onClose, onRefresh }: LeadDetailSheetProps) {
 const [edits, setEdits] = useState<Record<string, string>>({});
 const [saving, setSaving] = useState(false);
 const [saveMsg, setSaveMsg] = useState<string | null>(null);

 const hasEdits = Object.keys(edits).length > 0;

 const handleEdit = (key: string, value: string) => {
 setEdits((prev) => ({ ...prev, [key]: value }));
 };

 const handleSave = () => {
 if (!lead || !hasEdits) return;
 setSaving(true);
 setSaveMsg(null);
 void updateInsuranceLead(lead.id, edits)
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

 return (
 <>
 {/* Backdrop */}
 <div
 className="fixed inset-0 z-40 bg-black/40 "
 onClick={onClose}
 />

 {/* Sheet */}
 <div className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-2xl flex-col border-l border-white/10 bg-slate-900/95 shadow-sm">
 {/* Header */}
 <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
 <div className="flex items-center gap-3">
 {lead && <VerticalBadge vertical={lead.vertical} />}
 <h2 className="text-sm font-semibold text-slate-200">
 {lead ? lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || 'Unnamed Lead' : '…'}
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
 <span className={`text-xs ${saveMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>
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
 <EditField label="First Name" value={lead.firstName} fieldKey="firstName" edits={edits} onEdit={handleEdit} />
 <EditField label="Last Name" value={lead.lastName} fieldKey="lastName" edits={edits} onEdit={handleEdit} />
 <EditField label="Phone" value={lead.phone} fieldKey="phone" edits={edits} onEdit={handleEdit} />
 <EditField label="Email" value={lead.email} fieldKey="email" edits={edits} onEdit={handleEdit} />
 </div>
 </Section>

 {/* Address */}
 <Section title="Address" defaultOpen={true}>
 <div className="grid grid-cols-2 gap-3">
 <div className="col-span-2">
 <EditField label="Address" value={lead.address} fieldKey="address" edits={edits} onEdit={handleEdit} />
 </div>
 <EditField label="Address 2" value={lead.address2} fieldKey="address2" edits={edits} onEdit={handleEdit} />
 <EditField label="City" value={lead.city} fieldKey="city" edits={edits} onEdit={handleEdit} />
 <EditField label="State" value={lead.state} fieldKey="state" edits={edits} onEdit={handleEdit} />
 <EditField label="ZIP Code" value={lead.zipCode} fieldKey="zipCode" edits={edits} onEdit={handleEdit} />
 <EditField label="County" value={lead.county} fieldKey="county" edits={edits} onEdit={handleEdit} />
 </div>
 </Section>

 {/* Demographics */}
 <Section title="Demographics" defaultOpen={true}>
 <div className="grid grid-cols-2 gap-3">
 <EditField label="Date of Birth" value={lead.birthDate} fieldKey="birthDate" edits={edits} onEdit={handleEdit} />
 <EditField label="Age" value={lead.age} fieldKey="age" edits={edits} onEdit={handleEdit} type="number" />
 <EditField label="Gender" value={lead.gender} fieldKey="gender" edits={edits} onEdit={handleEdit} />
 <EditField label="Source" value={lead.source} fieldKey="source" edits={edits} onEdit={handleEdit} />
 </div>
 </Section>

 {/* Notes */}
 <Section title="Notes">
 <textarea
 value={edits.notes !== undefined ? edits.notes : (lead.notes || '')}
 onChange={(e) => handleEdit('notes', e.target.value)}
 rows={3}
 placeholder="Add notes…"
 className="w-full rounded-md border border-white/10 bg-slate-900/50 text-sm text-slate-200
 placeholder-slate-600 px-3 py-2 outline-none focus:border-emerald-500/50
 focus:ring-1 focus:ring-emerald-500/20 transition-colors resize-none"
 />
 </Section>

 {/* Submission History */}
 <Section title={`Submission History (${lead.submissions.length})`} defaultOpen={true}>
 <div className="space-y-2">
 {lead.submissions.length === 0 ? (
 <div className="text-xs text-slate-500 italic">No submissions recorded</div>
 ) : (
 lead.submissions.map((sub) => (
 <SubmissionItem
 key={sub.id}
 submission={sub}
 leadId={lead.id}
 onRetried={onRefresh}
 />
 ))
 )}
 </div>
 </Section>

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


