'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  ChevronRight,
  ChevronLeft,
  Lightbulb,
  AlertTriangle,
  Check,
  X,
  User,
  Heart,
  Shield,
  FileText,
  Wallet,
  Trophy,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { type ProspectData } from '@/lib/call-center/types';
import {
  SCRIPT_NODES,
  SCRIPT_PHASES,
  STARTING_NODE,
  replaceVariables,
  getNode,
} from '@/lib/call-center/scriptData';

// ============================================================================
// Phase Icon Mapping
// ============================================================================
const getPhaseIcon = (phase: number) => {
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
// Script Panel Component
// ============================================================================

interface ScriptPanelProps {
  prospectData: Partial<ProspectData>;
  onDataUpdate: (data: Partial<ProspectData>) => void;
  currentNodeId?: string;
  onNodeChange?: (nodeId: string) => void;
  compact?: boolean;
}

export function ScriptPanel({
  prospectData,
  onDataUpdate,
  currentNodeId,
  onNodeChange,
  compact = false,
}: ScriptPanelProps): JSX.Element {
  const [activeNodeId, setActiveNodeId] = useState(currentNodeId || STARTING_NODE);
  const [history, setHistory] = useState<string[]>([]);

  // Get current node
  const currentNode = useMemo(() => {
    return getNode(activeNodeId) || getNode(STARTING_NODE);
  }, [activeNodeId]);

  // Get phase info
  const phaseInfo = useMemo(() => {
    if (!currentNode) return null;
    return SCRIPT_PHASES[currentNode.phase];
  }, [currentNode]);

  // Calculate progress
  const progress = useMemo(() => {
    if (!currentNode) return 0;
    // Simple phase-based progress: phase 1-9 mapped to 0-100%
    return Math.round((currentNode.phase / 9) * 100);
  }, [currentNode]);

  // Navigate to a specific node
  const navigateTo = useCallback(
    (nodeId: string) => {
      setHistory(prev => [...prev, activeNodeId]);
      setActiveNodeId(nodeId);
      onNodeChange?.(nodeId);
    },
    [activeNodeId, onNodeChange]
  );

  // Go back to previous node
  const goBack = useCallback(() => {
    if (history.length > 0) {
      const prevNodeId = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      setActiveNodeId(prevNodeId);
      onNodeChange?.(prevNodeId);
    }
  }, [history, onNodeChange]);

  // Handle option selection
  const handleOptionSelect = useCallback(
    (nextNode: string, setData?: Record<string, unknown>) => {
      // Update prospect data if needed
      if (setData) {
        onDataUpdate(setData as Partial<ProspectData>);
      }
      navigateTo(nextNode);
    },
    [navigateTo, onDataUpdate]
  );

  // Continue to next node (for nodes without options)
  const handleContinue = useCallback(() => {
    if (currentNode?.nextNode) {
      navigateTo(currentNode.nextNode);
    }
  }, [currentNode, navigateTo]);

  // Render script text with variable replacement
  const renderedScript = useMemo(() => {
    if (!currentNode) return '';
    return replaceVariables(currentNode.script, prospectData as Record<string, unknown>);
  }, [currentNode, prospectData]);

  const PhaseIcon = currentNode ? getPhaseIcon(currentNode.phase) : FileText;

  if (!currentNode) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Script node not found
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col h-full', compact ? 'text-sm' : '')}>
      {/* Progress Bar */}
      <div className="mb-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-gray-400">
            Phase {currentNode.phase}: {phaseInfo?.name}
          </span>
          <span className="text-xs text-gray-400">{progress}%</span>
        </div>
        <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Node Header */}
      <div className="flex items-center gap-2 mb-3 flex-shrink-0">
        <div
          className={cn(
            'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
            'bg-gradient-to-br from-cyan-500/20 to-blue-500/20',
            'border border-cyan-500/30'
          )}
        >
          <PhaseIcon className="w-4 h-4 text-cyan-400" />
        </div>
        <div className="min-w-0">
          <h3 className="text-white font-semibold text-sm truncate">{currentNode.title}</h3>
          {currentNode.timestamp && (
            <p className="text-gray-500 text-xs">{currentNode.timestamp}</p>
          )}
        </div>
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
            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500"
          >
            Continue
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        )}

        {/* End Call indicator */}
        {currentNode.isEndNode && (
          <div className="flex items-center gap-2 p-3 bg-slate-700/50 rounded-lg border border-white/10">
            <Check className="w-5 h-5 text-emerald-400" />
            <span className="text-emerald-400 font-medium">Call Complete</span>
          </div>
        )}
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between pt-3 border-t border-white/5 mt-3 flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={goBack}
          disabled={history.length === 0}
          className="border-white/10 text-gray-300 hover:bg-white/5"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>

        <span className="text-xs text-gray-500">
          {history.length} step{history.length !== 1 ? 's' : ''} back
        </span>
      </div>
    </div>
  );
}

export default ScriptPanel;
