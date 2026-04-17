'use client';

// ============================================================================
// RetentionScriptPanel.tsx - Global Retention Script for Retention Specialists
// Displayed when Job Title contains "Retention"
// ============================================================================

import { FileText, AlertCircle, Phone, User } from 'lucide-react';
import React from 'react';

// ============================================================================
// TYPES
// ============================================================================
interface ProspectData {
 first_name?: string;
 last_name?: string;
 firstName?: string;
 lastName?: string;
 phone?: string;
 caller_id?: string;
 email?: string;
 city?: string;
 state?: string;
 dob?: string;
 age?: number;
 gender?: string;
 coverage_amount?: number;
 carrier?: string;
 [key: string]: unknown;
}

interface RetentionScriptPanelProps {
 prospectData?: ProspectData | null;
 onDataUpdate?: (data: Record<string, unknown>) => void;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
const RetentionScriptPanel = ({ prospectData, onDataUpdate }: RetentionScriptPanelProps) => {
 // Extract customer name for personalization
 const customerName = prospectData?.first_name || prospectData?.firstName || 'Customer';
 const customerPhone = prospectData?.phone || prospectData?.caller_id || '';

 // Suppress unused var warning
 void onDataUpdate;

 return (
 <div className="h-full flex flex-col overflow-auto bg-background">
 {/* Header Banner */}
 <div className="bg-accent border-b border-purple-500/30 p-4 flex-shrink-0">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 bg-purple-500/30 rounded-xl flex items-center justify-center">
 <FileText className="w-5 h-5 text-purple-400" />
 </div>
 <div>
 <h2 className="text-lg font-bold text-purple-300">🎯 Global Retention Script</h2>
 <p className="text-xs text-gray-400">
 Retention-specific call script for customer retention specialists
 </p>
 </div>
 </div>
 </div>

 {/* Customer Info Bar */}
 {prospectData && (
 <div className="bg-card border-b border-[#2e2e3e] p-3 flex items-center gap-4 flex-shrink-0">
 <div className="flex items-center gap-2">
 <User className="w-4 h-4 text-cyan-400" />
 <span className="text-sm text-white font-medium">{customerName}</span>
 </div>
 {customerPhone && (
 <div className="flex items-center gap-2">
 <Phone className="w-4 h-4 text-green-400" />
 <span className="text-sm text-gray-400">{customerPhone}</span>
 </div>
 )}
 </div>
 )}

 {/* Script Content */}
 <div className="flex-1 p-6 overflow-auto">
 {/* Placeholder Notice */}
 <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 mb-6">
 <div className="flex items-start gap-3">
 <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
 <div>
 <p className="text-sm text-amber-300 font-medium">Script Content Placeholder</p>
 <p className="text-xs text-amber-400/70 mt-1">
 Global Retention Script: [Insert Script Content Here]
 </p>
 </div>
 </div>
 </div>

 {/* Script Steps */}
 <div className="space-y-4">
 <div className="bg-muted rounded-xl p-5 border border-[#2e2e3e]">
 <h3 className="text-sm font-bold text-purple-400 uppercase tracking-wide mb-4">
 Retention Call Flow
 </h3>

 <div className="space-y-4">
 {/* Step 1 */}
 <div className="flex gap-3">
 <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
 <span className="text-sm font-bold text-purple-400">1</span>
 </div>
 <div className="flex-1">
 <p className="text-sm font-medium text-white mb-1">Greet the Customer</p>
 <p className="text-sm text-gray-400">
 &quot;Hello <span className="text-cyan-400">{customerName}</span>, this is [Your
 Name] from the retention team. I understand you&apos;re considering some changes
 to your policy...&quot;
 </p>
 </div>
 </div>

 {/* Step 2 */}
 <div className="flex gap-3">
 <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
 <span className="text-sm font-bold text-purple-400">2</span>
 </div>
 <div className="flex-1">
 <p className="text-sm font-medium text-white mb-1">Acknowledge Concerns</p>
 <p className="text-sm text-gray-400">
 Listen actively to the customer&apos;s concerns. Validate their feelings and
 show empathy.
 </p>
 </div>
 </div>

 {/* Step 3 */}
 <div className="flex gap-3">
 <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
 <span className="text-sm font-bold text-purple-400">3</span>
 </div>
 <div className="flex-1">
 <p className="text-sm font-medium text-white mb-1">Present Retention Offers</p>
 <p className="text-sm text-gray-400">
 Based on their concerns, present available retention offers, discounts, or plan
 adjustments.
 </p>
 </div>
 </div>

 {/* Step 4 */}
 <div className="flex gap-3">
 <div className="w-8 h-8 bg-purple-500/20 rounded-lg flex items-center justify-center flex-shrink-0">
 <span className="text-sm font-bold text-purple-400">4</span>
 </div>
 <div className="flex-1">
 <p className="text-sm font-medium text-white mb-1">Document Outcome</p>
 <p className="text-sm text-gray-400">
 Record the call outcome, any offers made, and next steps in the CRM.
 </p>
 </div>
 </div>
 </div>
 </div>

 {/* Quick Actions */}
 <div className="bg-muted rounded-xl p-5 border border-[#2e2e3e]">
 <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wide mb-4">
 Quick Actions
 </h3>
 <div className="grid grid-cols-2 gap-3">
 <button className="px-4 py-3 bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/50 rounded-lg text-sm text-purple-300 font-medium transition-colors">
 Apply Discount
 </button>
 <button className="px-4 py-3 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 rounded-lg text-sm text-cyan-300 font-medium transition-colors">
 Schedule Callback
 </button>
 <button className="px-4 py-3 bg-green-500/20 hover:bg-green-500/30 border border-green-500/50 rounded-lg text-sm text-green-300 font-medium transition-colors">
 Transfer to Supervisor
 </button>
 <button className="px-4 py-3 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 rounded-lg text-sm text-amber-300 font-medium transition-colors">
 Escalate Case
 </button>
 </div>
 </div>
 </div>
 </div>
 </div>
 );
};

export default RetentionScriptPanel;


