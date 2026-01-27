'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  ChevronRight,
  ChevronLeft,
  Check,
  AlertCircle,
  Lightbulb,
  User,
  MapPin,
  Calendar,
  Heart,
  Shield,
  CreditCard,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  type ProspectData,
  type ScriptNode,
  STATES,
  RELATIONSHIPS,
  INITIAL_PROSPECT_DATA,
} from '@/lib/call-center/types';
import { calculateAgeFromDOB } from '@/lib/call-center/quoteCalculator';

// ============================================================================
// Script Nodes - Simplified for initial migration
// ============================================================================

const SCRIPT_NODES: ScriptNode[] = [
  {
    id: 'intro',
    title: 'Introduction',
    category: 'intro',
    script: `Hi, is this {firstName}? Great! My name is [Your Name] and I'm calling from [Company].

You recently requested information about final expense insurance coverage. Do you have just a few minutes to speak with me about it?`,
    tip: 'Sound friendly and professional. Confirm you have the right person.',
    nextNode: 'qualification_age',
  },
  {
    id: 'qualification_age',
    title: 'Age & Location',
    category: 'qualification',
    script: `Perfect! Let me just verify some information.

What is your date of birth? And what state do you currently reside in?`,
    fields: [
      { id: 'dob', label: 'Date of Birth', type: 'date', dataKey: 'dob', required: true },
      { id: 'state', label: 'State', type: 'state', dataKey: 'state', required: true },
    ],
    tip: 'Age determines carrier eligibility. State affects available products.',
    nextNode: 'qualification_health',
  },
  {
    id: 'qualification_health',
    title: 'Health Qualification',
    category: 'qualification',
    script: `I just need to ask a few health questions to find you the best rate.

Are you currently taking any medications for heart conditions, cancer, or diabetes?
Have you been hospitalized in the last 2 years?
Do you currently use tobacco products?`,
    fields: [
      {
        id: 'q1',
        label: 'Serious Health Conditions',
        type: 'boolean',
        dataKey: 'q1',
        options: [
          { value: 'false', label: 'No', color: 'green' },
          { value: 'true', label: 'Yes', color: 'red' },
        ],
      },
      {
        id: 'q2',
        label: 'Hospitalized (2 years)',
        type: 'boolean',
        dataKey: 'q2',
        options: [
          { value: 'false', label: 'No', color: 'green' },
          { value: 'true', label: 'Yes', color: 'red' },
        ],
      },
      {
        id: 'tobacco',
        label: 'Tobacco Use',
        type: 'boolean',
        dataKey: 'tobacco',
        options: [
          { value: 'false', label: 'No', color: 'green' },
          { value: 'true', label: 'Yes', color: 'yellow' },
        ],
      },
    ],
    tip: 'These questions determine Level vs Graded tier eligibility.',
    nextNode: 'qualification_gender',
  },
  {
    id: 'qualification_gender',
    title: 'Gender & Coverage',
    category: 'qualification',
    script: `And I just need to confirm - are you male or female?

What coverage amount were you thinking about? Most of our clients choose between $5,000 and $25,000.`,
    fields: [
      {
        id: 'gender',
        label: 'Gender',
        type: 'select',
        dataKey: 'gender',
        options: [
          { value: 'male', label: 'Male' },
          { value: 'female', label: 'Female' },
        ],
      },
      {
        id: 'faceAmount',
        label: 'Coverage Amount',
        type: 'select',
        dataKey: 'faceAmount',
        options: [
          { value: '5000', label: '$5,000' },
          { value: '10000', label: '$10,000' },
          { value: '15000', label: '$15,000' },
          { value: '20000', label: '$20,000' },
          { value: '25000', label: '$25,000' },
        ],
      },
    ],
    tip: 'Ready to show quotes after this step!',
    nextNode: 'presentation',
  },
  {
    id: 'presentation',
    title: 'Quote Presentation',
    category: 'presentation',
    script: `Great news, {firstName}! Based on your answers, I have several excellent options for you.

[SWITCH TO QUOTE PANEL]

The best rate I have for you is {carrier} at just {monthlyPremium} per month for {faceAmount} in coverage.

This is a whole life policy - your rate is locked in and will never increase, and your coverage will never decrease. Would you like to get started with this plan today?`,
    tip: 'Emphasize locked-in rates and lifetime coverage. Create urgency.',
    nextNode: 'application_personal',
  },
  {
    id: 'application_personal',
    title: 'Personal Information',
    category: 'application',
    script: `Wonderful! Let me get your information to complete the application.

What is your full legal name as it appears on your ID?
And your current address?`,
    fields: [
      { id: 'firstName', label: 'First Name', type: 'text', dataKey: 'firstName', required: true },
      { id: 'middleName', label: 'Middle Name', type: 'text', dataKey: 'middleName' },
      { id: 'lastName', label: 'Last Name', type: 'text', dataKey: 'lastName', required: true },
      { id: 'address', label: 'Street Address', type: 'text', dataKey: 'address', required: true },
      { id: 'city', label: 'City', type: 'text', dataKey: 'city', required: true },
      { id: 'zip', label: 'ZIP Code', type: 'text', dataKey: 'zip', required: true },
    ],
    nextNode: 'application_beneficiary',
  },
  {
    id: 'application_beneficiary',
    title: 'Beneficiary',
    category: 'application',
    script: `Who would you like to receive the benefit if something were to happen to you?

This is usually a spouse, child, or someone close to you.`,
    fields: [
      {
        id: 'primaryBenName',
        label: 'Primary Beneficiary Name',
        type: 'text',
        dataKey: 'primaryBenName',
        required: true,
      },
      {
        id: 'primaryBenRel',
        label: 'Relationship',
        type: 'select',
        dataKey: 'primaryBenRel',
        options: RELATIONSHIPS.map(r => ({ value: r, label: r })),
      },
      {
        id: 'contingentBenName',
        label: 'Contingent Beneficiary (Optional)',
        type: 'text',
        dataKey: 'contingentBenName',
      },
    ],
    nextNode: 'application_payment',
  },
  {
    id: 'application_payment',
    title: 'Payment Information',
    category: 'application',
    script: `For your monthly premium, would you prefer to have it drafted from a checking account or a savings account?

What day of the month works best for the draft?`,
    fields: [
      {
        id: 'accountType',
        label: 'Account Type',
        type: 'select',
        dataKey: 'accountType',
        options: [
          { value: 'checking', label: 'Checking' },
          { value: 'savings', label: 'Savings' },
        ],
      },
      { id: 'bankName', label: 'Bank Name', type: 'text', dataKey: 'bankName', required: true },
      { id: 'routing', label: 'Routing Number', type: 'text', dataKey: 'routing', required: true },
      {
        id: 'accountNum',
        label: 'Account Number',
        type: 'text',
        dataKey: 'accountNum',
        required: true,
      },
    ],
    nextNode: 'closing',
  },
  {
    id: 'closing',
    title: 'Closing',
    category: 'closing',
    script: `{firstName}, congratulations! Your application is complete.

Here's what happens next:
1. You'll receive a confirmation email within 24 hours
2. The carrier will process your application (usually 3-5 business days)
3. Once approved, your policy will be mailed to you

Do you have any questions for me?`,
    tip: 'Set clear expectations. Ask for referrals if appropriate.',
  },
];

