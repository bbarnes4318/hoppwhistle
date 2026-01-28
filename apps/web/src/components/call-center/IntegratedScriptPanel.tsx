'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Lightbulb,
  AlertTriangle,
  Check,
  User,
  Heart,
  Shield,
  FileText,
  Wallet,
  Trophy,
  AlertCircle,
  Package,
  Phone,
  CreditCard,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { type ScriptNode, type ProspectData, type ScriptField } from '@/lib/call-center/types';
import { useScriptContext } from '@/lib/call-center/ScriptContext';
import { ScriptToggle } from './UserRoleSettings';
import { SCRIPT_PHASES, replaceVariables } from '@/lib/call-center/scriptData';
import { PLACEMENT_PHASES } from '@/lib/call-center/placementScriptData';

// ============================================================================
// Phase Icon Mapping
// ============================================================================

const getPhaseIcon = (phase: number, scriptType: 'underwriter' | 'placement') => {
  if (scriptType === 'placement') {
    switch (phase) {
      case 1:
        return FileText; // Paperwork
      case 2:
        return Phone; // Fridge
      case 3:
        return CreditCard; // Money
      case 4:
        return Heart; // Beneficiary
      case 5:
        return Shield; // Spam Vaccine
      case 6:
        return Trophy; // Closing
      default:
        return FileText;
    }
  }

  // Underwriter script phases
  switch (phase) {
    case 1:
      return User;
    case 2:
      return Heart;
    case 3:
      return Shield;
    case 4:
    case 5:
      return Wallet;
    case 6:
      return FileText;
    case 7:
    case 8:
      return AlertCircle;
    case 9:
      return Trophy;
    default:
      return FileText;
  }
};

// ============================================================================
// Data Collection Form Component
// ============================================================================

interface DataCollectionFormProps {
  fields: ScriptField[];
  prospectData: Partial<ProspectData>;
  onFieldChange: <K extends keyof ProspectData>(key: K, value: ProspectData[K]) => void;
}

