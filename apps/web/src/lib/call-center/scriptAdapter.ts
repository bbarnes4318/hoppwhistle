// scriptAdapter.ts - Adapter to use Golden Path script in IntegratedScriptPanel
// This bridges the script format with the component

import {
  SCRIPT_NODES,
  STARTING_NODE,
  replaceVariables,
  SCRIPT_PHASES,
  ScriptNode,
} from './scriptData';

export interface AdaptedNode {
  id: string;
  type: string;
  phase: number;
  title: string;
  script: string;
  nextNode?: string;
  tip?: string;
  timestamp?: string;
  options: Array<{
    label: string;
    next: string;
    color: string;
    setData?: Record<string, unknown>;
  }>;
  fields: Array<{
    key: string;
    label: string;
    type: string;
    placeholder?: string;
    inline?: boolean;
    fullWidth?: boolean;
    options?: string[];
    sensitive?: boolean;
  }>;
  showQuoteCalculator?: boolean;
  showQuote?: boolean;
  showCoverageSelector?: boolean;
  showThreeOptions?: boolean;
  dynamicLocation?: boolean;
  dynamicDOB?: boolean;
  ageDisplay?: boolean;
  rapportScript?: string;
  isComplete?: boolean;
  checkVariable?: string;
  ifEmpty?: string;
  ifNotEmpty?: string;
}

// Helper to adapt script nodes to IntegratedScriptPanel format
export const adaptNodeForComponent = (
  node: ScriptNode,
  formData: Record<string, unknown>
): AdaptedNode | null => {
  if (!node) return null;

  // Map the node types to IntegratedScriptPanel expectations
  const adapted: AdaptedNode = {
    id: node.id,
    type: node.type?.toLowerCase() || 'statement',
    phase: node.phase,
    title: node.title,
    script: node.script,
    nextNode: node.nextNode,
    tip: node.conversionTip?.text || node.stageDirection,
    timestamp: node.timestamp,

    // Handle options - map them to component format
    options:
      node.options?.map(opt => ({
        label: opt.label,
        next: opt.nextNode,
        color: opt.label.includes('✅')
          ? 'emerald'
          : opt.label.includes('❌')
            ? 'red'
            : opt.label.includes('⚠️')
              ? 'amber'
              : 'blue',
        setData: opt.setData,
      })) ||
      (node.nextNode ? [{ label: '✅ Continue', next: node.nextNode, color: 'emerald' }] : []),

    // Handle fields for data collection nodes
    fields:
      node.id === 'coverage_selection'
        ? []
        : node.id === 'height_weight'
          ? [
              { key: 'heightFeet', label: 'Height (Feet)', type: 'height_slider' },
              { key: 'heightInches', label: 'Height (Inches)', type: 'height_slider' },
              { key: 'weight', label: 'Weight (lbs)', type: 'weight_slider' },
            ]
          : node.captureVariable
            ? [
                {
                  key:
                    node.captureVariable === 'beneficiary'
                      ? 'beneficiaryName'
                      : node.captureVariable,
                  label: node.title,
                  type: 'text',
                  placeholder: `Enter ${node.captureVariable}`,
                },
              ]
            : [],

    // Special flags
    showQuoteCalculator: node.showQuoteCalculator || node.type === 'quote',
    showQuote: node.showQuoteCalculator || node.type === 'quote',
    showCoverageSelector: node.showCoverageSelector || false,
    showThreeOptions: node.showThreeOptions || false,
    dynamicLocation: node.id === 'verify_location',
    dynamicDOB: node.id === 'health_dob',
    ageDisplay: node.id?.includes('dob') || node.id?.includes('age'),
    rapportScript: node.rapportScript,
    isComplete: node.isComplete,

    // Conditional node properties
    checkVariable: node.checkVariable,
    ifEmpty: node.ifEmpty,
    ifNotEmpty: node.ifNotEmpty,
  };

  return adapted;
};

// Get all adapted nodes as a map
export const getAdaptedNodes = (formData: Record<string, unknown>): Record<string, AdaptedNode> => {
  const adaptedNodes: Record<string, AdaptedNode> = {};

  Object.keys(SCRIPT_NODES).forEach(nodeId => {
    const adapted = adaptNodeForComponent(SCRIPT_NODES[nodeId], formData);
    if (adapted) {
      adaptedNodes[nodeId] = adapted;
    }
  });

  return adaptedNodes;
};

export { STARTING_NODE, replaceVariables, SCRIPT_PHASES };
export default { getAdaptedNodes, adaptNodeForComponent, STARTING_NODE, replaceVariables };