// ============================================================================
// Script Panel Component
// ============================================================================

interface ScriptPanelProps {
  prospectData: Partial<ProspectData>;
  onDataUpdate: (data: Partial<ProspectData>) => void;
  currentNodeId?: string;
  onNodeChange?: (nodeId: string) => void;
}

export function ScriptPanel({
  prospectData,
  onDataUpdate,
  currentNodeId,
  onNodeChange,
}: ScriptPanelProps): JSX.Element {
  const [activeNodeId, setActiveNodeId] = useState(currentNodeId || 'intro');

  // Get current node
  const currentNode = SCRIPT_NODES.find(n => n.id === activeNodeId) || SCRIPT_NODES[0];
  const currentIndex = SCRIPT_NODES.findIndex(n => n.id === activeNodeId);

  // Navigate to next node
  const goToNext = useCallback(() => {
    if (currentNode.nextNode) {
      setActiveNodeId(currentNode.nextNode);
      onNodeChange?.(currentNode.nextNode);
    } else if (currentIndex < SCRIPT_NODES.length - 1) {
      const nextNode = SCRIPT_NODES[currentIndex + 1];
      setActiveNodeId(nextNode.id);
      onNodeChange?.(nextNode.id);
    }
  }, [currentNode, currentIndex, onNodeChange]);

  // Navigate to previous node
  const goToPrevious = useCallback(() => {
    if (currentIndex > 0) {
      const prevNode = SCRIPT_NODES[currentIndex - 1];
      setActiveNodeId(prevNode.id);
      onNodeChange?.(prevNode.id);
    }
  }, [currentIndex, onNodeChange]);

  // Handle field update
  const handleFieldChange = (key: keyof ProspectData, value: unknown) => {
    const updates: Partial<ProspectData> = { [key]: value };

    // Auto-calculate age from DOB
    if (key === 'dob' && typeof value === 'string') {
      updates.age = calculateAgeFromDOB(value);
    }

    onDataUpdate(updates);
  };

  // Replace placeholders in script text
  const renderScript = (text: string): string => {
    return text
      .replace(/{firstName}/g, prospectData.firstName || '[First Name]')
      .replace(/{lastName}/g, prospectData.lastName || '[Last Name]')
      .replace(/{carrier}/g, prospectData.carrier || '[Carrier]')
      .replace(/{monthlyPremium}/g, prospectData.monthlyPremium?.toString() || '[Premium]')
      .replace(/{faceAmount}/g, `$${(prospectData.faceAmount || 0).toLocaleString()}`);
  };

  // Get category icon
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'intro':
        return User;
      case 'qualification':
        return Shield;
      case 'presentation':
        return Heart;
      case 'application':
        return FileText;
      case 'closing':
        return Check;
      default:
        return FileText;
    }
  };

  const CategoryIcon = getCategoryIcon(currentNode.category);

  return (
    <div className="flex flex-col h-full">
      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-gray-400">Progress</span>
          <span className="text-xs text-gray-400">
            {currentIndex + 1} / {SCRIPT_NODES.length}
          </span>
        </div>
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
            style={{ width: `${((currentIndex + 1) / SCRIPT_NODES.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Node Header */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className={cn(
            'w-10 h-10 rounded-lg flex items-center justify-center',
            'bg-gradient-to-br from-cyan-500/20 to-blue-500/20',
            'border border-cyan-500/30'
          )}
        >
          <CategoryIcon className="w-5 h-5 text-cyan-400" />
        </div>
        <div>
          <h3 className="text-white font-semibold">{currentNode.title}</h3>
          <p className="text-gray-400 text-sm capitalize">{currentNode.category}</p>
        </div>
      </div>

      {/* Script Text */}
      <div className="flex-1 overflow-auto">
        <div className="bg-slate-800/50 rounded-lg p-4 border border-white/5 mb-4">
          <p className="text-white whitespace-pre-line leading-relaxed">
            {renderScript(currentNode.script)}
          </p>
        </div>

        {/* Tip */}
        {currentNode.tip && (
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 mb-4">
            <Lightbulb className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-200 text-sm">{currentNode.tip}</p>
          </div>
        )}

        {/* Fields */}
        {currentNode.fields && currentNode.fields.length > 0 && (
          <div className="space-y-3">
            {currentNode.fields.map(field => (
              <div key={field.id}>
                <label className="block text-xs text-gray-400 mb-1">
                  {field.label}
                  {field.required && <span className="text-red-400 ml-1">*</span>}
                </label>

                {field.type === 'text' && (
                  <Input
                    type="text"
                    value={(prospectData[field.dataKey] as string) || ''}
                    onChange={e => handleFieldChange(field.dataKey, e.target.value)}
                    className="bg-slate-800/50 border-white/10 text-white"
                    placeholder={field.placeholder}
                  />
                )}

                {field.type === 'date' && (
                  <Input
                    type="date"
                    value={(prospectData[field.dataKey] as string) || ''}
                    onChange={e => handleFieldChange(field.dataKey, e.target.value)}
                    className="bg-slate-800/50 border-white/10 text-white"
                  />
                )}

                {field.type === 'state' && (
                  <select
                    value={(prospectData[field.dataKey] as string) || ''}
                    onChange={e => handleFieldChange(field.dataKey, e.target.value)}
                    className={cn(
                      'w-full px-3 py-2 rounded-md text-sm',
                      'bg-slate-800/50 border border-white/10',
                      'text-white focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500',
                      'outline-none'
                    )}
                  >
                    <option value="">Select State</option>
                    {STATES.map(state => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                )}

                {(field.type === 'select' || field.type === 'boolean') && field.options && (
                  <div className="flex flex-wrap gap-2">
                    {field.options.map(option => {
                      const isSelected = String(prospectData[field.dataKey]) === option.value;
                      return (
                        <Button
                          key={option.value}
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            handleFieldChange(
                              field.dataKey,
                              field.type === 'boolean' ? option.value === 'true' : option.value
                            )
                          }
                          className={cn(
                            'border-white/10',
                            isSelected &&
                              option.color === 'green' &&
                              'bg-emerald-500/20 border-emerald-500/50 text-emerald-400',
                            isSelected &&
                              option.color === 'red' &&
                              'bg-red-500/20 border-red-500/50 text-red-400',
                            isSelected &&
                              option.color === 'yellow' &&
                              'bg-amber-500/20 border-amber-500/50 text-amber-400',
                            isSelected &&
                              !option.color &&
                              'bg-cyan-500/20 border-cyan-500/50 text-cyan-400',
                            !isSelected && 'hover:bg-white/5'
                          )}
                        >
                          {option.label}
                        </Button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={goToPrevious}
          disabled={currentIndex === 0}
          className="border-white/10 text-gray-300 hover:bg-white/5"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Previous
        </Button>

        <Button
          size="sm"
          onClick={goToNext}
          disabled={currentIndex === SCRIPT_NODES.length - 1}
          className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

export default ScriptPanel;