function DataCollectionForm({ fields, prospectData, onFieldChange }: DataCollectionFormProps) {
  return (
    <div className="space-y-3 mb-4">
      {fields.map(field => (
        <div key={field.id} className="space-y-1">
          <Label htmlFor={field.id} className="text-xs text-gray-300">
            {field.label}
            {field.required && <span className="text-red-400 ml-1">*</span>}
          </Label>

          {field.type === 'select' && field.options ? (
            <Select
              value={String(prospectData[field.dataKey] || '')}
              onValueChange={value =>
                onFieldChange(field.dataKey, value as ProspectData[typeof field.dataKey])
              }
            >
              <SelectTrigger id={field.id} className="bg-slate-800 border-white/10 text-white">
                <SelectValue placeholder={field.placeholder || `Select ${field.label}`} />
              </SelectTrigger>
              <SelectContent>
                {field.options.map(opt => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : field.type === 'currency' ? (
            <div className="flex items-center gap-2">
              <span className="text-white">$</span>
              <Input
                id={field.id}
                type="number"
                value={prospectData[field.dataKey] || ''}
                onChange={e =>
                  onFieldChange(
                    field.dataKey,
                    Number(e.target.value) as ProspectData[typeof field.dataKey]
                  )
                }
                className="bg-slate-800 border-white/10 text-white"
                placeholder={field.placeholder}
              />
            </div>
          ) : (
            <Input
              id={field.id}
              type={field.type === 'number' ? 'number' : 'text'}
              value={String(prospectData[field.dataKey] || '')}
              onChange={e =>
                onFieldChange(
                  field.dataKey,
                  field.type === 'number'
                    ? (Number(e.target.value) as ProspectData[typeof field.dataKey])
                    : (e.target.value as ProspectData[typeof field.dataKey])
                )
              }
              className="bg-slate-800 border-white/10 text-white"
              placeholder={field.placeholder}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// Integrated Script Panel Component
// ============================================================================

interface IntegratedScriptPanelProps {
  compact?: boolean;
  showQuotePanel?: boolean;
  onShowQuotePanel?: (show: boolean) => void;
}

export function IntegratedScriptPanel({
  compact = false,
  showQuotePanel = false,
  onShowQuotePanel,
}: IntegratedScriptPanelProps): JSX.Element {
  const {
    activeScript,
    currentNodeId,
    getCurrentNode,
    navigateToNode,
    goBack,
    canGoBack,
    nodeHistory,
    prospectData,
    updateFormData,
    canToggleScript,
    availableScripts,
  } = useScriptContext();

  const currentNode = getCurrentNode();

  // Get phase info based on active script
  const phases = activeScript === 'underwriter' ? SCRIPT_PHASES : PLACEMENT_PHASES;
  const phaseInfo = useMemo(() => {
    if (!currentNode) return null;
    return phases[currentNode.phase];
  }, [currentNode, phases]);

  // Calculate progress
  const totalPhases = activeScript === 'underwriter' ? 9 : 6;
  const progress = useMemo(() => {
    if (!currentNode) return 0;
    return Math.round((currentNode.phase / totalPhases) * 100);
  }, [currentNode, totalPhases]);

  // Handle option selection
  const handleOptionSelect = useCallback(
    (nextNode: string, setData?: Record<string, unknown>) => {
      if (setData) {
        Object.entries(setData).forEach(([key, value]) => {
          updateFormData(key as keyof ProspectData, value as ProspectData[keyof ProspectData]);
        });
      }
      navigateToNode(nextNode);
    },
    [navigateToNode, updateFormData]
  );

  // Handle field change (for data collection nodes)
  const handleFieldChange = useCallback(
    <K extends keyof ProspectData>(key: K, value: ProspectData[K]) => {
      updateFormData(key, value);
    },
    [updateFormData]
  );

  // Continue to next node
  const handleContinue = useCallback(() => {
    if (currentNode?.nextNode) {
      navigateToNode(currentNode.nextNode);
    }
  }, [currentNode, navigateToNode]);

  // Render script text with variable replacement
  const renderedScript = useMemo(() => {
    if (!currentNode) return '';
    return replaceVariables(currentNode.script, prospectData as Record<string, unknown>);
  }, [currentNode, prospectData]);

  const PhaseIcon = currentNode ? getPhaseIcon(currentNode.phase, activeScript) : FileText;

  // Check if quote panel should be shown
  const shouldShowQuotePanel =
    currentNode?.showQuoteCalculator || currentNode?.showCoverageSelector;

  // Notify parent if quote panel should be shown
  React.useEffect(() => {
    if (onShowQuotePanel && shouldShowQuotePanel !== showQuotePanel) {
      onShowQuotePanel(!!shouldShowQuotePanel);
    }
  }, [shouldShowQuotePanel, showQuotePanel, onShowQuotePanel]);

  if (availableScripts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400 p-8">
        <AlertCircle className="w-12 h-12 mb-4 text-amber-500" />
        <p className="text-center font-medium mb-2">No Script Access</p>
        <p className="text-sm text-center text-gray-500">
          Your current role does not have access to any scripts.
          <br />
          Please contact your manager to update your role.
        </p>
      </div>
    );
  }

  if (!currentNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
        Loading script...
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', compact ? 'text-sm' : '')}>
      {/* Script Toggle (for Manager/Partner) */}
      {canToggleScript && (
        <div className="mb-3 flex-shrink-0">
          <ScriptToggle className="w-full justify-center" />
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400">
            {activeScript === 'underwriter' ? 'Phase' : 'Step'} {currentNode.phase}:{' '}
            {phaseInfo?.name}
          </span>
          <span className="text-xs text-gray-400">{progress}%</span>
        </div>
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full transition-all duration-300',
              activeScript === 'underwriter'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-500'
                : 'bg-gradient-to-r from-purple-500 to-pink-500'
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Node Header */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <div
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
            activeScript === 'underwriter'
              ? 'bg-gradient-to-br from-cyan-500/20 to-blue-500/20 border border-cyan-500/30'
              : 'bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30'
          )}
        >
          <PhaseIcon
            className={cn(
              'w-4 h-4',
              activeScript === 'underwriter' ? 'text-cyan-400' : 'text-purple-400'
            )}
          />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-white font-semibold text-sm truncate">{currentNode.title}</h3>
          {currentNode.timestamp && (
            <p className="text-gray-500 text-xs">{currentNode.timestamp}</p>
          )}
        </div>
        {/* Script Badge */}
        <span
          className={cn(
            'text-[10px] font-medium px-2 py-0.5 rounded-full uppercase',
            activeScript === 'underwriter'
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-purple-500/20 text-purple-400'
          )}
        >
          {activeScript === 'underwriter' ? 'Script A' : 'Script B'}
        </span>
      </div>

      {/* Script Content - Scrollable */}
      <div className="flex-1 overflow-auto min-h-0">
        {/* Script Text */}
        <div className="bg-slate-800/50 rounded-lg p-3 border border-white/5 mb-3">
          <p className="text-white whitespace-pre-line leading-relaxed text-sm">{renderedScript}</p>
        </div>

        {/* Conversion Tip */}
        {currentNode.conversionTip && (
          <div className="flex items-start gap-2 p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/20 mb-3">
            <Lightbulb className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <p className="text-emerald-200 text-xs">{currentNode.conversionTip.text}</p>
          </div>
        )}

        {/* Eligibility Note */}
        {currentNode.eligibilityNote && (
          <div className="flex items-start gap-2 p-2 bg-amber-500/10 rounded-lg border border-amber-500/20 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
            <p className="text-amber-200 text-xs">{currentNode.eligibilityNote}</p>
          </div>
        )}

        {/* Data Collection Fields */}
        {currentNode.fields && currentNode.fields.length > 0 && (
          <div className="bg-slate-900/50 rounded-lg p-3 border border-white/10 mb-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">
              Collect Information:
            </p>
            <DataCollectionForm
              fields={currentNode.fields}
              prospectData={prospectData}
              onFieldChange={handleFieldChange}
            />
          </div>
        )}

        {/* Quote Calculator Trigger */}
        {shouldShowQuotePanel && (
          <div className="bg-amber-500/10 rounded-lg p-3 border border-amber-500/30 mb-3">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-amber-400" />
              <span className="text-amber-200 text-sm font-medium">Quote Calculator Active</span>
            </div>
            <p className="text-amber-300/70 text-xs mt-1">
              Adjust coverage and premium in the Quote Panel →
            </p>
          </div>
        )}

        {/* Options */}
        {currentNode.options && currentNode.options.length > 0 && (
          <div className="space-y-2 mb-3">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Select Response:</p>
            <div className="grid gap-2">
              {currentNode.options.map((option, index) => {
                const colorClasses = {
                  emerald:
                    'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/30',
                  red: 'bg-red-500/20 border-red-500/50 text-red-400 hover:bg-red-500/30',
                  amber: 'bg-amber-500/20 border-amber-500/50 text-amber-400 hover:bg-amber-500/30',
                  gray: 'bg-gray-500/20 border-gray-500/50 text-gray-400 hover:bg-gray-500/30',
                  blue: 'bg-blue-500/20 border-blue-500/50 text-blue-400 hover:bg-blue-500/30',
                };
                const buttonClass = option.color
                  ? colorClasses[option.color]
                  : 'bg-slate-700/50 border-white/10 text-white hover:bg-slate-600/50';

                return (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => handleOptionSelect(option.nextNode, option.setData)}
                    className={cn(
                      'justify-start text-left w-full border transition-all',
                      buttonClass
                    )}
                  >
                    {option.label}
                  </Button>
                );
              })}
            </div>
          </div>
        )}

        {/* Continue Button (for nodes without options but with nextNode) */}
        {!currentNode.options && currentNode.nextNode && !currentNode.isEndNode && (
          <Button
            onClick={handleContinue}
            size="sm"
            className={cn(
              'w-full',
              activeScript === 'underwriter'
                ? 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500'
            )}
          >
            Continue
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}

        {/* End Call indicator */}
        {currentNode.isEndNode && (
          <div className="flex items-center gap-2 p-3 bg-slate-700/50 rounded-lg border border-white/10">
            <Check className="w-5 h-5 text-emerald-400" />
            <span className="text-emerald-400 font-medium">
              {activeScript === 'underwriter' ? 'Call Complete' : 'Placement Complete'}
            </span>
          </div>
        )}
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5 mt-3 flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={goBack}
          disabled={!canGoBack}
          className="border-white/10 text-gray-300 hover:bg-white/5"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>

        <span className="text-xs text-gray-500">
          {nodeHistory.length} step{nodeHistory.length !== 1 ? 's' : ''} back
        </span>
      </div>
    </div>
  );
}

export default IntegratedScriptPanel;
