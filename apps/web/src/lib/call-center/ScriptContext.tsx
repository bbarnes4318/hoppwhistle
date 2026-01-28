'use client';

import React, { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import {
  type ProspectData,
  type JobRole,
  type ScriptType,
  type ScriptNode,
  INITIAL_PROSPECT_DATA,
  JOB_ROLES,
  SCRIPT_TYPES,
  getScriptAccessForRole,
} from '@/lib/call-center/types';
import { SCRIPT_NODES, getNode as getUnderwriterNode } from '@/lib/call-center/scriptData';
import {
  PLACEMENT_SCRIPT_NODES,
  getPlacementNode,
  getPlacementStartNode,
} from '@/lib/call-center/placementScriptData';

// ============================================================================
// CONTEXT TYPES
// ============================================================================

interface ScriptContextValue {
  // User Role
  userRole: JobRole;
  setUserRole: (role: JobRole) => void;

  // Script Selection
  activeScript: ScriptType;
  setActiveScript: (script: ScriptType) => void;
  canToggleScript: boolean;
  availableScripts: ScriptType[];

  // Script Navigation
  currentNodeId: string;
  setCurrentNodeId: (nodeId: string) => void;
  getCurrentNode: () => ScriptNode | undefined;
  navigateToNode: (nodeId: string) => void;
  goBack: () => void;
  canGoBack: boolean;
  nodeHistory: string[];

  // Form Data (Bi-directional persistence)
  prospectData: Partial<ProspectData>;
  updateFormData: <K extends keyof ProspectData>(key: K, value: ProspectData[K]) => void;
  updateMultipleFields: (updates: Partial<ProspectData>) => void;
  resetFormData: () => void;

  // Script State
  resetScriptState: () => void;
  getStartNode: () => string;
}

const ScriptContext = createContext<ScriptContextValue | undefined>(undefined);

// ============================================================================
// LOCAL STORAGE KEYS
// ============================================================================

const STORAGE_KEYS = {
  USER_ROLE: 'hopwhistle_user_role',
  ACTIVE_SCRIPT: 'hopwhistle_active_script',
  PROSPECT_DATA: 'hopwhistle_prospect_data',
} as const;

// ============================================================================
// PROVIDER COMPONENT
// ============================================================================

interface ScriptProviderProps {
  children: React.ReactNode;
  initialProspectData?: Partial<ProspectData>;
}

export function ScriptProvider({ children, initialProspectData }: ScriptProviderProps) {
  // ---------------------------------------------------------------------------
  // USER ROLE STATE (persisted to localStorage)
  // ---------------------------------------------------------------------------
  const [userRole, setUserRoleState] = useState<JobRole>(JOB_ROLES.STATE_LICENSED_UNDERWRITER);

  const setUserRole = useCallback((role: JobRole) => {
    setUserRoleState(role);
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEYS.USER_ROLE, role);
    }
  }, []);

  // Load user role from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedRole = localStorage.getItem(STORAGE_KEYS.USER_ROLE) as JobRole | null;
      if (savedRole && Object.values(JOB_ROLES).includes(savedRole)) {
        setUserRoleState(savedRole);
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // SCRIPT ACCESS (derived from role)
  // ---------------------------------------------------------------------------
  const scriptAccess = useMemo(() => getScriptAccessForRole(userRole), [userRole]);

  const canToggleScript = scriptAccess.canToggle;
  const availableScripts = scriptAccess.scripts;

  // ---------------------------------------------------------------------------
  // ACTIVE SCRIPT STATE
  // ---------------------------------------------------------------------------
  const [activeScript, setActiveScriptState] = useState<ScriptType>(SCRIPT_TYPES.UNDERWRITER);

  const setActiveScript = useCallback(
    (script: ScriptType) => {
      // Only allow if user has access to this script
      if (availableScripts.includes(script)) {
        setActiveScriptState(script);
        // Reset node history when switching scripts
        setNodeHistory([]);
        setCurrentNodeId(script === 'underwriter' ? 'greeting' : getPlacementStartNode());
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEYS.ACTIVE_SCRIPT, script);
        }
      }
    },
    [availableScripts]
  );

  // Set default script based on role when role changes
  useEffect(() => {
    if (availableScripts.length > 0) {
      // If current script not available, switch to first available
      if (!availableScripts.includes(activeScript)) {
        setActiveScriptState(availableScripts[0]);
        setCurrentNodeId(
          availableScripts[0] === 'underwriter' ? 'greeting' : getPlacementStartNode()
        );
      }
    }
  }, [availableScripts, activeScript]);

  // ---------------------------------------------------------------------------
  // SCRIPT NAVIGATION STATE
  // ---------------------------------------------------------------------------
  const [currentNodeId, setCurrentNodeId] = useState<string>('greeting');
  const [nodeHistory, setNodeHistory] = useState<string[]>([]);

  const getCurrentNode = useCallback((): ScriptNode | undefined => {
    if (activeScript === 'underwriter') {
      return getUnderwriterNode(currentNodeId);
    } else {
      return getPlacementNode(currentNodeId);
    }
  }, [activeScript, currentNodeId]);

  const navigateToNode = useCallback(
    (nodeId: string) => {
      setNodeHistory(prev => [...prev, currentNodeId]);
      setCurrentNodeId(nodeId);
    },
    [currentNodeId]
  );

  const goBack = useCallback(() => {
    if (nodeHistory.length > 0) {
      const previousNode = nodeHistory[nodeHistory.length - 1];
      setNodeHistory(prev => prev.slice(0, -1));
      setCurrentNodeId(previousNode);
    }
  }, [nodeHistory]);

  const canGoBack = nodeHistory.length > 0;

  const getStartNode = useCallback((): string => {
    return activeScript === 'underwriter' ? 'greeting' : getPlacementStartNode();
  }, [activeScript]);

  // ---------------------------------------------------------------------------
  // PROSPECT DATA STATE (bi-directional persistence)
  // ---------------------------------------------------------------------------
  const [prospectData, setProspectData] = useState<Partial<ProspectData>>(
    initialProspectData || INITIAL_PROSPECT_DATA
  );

  const updateFormData = useCallback(
    <K extends keyof ProspectData>(key: K, value: ProspectData[K]) => {
      setProspectData(prev => {
        const updated = { ...prev, [key]: value };
        // Persist to localStorage
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEYS.PROSPECT_DATA, JSON.stringify(updated));
        }
        return updated;
      });
    },
    []
  );

  const updateMultipleFields = useCallback((updates: Partial<ProspectData>) => {
    setProspectData(prev => {
      const updated = { ...prev, ...updates };
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.PROSPECT_DATA, JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  const resetFormData = useCallback(() => {
    setProspectData(INITIAL_PROSPECT_DATA);
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.PROSPECT_DATA);
    }
  }, []);

  // Load prospect data from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedData = localStorage.getItem(STORAGE_KEYS.PROSPECT_DATA);
      if (savedData) {
        try {
          const parsed = JSON.parse(savedData);
          setProspectData(prev => ({ ...prev, ...parsed }));
        } catch {
          // Invalid JSON, ignore
        }
      }
    }
  }, []);

  // ---------------------------------------------------------------------------
  // RESET STATE
  // ---------------------------------------------------------------------------
  const resetScriptState = useCallback(() => {
    setNodeHistory([]);
    setCurrentNodeId(getStartNode());
  }, [getStartNode]);

  // ---------------------------------------------------------------------------
  // CONTEXT VALUE
  // ---------------------------------------------------------------------------
  const contextValue: ScriptContextValue = useMemo(
    () => ({
      userRole,
      setUserRole,
      activeScript,
      setActiveScript,
      canToggleScript,
      availableScripts,
      currentNodeId,
      setCurrentNodeId,
      getCurrentNode,
      navigateToNode,
      goBack,
      canGoBack,
      nodeHistory,
      prospectData,
      updateFormData,
      updateMultipleFields,
      resetFormData,
      resetScriptState,
      getStartNode,
    }),
    [
      userRole,
      setUserRole,
      activeScript,
      setActiveScript,
      canToggleScript,
      availableScripts,
      currentNodeId,
      getCurrentNode,
      navigateToNode,
      goBack,
      canGoBack,
      nodeHistory,
      prospectData,
      updateFormData,
      updateMultipleFields,
      resetFormData,
      resetScriptState,
      getStartNode,
    ]
  );

  return <ScriptContext.Provider value={contextValue}>{children}</ScriptContext.Provider>;
}

// ============================================================================
// HOOK
// ============================================================================

export function useScriptContext(): ScriptContextValue {
  const context = useContext(ScriptContext);
  if (!context) {
    throw new Error('useScriptContext must be used within a ScriptProvider');
  }
  return context;
}

// ============================================================================
// CONVENIENCE HOOKS
// ============================================================================

export function useUserRole() {
  const { userRole, setUserRole } = useScriptContext();
  return { userRole, setUserRole };
}

export function useScriptNavigation() {
  const {
    currentNodeId,
    getCurrentNode,
    navigateToNode,
    goBack,
    canGoBack,
    nodeHistory,
    activeScript,
  } = useScriptContext();
  return {
    currentNodeId,
    getCurrentNode,
    navigateToNode,
    goBack,
    canGoBack,
    nodeHistory,
    activeScript,
  };
}

export function useFormData() {
  const { prospectData, updateFormData, updateMultipleFields, resetFormData } = useScriptContext();
  return { prospectData, updateFormData, updateMultipleFields, resetFormData };
}
