'use client';
/* eslint-disable @typescript-eslint/no-floating-promises, @typescript-eslint/restrict-template-expressions, @typescript-eslint/no-base-to-string, react/no-unescaped-entities, @typescript-eslint/no-unused-vars, import/order -- pre-existing lint debt in this fe-rickie-ported component; suppressed rather than refactoring a live call-center panel */
// IntegratedScriptPanel.tsx
// COMPLETE PORT FROM fe-rickie - FULL 1775 LINES
// Uses hopbot's quoteCalculator module
// Implements dynamic Location Verification and DOB Collection

import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  DollarSign,
  X,
  Calculator,
  CheckCircle2,
  RotateCcw,
  Info,
  MapPin,
  Calendar,
  AlertCircle,
  ArrowRight,
  Settings,
  RefreshCw,
  Zap,
  XCircle,
  Send,
} from 'lucide-react';
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT FROM YOUR EXISTING QUOTE CALCULATOR - NO DUPLICATED RATE TABLES
// ═══════════════════════════════════════════════════════════════════════════
import { getAllCarrierQuotes, isAgeEligible } from '../../lib/call-center/quoteCalculator';

// ═══════════════════════════════════════════════════════════════════════════
// AREA CODE UTILITY - Derive state from phone number
// ═══════════════════════════════════════════════════════════════════════════
import { getAdaptedNodes, STARTING_NODE } from '../../lib/call-center/scriptAdapter';
import { subscribeToSettings, getEnabledCarriers } from '../../lib/call-center/settingsService';
import { getStateFromAreaCode } from '../../lib/call-center/utils/areaCodeLookup';

import { getAutomationAuthHeaders, getAutomationAuthQuery } from './automation-auth';

// ═══════════════════════════════════════════════════════════════════════════
// IMPORT THE GOLDEN PATH SCRIPT VIA ADAPTER
// ═══════════════════════════════════════════════════════════════════════════

// STUB: Rate loading functions - rates are hardcoded in quoteCalculator
// TODO: Implement Google Sheets integration if dynamic rates are needed
const isRatesLoaded = (): boolean => true;
const fetchAllRates = async (): Promise<void> => {
  // No-op - rates are hardcoded in quoteCalculator.ts
};
const subscribeToRates = (_callback: () => void): (() => void) => {
  // No-op subscription - return unsubscribe function
  return () => {};
};

// STUB: calculateMonthlyPremium - returns null, actual quotes use getAllCarrierQuotes
const calculateMonthlyPremium = (
  _carrier: string,
  _age: number,
  _gender: string,
  _tobacco: boolean,
  _coverage: number,
  _planType: string
): number | null => {
  // This function was expected by the original fe-rickie code but isn't implemented
  // The actual quote calculation happens via getAllCarrierQuotes
  return null;
};

// STUB: calculateEligibility - returns basic eligibility
const calculateEligibility = (_healthAnswers: Record<string, unknown>): string => {
  // Returns a basic eligibility tier
  return 'LEVEL';
};

// ═══════════════════════════════════════════════════════════════════════════
// SETTINGS PANEL FOR CARRIER SELECTION
// ═══════════════════════════════════════════════════════════════════════════
import SettingsPanel from './SettingsPanel';

import { useScriptAccess } from '@/hooks/useUserRoles';

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Calculate age from DOB
// ═══════════════════════════════════════════════════════════════════════════
const calculateAge = (dob: string | null | undefined): number | null => {
  if (!dob) return null;
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
};

// ═══════════════════════════════════════════════════════════════════════════
// CARRIER LOGO MAPPING
// ═══════════════════════════════════════════════════════════════════════════
const CARRIER_LOGOS = {
  Aflac: '/logos/aflac.png',
  SBLI: '/logos/sbli.png',
  CICA: '/logos/cica.png',
  GTL: '/logos/gtl.png',
  Corebridge: '/logos/corebridge.png',
  TransAmerica: '/logos/trans.png',
  'American Amicable': '/logos/amam.png',
  AHL: '/logos/ahl.png',
  'Royal Neighbors': '/logos/royal.png',
  Gerber: '/logos/gerber.png',
  'Mutual of Omaha': '/logos/mutual.png',
};

// Coverage amount options
const COVERAGE_OPTIONS = [
  { value: 3000, label: '$3,000' },
  { value: 5000, label: '$5,000' },
  { value: 7500, label: '$7,500' },
  { value: 10000, label: '$10,000' },
  { value: 15000, label: '$15,000' },
  { value: 20000, label: '$20,000' },
  { value: 25000, label: '$25,000' },
];

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════
interface ProspectData {
  phone?: string;
  caller_id?: string;
  city?: string;
  state?: string;
  dob?: string;
  date_of_birth?: string;
  age?: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  [key: string]: unknown;
}

interface IntegratedScriptPanelProps {
  prospectData?: ProspectData;
  onDataUpdate?: (data: Record<string, unknown>) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════
const IntegratedScriptPanel = ({ prospectData = {}, onDataUpdate }: IntegratedScriptPanelProps) => {
  const { customScripts } = useScriptAccess();
  // ─────────────────────────────────────────────────────────────────────────
  // DETERMINE DATA SOURCE FOR LOCATION
  // Priority 1: Webhook Data (city + state)
  // Priority 2: Area Code Lookup (state only from phone number)
  // ─────────────────────────────────────────────────────────────────────────
  const phoneNumber = prospectData?.phone || prospectData?.caller_id || '';
  const webhookCity = prospectData?.city || null;
  const webhookState = prospectData?.state || null;
  const areaCodeState = phoneNumber ? getStateFromAreaCode(phoneNumber) : null;

  // Determine which data source to use
  const hasWebhookData = !!(webhookCity && webhookState);
  const locationDataSource = hasWebhookData ? 'webhook' : areaCodeState ? 'areaCode' : 'manual';
  const initialState = webhookState || areaCodeState || '';
  const initialCity = hasWebhookData ? webhookCity : '';

  // Check if DOB is pre-filled from webhook
  const webhookDOB = prospectData?.dob || prospectData?.date_of_birth || null;
  const hasDOBData = !!webhookDOB;

  // Calculate initial age from DOB or use prospectData.age
  const calculateInitialAge = () => {
    if (webhookDOB) {
      return calculateAge(webhookDOB);
    }
    return prospectData?.age || null;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // STATE
  // ─────────────────────────────────────────────────────────────────────────
  const [nodeId, setNodeId] = useState(STARTING_NODE);
  const [history, setHistory] = useState([STARTING_NODE]);
  const [formData, setFormData] = useState({
    firstName: prospectData?.first_name || prospectData?.firstName || '',
    middleName: prospectData?.middle_name || prospectData?.middleName || '',
    lastName: prospectData?.last_name || prospectData?.lastName || '',
    state: initialState,
    city: initialCity,
    dob: webhookDOB || '',
    age: calculateInitialAge(),
    gender: prospectData?.gender || 'Female',
    tobacco: false,
    heightFeet: 5,
    heightInches: 6,
    weight: 150,
    beneficiaryName: prospectData?.beneficiary || '',
    beneficiaryRelation: '',
    ssPaymentDay: '',
    address: prospectData?.address || '',
    zip: prospectData?.zip || '',
    ssn: '',
    birthState: '',
    citizenship: 'Yes',
    email: prospectData?.email || '',
    phone: phoneNumber,
    // ═══ BANK DRAFT INFORMATION ═══
    // Initialize from prospectData if available (synced from other forms/data sources)
    accountHolder: prospectData?.accountHolder || prospectData?.accountName || '',
    bankName: prospectData?.bankName || '',
    bankCityState: prospectData?.bankCityState || prospectData?.bankAddress || '',
    ssPaymentSchedule:
      prospectData?.ssPaymentSchedule ??
      (prospectData?.draftSchedule === 'ss_payment' ? true : null),
    draftDay: prospectData?.draftDay || prospectData?.draftDate || '',
    routingNumber: prospectData?.routingNumber || prospectData?.routing || '',
    accountNumber: prospectData?.accountNumber || prospectData?.accountNum || '',
    accountType: prospectData?.accountType || 'Checking',
    // ═══ EMAIL & PERSONAL INFO ═══
    wantsEmail: null, // Would you like to provide email? (true/false)
    // ═══ PHYSICIAN INFORMATION ═══
    // ═══ HEALTH QUESTIONS (American Amicable) ═══
    // Questions 1-3: If Yes = NOT ELIGIBLE
    healthQ1: null, // Hospitalized, nursing facility, oxygen, cancer, ADL assistance
    healthQ2: null, // Organ transplant, CHF, Alzheimer's, ALS, terminal condition
    healthQ3: null, // AIDS/HIV
    // Questions 4-7: If Yes = ROP Plan
    healthQ4: null, // Diabetes complications, insulin before 50
    healthQ5: null, // Kidney disease, multiple cancers
    healthQ6: null, // Pending diagnostic tests
    healthQ7a: null, // 2yr: Stroke, COPD, cirrhosis, oxygen
    healthQ7b: null, // 2yr: Heart attack, heart surgery
    healthQ7c: null, // 2yr: Cancer treatment
    healthQ7d: null, // 2yr: Drug/alcohol abuse
    // Question 8: If Yes = Graded Plan
    healthQ8a: null, // 3yr: Heart issues, circulation surgery
    healthQ8b: null, // 3yr: Cancer, COPD, liver disease
    healthQ8c: null, // 3yr: Paralysis, MS, seizures, Parkinson's
    // COVID Question
    healthCovid: null, // COVID hospitalization/complications
    // If all No = Immediate Plan
    // ═══ ADDITIONAL FIELDS ═══
    doctorName: '',
    doctorAddress: '',
    doctorPhone: '',
    selectedCarrier: null,
    selectedCoverage: 10000,
    selectedPremium: null,
    selectedPlanType: 'Level', // Will be auto-set based on health answers
    hospitalizationReason: '',
    callbackDate: '',
    callbackTime: '',
    // ═══ OWNER & PAYOR INFORMATION ═══
    ownerIsInsured: true, // Is the Owner the Proposed Insured? (true = Yes)
    payorIsInsured: true, // Is the Payor the Proposed Insured? (true = Yes)
    // ═══ EXISTING COVERAGE ═══
    hasExistingInsurance: null, // Do you have existing life/disability insurance? (true/false)
    existingCompanyName: '', // If yes: Company Name
    existingPolicyNumber: '', // If yes: Policy Number
    existingCoverageAmount: '', // If yes: Amount of Coverage
    willReplaceExisting: null, // Will you replace existing policy? (true/false)
    // ═══ DATA VERIFICATION FLAGS ═══
    locationVerified: false,
    dobVerified: false,
    locationDataSource: locationDataSource, // 'webhook' | 'areaCode' | 'manual'
    dobDataSource: hasDOBData ? 'webhook' : 'manual', // 'webhook' | 'manual'
  });

  const [showQuotePanel, setShowQuotePanel] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false); // Settings modal
  const [copied, setCopied] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [ratesLoaded, setRatesLoaded] = useState(isRatesLoaded());
  const [ratesVersion, setRatesVersion] = useState(0); // Forces re-render on rate update
  const [settingsVersion, setSettingsVersion] = useState(0); // Forces re-render on settings change
  const [automationStarted, setAutomationStarted] = useState(false); // Track if background automation has started
  const [automationLoading, setAutomationLoading] = useState(false); // Track if automation is running
  const [automationError, setAutomationError] = useState(null); // Error message if automation fails
  const [automationSteps, setAutomationSteps] = useState([]); // Live SSE status updates
  const [applicationNumber, setApplicationNumber] = useState(null); // Application number after success
  const [confirmedCarrier, setConfirmedCarrier] = useState(null); // Carrier officially confirmed for submission
  const [showCarrierConfirmation, setShowCarrierConfirmation] = useState(false); // Show confirmation panel
  const scrollRef = useRef(null);

  // ═══════════════════════════════════════════════════════════════════════════
  // CARRIER CONFIRMATION LOGIC
  // The Submit button is ONLY enabled when a carrier has been explicitly confirmed
  // ═══════════════════════════════════════════════════════════════════════════
  const isSubmitEnabled = confirmedCarrier && !automationStarted && formData.state;

  // ═══════════════════════════════════════════════════════════════════════════
  // QUOTE DATA VALIDATION
  // Check if all required fields are present for quote calculation
  // ═══════════════════════════════════════════════════════════════════════════
  const quoteValidation = useMemo(() => {
    const missingFields: string[] = [];

    // Check DOB / Age
    if (!formData.dob && !formData.age) {
      missingFields.push('Date of Birth');
    }

    // Check Gender
    if (!formData.gender || (formData.gender !== 'Male' && formData.gender !== 'Female')) {
      missingFields.push('Gender');
    }

    // Check Coverage Amount (should always have a default, but verify)
    if (!formData.selectedCoverage || formData.selectedCoverage <= 0) {
      missingFields.push('Coverage Amount');
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
      hasDOB: !!formData.dob || !!formData.age,
      hasGender: formData.gender === 'Male' || formData.gender === 'Female',
    };
  }, [formData.dob, formData.age, formData.gender, formData.selectedCoverage]);

  // ─────────────────────────────────────────────────────────────────────────
  // GOOGLE SHEETS RATE LOADING
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Initial load
    if (!isRatesLoaded()) {
      fetchAllRates().then(() => {
        setRatesLoaded(true);
        setRatesVersion(v => v + 1);
      });
    }

    // Subscribe to rate updates
    const unsubscribe = subscribeToRates(() => {
      console.log('[IntegratedScriptPanel] Rates updated from Google Sheets');
      setRatesLoaded(true);
      setRatesVersion(v => v + 1);
    });

    return () => unsubscribe();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // CARRIER SETTINGS SUBSCRIPTION - Refresh quotes when settings change
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = subscribeToSettings(settings => {
      console.log(
        '[IntegratedScriptPanel] Carrier settings updated:',
        settings.enabledCarriers?.length,
        'carriers enabled'
      );
      setSettingsVersion(v => v + 1);
    });

    return () => unsubscribe();
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // SYNC DATA TO PARENT (Customer Data tab, Admin Dashboard)
  // ─────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (onDataUpdate) {
      onDataUpdate(formData);
    }
  }, [formData, onDataUpdate]);

  // Scroll to top on node change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [nodeId]);

  // ─────────────────────────────────────────────────────────────────────────
  // AUTOMATION TRIGGER - BACKGROUND CARRIER APP WITH SSE STATUS
  // ─────────────────────────────────────────────────────────────────────────

  // Manual trigger function - now uses SSE for live status updates
  const triggerCarrierAutomation = useCallback(async customerData => {
    const API_BASE = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';
    const ts = new Date().toISOString();

    // Reset state
    setAutomationLoading(true);
    setAutomationError(null);
    setAutomationSteps([]);
    setApplicationNumber(null);

    console.log('%c═══════════════════════════════════════════════════════════════', 'color: #0ff');
    console.log(
      '%c[AUTOMATION] TRIGGERING CARRIER AUTOMATION',
      'background: #f00; color: #fff; font-weight: bold; font-size: 14px; padding: 4px;'
    );
    console.log('%c═══════════════════════════════════════════════════════════════', 'color: #0ff');
    console.log(`[AUTOMATION] ${ts} Customer Data:`, customerData);

    // Log to server
    fetch(`${API_BASE}/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `Triggering automation for: ${customerData.firstName} ${customerData.lastName} (${customerData.state})`,
        level: 'info',
      }),
    }).catch(() => {});

    try {
      const url = `${API_BASE}/automation/run-carrier-app`;
      console.log('%c[AUTOMATION] Making POST request to:', 'color: #0f0', url);

      const response = await fetch(url, {
        method: 'POST',
        headers: getAutomationAuthHeaders(),
        body: JSON.stringify(customerData),
      });

      const data = await response.json();
      console.log('%c[AUTOMATION] Response:', 'color: #0f0', data);

      // Subscribe to SSE for live status updates
      if (data.jobId) {
        console.log('%c[AUTOMATION] Subscribing to SSE for job:', 'color: #0ff', data.jobId);

        const sseUrl = `${API_BASE}/automation/status/${data.jobId}${getAutomationAuthQuery()}`;
        const eventSource = new EventSource(sseUrl);

        eventSource.onmessage = async event => {
          try {
            const statusUpdate = JSON.parse(event.data);
            console.log('%c[SSE] Status Update:', 'color: #0ff', statusUpdate);

            // Add status update to steps array
            if (statusUpdate.step !== undefined && statusUpdate.message) {
              setAutomationSteps(prev => {
                const exists = prev.some(s => s.message === statusUpdate.message);
                if (exists) return prev;
                return [...prev, statusUpdate];
              });
            }

            // Handle completion
            if (statusUpdate.status === 'completed') {
              console.log(
                '%c[AUTOMATION] ✅ COMPLETED',
                'background: #0f0; color: #000; font-weight: bold;'
              );

              // Fetch final result to get application number
              try {
                const resultRes = await fetch(`${API_BASE}/automation/result/${data.jobId}`, {
                  headers: getAutomationAuthHeaders(),
                });
                const result = await resultRes.json();
                if (result.applicationNumber) {
                  setApplicationNumber(result.applicationNumber);
                }
              } catch (e) {
                console.error('Error fetching result:', e);
              }

              setAutomationLoading(false);
              eventSource.close();
            }

            // Handle failure
            if (statusUpdate.status === 'failed') {
              console.log(
                '%c[AUTOMATION] ❌ FAILED:',
                'background: #f00; color: #fff; font-weight: bold;',
                statusUpdate.message
              );
              setAutomationError(statusUpdate.message || 'Automation failed');
              setAutomationLoading(false);
              eventSource.close();
            }
          } catch (e) {
            console.error('Error parsing SSE message:', e);
          }
        };

        eventSource.onerror = error => {
          console.error('%c[SSE] Connection error:', 'color: #f00', error);
          setAutomationError('Lost connection to automation service');
          setAutomationLoading(false);
          eventSource.close();
        };
      } else {
        // No jobId - old API behavior or error
        if (data.success) {
          setApplicationNumber(data.applicationNumber);
          setAutomationLoading(false);
        } else {
          setAutomationError(data.error || 'Automation failed');
          setAutomationLoading(false);
        }
      }

      return data;
    } catch (err) {
      console.error(
        '%c[AUTOMATION] 💥 EXCEPTION',
        'background: #f00; color: #fff; font-weight: bold;',
        err
      );
      setAutomationError(err.message);
      setAutomationLoading(false);
      fetch(`${API_BASE}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `Automation EXCEPTION: ${err.message}`, level: 'error' }),
      }).catch(() => {});
      return { success: false, error: err.message };
    }
  }, []);

  // NOTE: handleConfirmCarrier and handleStartApplication are defined below after activeQuote

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE FORM DATA
  // ─────────────────────────────────────────────────────────────────────────
  const updateField = useCallback((key, value) => {
    setFormData(prev => {
      const updated = { ...prev, [key]: value };
      if (key === 'dob' && value) {
        updated.age = calculateAge(value);
      }
      return updated;
    });
  }, []);

  const updateMultiple = useCallback(updates => {
    setFormData(prev => ({ ...prev, ...updates }));
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // QUOTE CALCULATIONS - USING IMPORTED FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────
  const eligibility = useMemo(() => {
    return calculateEligibility(formData.healthAnswers);
  }, [formData.healthAnswers]);

  const quotes = useMemo(() => {
    if (!ratesLoaded) return []; // Wait for rates to load
    if (!formData.age) return []; // Don't calculate without a real age
    return getAllCarrierQuotes(
      {
        age: formData.age,
        gender: formData.gender as 'male' | 'female',
        tobacco: formData.tobacco,
        faceAmount: formData.selectedCoverage,
      },
      eligibility as 'LEVEL' | 'ROP' | 'GRADED' | 'GI' | 'NOT_ELIGIBLE' | undefined
    );
  }, [
    formData.age,
    formData.gender,
    formData.tobacco,
    formData.selectedCoverage,
    eligibility,
    ratesLoaded,
    ratesVersion,
    settingsVersion,
  ]);

  const bestQuote = useMemo(() => {
    const eligible = quotes.filter(q => q.isEligible && q.premium);
    if (eligible.length === 0) {
      // Return loading/empty state instead of hardcoded values
      return null;
    }
    return eligible[0];
  }, [quotes]);

  const activeQuote = formData.selectedCarrier
    ? quotes.find(q => q.carrier === formData.selectedCarrier) || bestQuote
    : bestQuote;

  const premiums = useMemo(() => {
    if (!activeQuote || !formData.age) {
      return { p15k: null, p10k: null, p5k: null, p3k: null };
    }
    return {
      p15k: calculateMonthlyPremium(
        activeQuote.carrier,
        formData.age,
        formData.gender,
        formData.tobacco,
        15000,
        activeQuote.planType
      ),
      p10k: calculateMonthlyPremium(
        activeQuote.carrier,
        formData.age,
        formData.gender,
        formData.tobacco,
        10000,
        activeQuote.planType
      ),
      p5k: calculateMonthlyPremium(
        activeQuote.carrier,
        formData.age,
        formData.gender,
        formData.tobacco,
        5000,
        activeQuote.planType
      ),
      p3k: calculateMonthlyPremium(
        activeQuote.carrier,
        formData.age,
        formData.gender,
        formData.tobacco,
        3000,
        activeQuote.planType
      ),
    };
  }, [
    activeQuote?.carrier,
    activeQuote?.planType,
    formData.age,
    formData.gender,
    formData.tobacco,
    ratesVersion,
  ]);

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIRM CARRIER SELECTION - Called when user clicks "Confirm" in the confirmation panel
  // ═══════════════════════════════════════════════════════════════════════════
  const handleConfirmCarrier = useCallback(() => {
    if (!activeQuote?.carrier) {
      alert('Please select a carrier before confirming.');
      return;
    }
    console.log(
      '%c[CARRIER] CONFIRMED:',
      'background: #0f0; color: #000; font-weight: bold;',
      activeQuote.carrier
    );
    setConfirmedCarrier(activeQuote.carrier);
    setShowCarrierConfirmation(false);

    // Update formData with confirmed carrier info
    updateMultiple({
      selectedCarrier: activeQuote.carrier,
      selectedPlanType: activeQuote.planType,
      selectedPremium: activeQuote.premium,
    });
  }, [activeQuote, updateMultiple]);

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBMIT APPLICATION - Routes to appropriate backend based on confirmed carrier
  // ═══════════════════════════════════════════════════════════════════════════
  const handleStartApplication = useCallback(() => {
    // GUARD: Must have confirmed carrier
    if (!confirmedCarrier) {
      alert('Please confirm your carrier selection before submitting.');
      setShowCarrierConfirmation(true);
      return;
    }

    // Validate required fields
    const missingFields = [];
    if (!formData.state) missingFields.push('State');
    if (!formData.firstName) missingFields.push('First Name');
    if (!formData.lastName) missingFields.push('Last Name');
    if (!formData.dob) missingFields.push('Date of Birth');
    if (!formData.gender) missingFields.push('Gender');
    if (!formData.selectedCoverage) missingFields.push('Coverage Amount');

    if (missingFields.length > 0) {
      alert(`Please complete the following before submitting:\n\n• ${missingFields.join('\n• ')}`);
      return;
    }

    console.log(
      '%c[AUTOMATION] SUBMIT TRIGGERED',
      'background: #ff0; color: #000; font-weight: bold;'
    );
    console.log('[AUTOMATION] Confirmed Carrier:', confirmedCarrier);
    console.log('[AUTOMATION] Form Data:', formData);

    // ═══ CONDITIONAL BACKEND ROUTING ═══
    switch (confirmedCarrier) {
      case 'American Amicable':
        console.log(
          '%c[AUTOMATION] Routing to American Amicable backend...',
          'background: #00f; color: #fff;'
        );
        setAutomationStarted(true);
        triggerCarrierAutomation(formData);
        break;

      case 'Mutual of Omaha':
      case 'Corebridge':
      case 'TransAmerica':
      case 'GTL':
      case 'CICA':
      case 'SBLI':
      case 'Aflac':
      case 'AHL':
      case 'Royal Neighbors':
      case 'Gerber':
        // Placeholder for other carriers - backend not yet implemented
        console.log(
          `%c[AUTOMATION] Submission for ${confirmedCarrier} - Backend not yet implemented`,
          'background: #f90; color: #000; font-weight: bold;'
        );
        alert(
          `Automated submission for ${confirmedCarrier} is not yet available.\n\nPlease complete this application manually.`
        );
        break;

      default:
        console.error('[AUTOMATION] ERROR: Unknown carrier:', confirmedCarrier);
        alert('Error: Unknown carrier selected. Please try again.');
        break;
    }
  }, [confirmedCarrier, formData, triggerCarrierAutomation]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RETRY APPLICATION - Called when clicking Retry after an error
  // Triggers the recovery flow on the backend
  // ═══════════════════════════════════════════════════════════════════════════
  const handleRetryApplication = useCallback(() => {
    console.log(
      '%c[AUTOMATION] RETRY TRIGGERED',
      'background: #f90; color: #000; font-weight: bold;'
    );

    // Reset error state
    setAutomationError(null);
    setAutomationSteps([]);
    setAutomationLoading(true);

    // Re-trigger the automation with retry flag
    // The backend recovery flow will handle saving, returning, and re-entering the app
    const retryData = {
      ...formData,
      retryMode: true, // This tells the backend to use the recovery flow
    };

    console.log('[AUTOMATION] Retry with recovery flow - Form Data:', retryData);
    triggerCarrierAutomation(retryData);
  }, [formData, triggerCarrierAutomation]);

  // ─────────────────────────────────────────────────────────────────────────
  // SCRIPT TEXT REPLACEMENT
  // ─────────────────────────────────────────────────────────────────────────
  const replaceVars = useCallback(
    text => {
      if (!text) return '';

      // Calculate three-option coverage amounts
      const highCoverage = formData.selectedCoverage + 5000;
      const midCoverage = formData.selectedCoverage;
      const lowCoverage = Math.max(3000, formData.selectedCoverage - 5000);

      // Spelled out last name for verification (e.g. J-o-n-e-s)
      const lastNameSpelled = formData.lastName
        ? formData.lastName.split('').join('-').toUpperCase()
        : 'LAST NAME';

      // Calculate premiums for each coverage level
      const highPremium = activeQuote
        ? calculateMonthlyPremium(
            activeQuote.carrier,
            formData.age,
            formData.gender,
            formData.tobacco,
            highCoverage,
            activeQuote.planType
          )
        : null;
      const midPremium = activeQuote
        ? calculateMonthlyPremium(
            activeQuote.carrier,
            formData.age,
            formData.gender,
            formData.tobacco,
            midCoverage,
            activeQuote.planType
          )
        : null;
      const lowPremium = activeQuote
        ? calculateMonthlyPremium(
            activeQuote.carrier,
            formData.age,
            formData.gender,
            formData.tobacco,
            lowCoverage,
            activeQuote.planType
          )
        : null;

      return (
        text
          // Support both camelCase and snake_case variable names
          .replace(/{firstName}/g, formData.firstName || 'Friend')
          .replace(/{first_name}/g, formData.firstName || 'Friend')
          .replace(/{last_name}/g, formData.lastName || '')
          .replace(/{last_name_spelled}/g, lastNameSpelled)
          .replace(/{state}/g, formData.state || 'your state')
          .replace(/{city}/g, formData.city || '')
          .replace(/{age}/g, formData.age || '')
          .replace(
            /{dob}/g,
            formData.dob
              ? new Date(formData.dob).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })
              : 'your date of birth'
          )
          .replace(/{beneficiary}/g, formData.beneficiaryName || 'your beneficiary')
          .replace(/{beneficiary_relationship}/g, 'child')
          .replace(/{carrier}/g, activeQuote?.carrier || 'the carrier')
          .replace(/{premium}/g, `$${activeQuote?.premium?.toFixed(2) || '0.00'}`)
          .replace(/{coverage}/g, `$${formData.selectedCoverage.toLocaleString()}`)
          // Three-option dynamic coverage amounts
          .replace(/{coverage_amount_high}/g, `$${highCoverage.toLocaleString()}`)
          .replace(/{coverage_amount_mid}/g, `$${midCoverage.toLocaleString()}`)
          .replace(/{coverage_amount_low}/g, `$${lowCoverage.toLocaleString()}`)
          // Three-option dynamic premiums
          .replace(/{monthly_premium_high}/g, highPremium ? `$${highPremium.toFixed(2)}` : '$—')
          .replace(/{monthly_premium_mid}/g, midPremium ? `$${midPremium.toFixed(2)}` : '$—')
          .replace(/{monthly_premium_low}/g, lowPremium ? `$${lowPremium.toFixed(2)}` : '$—')
          // Congratulations recap variables
          .replace(
            /{coverage_amount}/g,
            `$${formData.selectedCoverage?.toLocaleString() || '10,000'}`
          )
          .replace(
            /{monthly_premium}/g,
            activeQuote?.premium ? `$${activeQuote.premium.toFixed(2)}/month` : '$0.00/month'
          )
          .replace(
            /{draft_date}/g,
            formData.draftDay
              ? `the ${formData.draftDay}${['1', '21', '31'].includes(formData.draftDay) ? 'st' : ['2', '22'].includes(formData.draftDay) ? 'nd' : ['3', '23'].includes(formData.draftDay) ? 'rd' : 'th'}`
              : 'your selected draft date'
          )
          // Legacy premium variables
          .replace(/{p15k}/g, `$${premiums.p15k?.toFixed(2) || '0.00'}`)
          .replace(/{p10k}/g, `$${premiums.p10k?.toFixed(2) || '0.00'}`)
          .replace(/{p5k}/g, `$${premiums.p5k?.toFixed(2) || '0.00'}`)
          .replace(/{p3k}/g, `$${premiums.p3k?.toFixed(2) || '0.00'}`)
          .replace(/{ssDay}/g, formData.ssPaymentDay || 'your payment day')
          .replace(/{address}/g, formData.address || 'your address')
          .replace(/{agent_name}/g, 'your agent')
      );
    },
    [formData, activeQuote, premiums]
  );

  // ─────────────────────────────────────────────────────────────────────────
  // DYNAMIC SCRIPT NODES
  // ─────────────────────────────────────────────────────────────────────────
  const NODES = useMemo(() => {
    const baseNodes = getAdaptedNodes(formData);
    if (!customScripts) return baseNodes;

    // Apply custom script overrides
    const overriddenNodes = { ...baseNodes };
    Object.keys(customScripts).forEach(key => {
      if (overriddenNodes[key]) {
        overriddenNodes[key] = {
          ...overriddenNodes[key],
          script: customScripts[key],
        };
      }
    });
    return overriddenNodes;
  }, [formData, customScripts]);

  // Get current node
  const node = NODES[nodeId];

  // Handle CONDITIONAL nodes - auto-navigate based on variable value
  useEffect(() => {
    if (!node) return;
    if (node.type === 'conditional' && node.checkVariable) {
      const value = formData[node.checkVariable];
      const isEmpty = !value || (typeof value === 'string' && value.trim() === '');
      const nextNodeId = isEmpty ? node.ifEmpty : node.ifNotEmpty;
      if (nextNodeId) {
        setTimeout(() => {
          setHistory(prev => [...prev, nextNodeId]);
          setNodeId(nextNodeId);
        }, 0);
      }
    }
  }, [nodeId, node, formData]);

  // ─────────────────────────────────────────────────────────────────────────
  // NAVIGATION
  // ─────────────────────────────────────────────────────────────────────────
  const goTo = useCallback(
    (nextId, options = {}) => {
      if (!nextId || !NODES[nextId]) return;
      if (options.setData) {
        updateMultiple(options.setData);
      }
      setHistory(prev => [...prev, nextId]);
      setNodeId(nextId);
      setShowTip(false);
    },
    [NODES, updateMultiple]
  );

  const goBack = useCallback(() => {
    if (history.length <= 1) return;
    const newHist = [...history];
    newHist.pop();
    setHistory(newHist);
    setNodeId(newHist[newHist.length - 1]);
  }, [history]);

  const resetScript = useCallback(() => {
    setNodeId('opening');
    setHistory(['opening']);
  }, []);

  // ─────────────────────────────────────────────────────────────────────────
  // COPY SCRIPT
  // ─────────────────────────────────────────────────────────────────────────
  const copyScript = useCallback(() => {
    if (!node?.script) return;
    const text = replaceVars(node.script).replace(/\*\*/g, '').replace(/\n\n/g, '\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [node, replaceVars]);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER INPUT FIELD
  // ─────────────────────────────────────────────────────────────────────────
  const renderField = field => {
    const value = formData[field.key] || '';
    const baseClass =
      'bg-sunken border border-rule-strong rounded-lg px-3 py-2 text-ink text-lg focus:border-brand-ink focus:outline-none';

    // Height Slider (Feet or Inches) - Compact
    if (field.type === 'height_slider') {
      if (field.key === 'heightFeet') {
        const feet = formData.heightFeet || 5;
        return (
          <div key={field.key} className="col-span-2 mb-2">
            <div className="flex items-center justify-between mb-1">
              <label className="text-ink-2 text-xs font-medium">Height</label>
              <span className="text-lg font-bold text-brand-ink">
                {feet}' {formData.heightInches || 0}"
              </span>
            </div>
            <div className="flex gap-3">
              <div className="flex-1">
                <input
                  type="range"
                  min="4"
                  max="7"
                  value={feet}
                  onChange={e => updateField('heightFeet', parseInt(e.target.value))}
                  className="w-full h-2 bg-sunken rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--brand) 0%, var(--brand) ${((feet - 4) / 3) * 100}%, var(--rule) ${((feet - 4) / 3) * 100}%, var(--rule) 100%)`,
                  }}
                />
                <div className="flex justify-between text-xs text-ink-3">
                  <span>4'</span>
                  <span>7'</span>
                </div>
              </div>
              <div className="flex-1">
                <input
                  type="range"
                  min="0"
                  max="11"
                  value={formData.heightInches || 0}
                  onChange={e => updateField('heightInches', parseInt(e.target.value))}
                  className="w-full h-2 bg-sunken rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, var(--brand) 0%, var(--brand) ${((formData.heightInches || 0) / 11) * 100}%, var(--rule) ${((formData.heightInches || 0) / 11) * 100}%, var(--rule) 100%)`,
                  }}
                />
                <div className="flex justify-between text-xs text-ink-3">
                  <span>0"</span>
                  <span>11"</span>
                </div>
              </div>
            </div>
          </div>
        );
      }
      return null;
    }

    // Weight Slider - Compact
    if (field.type === 'weight_slider') {
      const weight = formData.weight || 150;
      return (
        <div key={field.key} className="col-span-2">
          <div className="flex items-center justify-between mb-1">
            <label className="text-ink-2 text-xs font-medium">Weight</label>
            <span className="text-lg font-bold text-live-ink">{weight} lbs</span>
          </div>
          <input
            type="range"
            min="80"
            max="400"
            step="5"
            value={weight}
            onChange={e => updateField('weight', parseInt(e.target.value))}
            className="w-full h-2 bg-sunken rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, var(--brand) 0%, var(--brand) ${((weight - 80) / 320) * 100}%, var(--rule) ${((weight - 80) / 320) * 100}%, var(--rule) 100%)`,
            }}
          />
          <div className="flex gap-1 mt-1.5">
            {[100, 150, 200, 250, 300].map(w => (
              <button
                key={w}
                onClick={() => updateField('weight', w)}
                className={`flex-1 py-1 rounded text-xs font-medium transition-all ${weight === w ? 'bg-brand text-brand-fg' : 'bg-sunken text-ink-2 hover:bg-sunken'}`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (field.type === 'select') {
      return (
        <div key={field.key} className={field.inline ? 'flex-1' : ''}>
          <label className="text-ink-2 text-sm mb-1 block">{field.label}</label>
          <select
            value={value}
            onChange={e => updateField(field.key, e.target.value)}
            className={`${baseClass} w-full`}
          >
            <option value="">Select...</option>
            {field.options.map(opt => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }

    if (field.type === 'checkbox') {
      return (
        <label key={field.key} className="flex items-center gap-2 text-ink">
          <input
            type="checkbox"
            checked={value === true}
            onChange={e => updateField(field.key, e.target.checked)}
            className="w-5 h-5 rounded bg-sunken border-rule-strong text-brand-ink focus:ring-ring"
          />
          {field.label}
        </label>
      );
    }

    return (
      <div
        key={field.key}
        className={field.fullWidth ? 'col-span-2' : field.inline ? 'flex-1' : ''}
      >
        <label className="text-ink-2 text-sm mb-1 block">{field.label}</label>
        <input
          type={field.type || 'text'}
          value={value}
          onChange={e => updateField(field.key, e.target.value)}
          placeholder={field.placeholder || ''}
          className={`${baseClass} w-full ${field.sensitive ? 'font-mono tracking-widest' : ''}`}
        />
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER QUOTE PANEL OVERLAY
  // ─────────────────────────────────────────────────────────────────────────
  const renderQuotePanel = () => {
    if (!showQuotePanel) return null;

    // Separate quotes by eligibility
    const eligibleQuotes = quotes.filter(q => q.isEligible && q.premium);
    const ineligibleQuotes = quotes.filter(q => !q.isEligible && q.premium);
    const isLoading = !ratesLoaded;

    return (
      <div
        className="absolute inset-0 z-50 flex flex-col overflow-hidden"
        style={{
          background: 'var(--paper)',
        }}
      >
        {/* Header with Glass Effect */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b border-rule"
          style={{
            background: 'var(--brand-tint)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-card bg-brand-tint flex items-center justify-center">
              <Calculator className="w-5 h-5 text-brand-ink" />
            </div>
            <div>
              <h2 className="text-ink font-bold text-lg">Quote Calculator</h2>
              <p className="text-ink-2 text-xs">
                {isLoading ? 'Loading rates...' : `${eligibleQuotes.length} carriers available`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettingsPanel(true)}
              className="p-2 hover:bg-sunken rounded-card transition-all border border-transparent hover:border-rule-strong group"
              title="Carrier Settings"
            >
              <Settings className="w-5 h-5 text-ink-2 group-hover:text-ink transition-colors" />
            </button>
            <button
              onClick={() => setShowQuotePanel(false)}
              className="p-2 hover:bg-sunken rounded-card transition-all border border-transparent hover:border-rule-strong"
            >
              <X className="w-5 h-5 text-ink" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Coverage Selection - Compact Horizontal */}
          <div className="flex items-center gap-3 p-3 rounded-card border border-rule bg-sunken">
            <span className="text-ink-2 text-sm whitespace-nowrap">Coverage:</span>
            <div className="flex flex-wrap gap-1.5 flex-1">
              {COVERAGE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateField('selectedCoverage', opt.value)}
                  className={`px-3 py-1 rounded-full font-medium text-xs transition-all ${
                    formData.selectedCoverage === opt.value
                      ? 'bg-brand text-brand-fg'
                      : 'bg-sunken text-ink-2 hover:bg-sunken hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div
              className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
                eligibility.status === 'standard'
                  ? 'bg-live-tint text-live-ink'
                  : eligibility.status === 'modified'
                    ? 'bg-ringing-tint text-ringing-ink'
                    : 'bg-dropped-tint text-dropped-ink'
              }`}
            >
              {eligibility.plan}
            </div>
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="py-12 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-card bg-brand-tint mb-4">
                <div className="animate-spin w-8 h-8 border-3 border-brand-ink border-t-transparent rounded-full"></div>
              </div>
              <p className="text-ink-2">Loading rates from Google Sheets...</p>
              <p className="text-ink-3 text-sm mt-1">This may take a few seconds</p>
            </div>
          )}

          {/* No Quotes Available - With Data Entry Fallback */}
          {!isLoading && eligibleQuotes.length === 0 && (
            <div className="py-6 px-4">
              {/* Check if missing required data */}
              {!quoteValidation.isValid ? (
                <div className="space-y-4">
                  {/* Missing Data Alert */}
                  <div className="flex items-start gap-3 p-4 bg-ringing-tint border border-ringing rounded-card">
                    <AlertCircle className="w-5 h-5 text-ringing-ink flex-shrink-0 mt-0.5" />
                    <div>
                      <p className="text-ringing-ink font-medium text-sm">
                        Required Information Missing
                      </p>
                      <p className="text-ink-2 text-xs mt-1">
                        Please provide the following to generate quotes:
                      </p>
                      <ul className="mt-2 space-y-1">
                        {quoteValidation.missingFields.map(field => (
                          <li
                            key={field}
                            className="text-ringing-ink text-xs flex items-center gap-1"
                          >
                            <span className="w-1 h-1 bg-ringing rounded-full" />
                            {field}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Inline Data Entry Fields */}
                  <div className="space-y-3 p-4 bg-sunken border border-rule rounded-card">
                    <h4 className="text-sm font-medium text-ink flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-brand-ink" />
                      Enter Customer Information
                    </h4>

                    {/* DOB Field */}
                    {!quoteValidation.hasDOB && (
                      <div>
                        <label className="text-ink-2 text-xs mb-1 block">Date of Birth *</label>
                        <input
                          type="date"
                          value={formData.dob || ''}
                          onChange={e => updateField('dob', e.target.value)}
                          max={new Date().toISOString().split('T')[0]}
                          className="w-full bg-sunken border border-rule-strong rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-brand-ink focus:ring-1 focus:ring-ring"
                        />
                        {formData.dob && formData.age && (
                          <p className="text-xs text-live-ink mt-1">
                            Age calculated: {formData.age} years old
                          </p>
                        )}
                      </div>
                    )}

                    {/* Gender Field */}
                    {!quoteValidation.hasGender && (
                      <div>
                        <label className="text-ink-2 text-xs mb-1 block">Gender *</label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => updateField('gender', 'Male')}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-all ${
                              formData.gender === 'Male'
                                ? 'bg-brand text-brand-fg'
                                : 'bg-sunken border border-rule-strong text-ink-2 hover:border-brand'
                            }`}
                          >
                            Male
                          </button>
                          <button
                            onClick={() => updateField('gender', 'Female')}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium text-sm transition-all ${
                              formData.gender === 'Female'
                                ? 'bg-brand text-brand-fg'
                                : 'bg-sunken border border-rule-strong text-ink-2 hover:border-brand'
                            }`}
                          >
                            Female
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Auto-refresh hint */}
                    {quoteValidation.isValid && (
                      <div className="flex items-center gap-2 text-live-ink text-xs p-2 bg-live-tint rounded-lg">
                        <CheckCircle2 className="w-4 h-4" />
                        All required data provided - Quotes will refresh automatically
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* All data present but still no quotes - age/eligibility issue */
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-card bg-dropped-tint mb-4">
                    <X className="w-8 h-8 text-dropped-ink" />
                  </div>
                  <p className="text-ink font-medium">No quotes available</p>
                  <p className="text-ink-3 text-sm mt-1">
                    {formData.age && formData.age > 85
                      ? `Age ${formData.age} exceeds maximum coverage age for available carriers`
                      : formData.age && formData.age < 18
                        ? `Age ${formData.age} is below minimum coverage age`
                        : 'Try adjusting coverage amount or check carrier settings'}
                  </p>
                  {formData.age && (
                    <p className="text-ink-3 text-xs mt-2">
                      Current: Age {formData.age}, {formData.gender}, $
                      {formData.selectedCoverage?.toLocaleString()} coverage
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Carrier Quote Cards with Logos */}
          {!isLoading && eligibleQuotes.length > 0 && (
            <div className="space-y-3">
              <p className="text-ink-2 text-sm font-medium px-1">
                Available Carriers ({eligibleQuotes.length})
              </p>
              {eligibleQuotes.map((quote, idx) => (
                <button
                  key={`${quote.carrier}-${quote.planType}`}
                  onClick={() => {
                    updateMultiple({
                      selectedCarrier: quote.carrier,
                      selectedPremium: quote.premium,
                      selectedPlanType: quote.planType,
                    });
                    setShowQuotePanel(false);
                  }}
                  className={`w-full p-4 rounded-card transition-all duration-200 flex items-center gap-4 group ${
                    activeQuote?.carrier === quote.carrier &&
                    activeQuote?.planType === quote.planType
                      ? 'bg-brand-tint border-2 border-brand '
                      : 'bg-sunken border border-rule hover:bg-sunken hover:border-rule-strong'
                  }`}
                >
                  {/* Carrier Logo */}
                  <div
                    className={`w-14 h-14 rounded-card bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden ${
                      idx === 0 ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : ''
                    }`}
                  >
                    {CARRIER_LOGOS[quote.carrier] ? (
                      <img
                        src={CARRIER_LOGOS[quote.carrier]}
                        alt={quote.carrier}
                        className="w-12 h-12 object-contain"
                        onError={e => {
                          e.target.style.display = 'none';
                          e.target.nextSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <span
                      className={`text-ink-3 font-bold text-xs text-center ${CARRIER_LOGOS[quote.carrier] ? 'hidden' : ''}`}
                    >
                      {quote.carrier.substring(0, 3)}
                    </span>
                  </div>

                  {/* Carrier Info */}
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      {idx === 0 && (
                        <span className="px-2 py-0.5 bg-brand text-brand-fg text-xs font-bold rounded-full">
                          BEST RATE
                        </span>
                      )}
                    </div>
                    <p className="text-ink font-bold text-lg truncate">{quote.carrier}</p>
                    <p className="text-ink-2 text-sm">{quote.planType} Plan</p>
                  </div>

                  {/* Premium */}
                  <div className="text-right flex-shrink-0">
                    <p className="text-2xl font-bold text-brand-ink">
                      ${quote.premium?.toFixed(2)}
                    </p>
                    <p className="text-ink-3 text-xs">per month</p>
                  </div>

                  {/* Selection Indicator */}
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                      activeQuote?.carrier === quote.carrier &&
                      activeQuote?.planType === quote.planType
                        ? 'border-brand bg-brand'
                        : 'border-rule-strong group-hover:border-rule-strong'
                    }`}
                  >
                    {activeQuote?.carrier === quote.carrier &&
                      activeQuote?.planType === quote.planType && (
                        <Check className="w-4 h-4 text-ink" />
                      )}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Ineligible Carriers (Collapsed Section) */}
          {!isLoading && ineligibleQuotes.length > 0 && (
            <div className="mt-6">
              <p className="text-ink-3 text-sm font-medium px-1 mb-2">
                Not Available Based on Health Answers ({ineligibleQuotes.length})
              </p>
              <div className="space-y-2 opacity-50">
                {ineligibleQuotes.slice(0, 3).map(quote => (
                  <div
                    key={`${quote.carrier}-${quote.planType}`}
                    className="w-full p-3 rounded-card bg-sunken border border-rule flex items-center gap-3"
                  >
                    <div className="w-10 h-10 rounded-lg bg-sunken flex items-center justify-center flex-shrink-0 overflow-hidden">
                      {CARRIER_LOGOS[quote.carrier] ? (
                        <img
                          src={CARRIER_LOGOS[quote.carrier]}
                          alt={quote.carrier}
                          className="w-8 h-8 object-contain grayscale"
                        />
                      ) : (
                        <span className="text-ink-3 font-bold text-xs">
                          {quote.carrier.substring(0, 3)}
                        </span>
                      )}
                    </div>
                    <div className="flex-1">
                      <p className="text-ink-2 font-medium text-sm">{quote.carrier}</p>
                      <p className="text-ink-3 text-xs">{quote.planType}</p>
                    </div>
                    <span className="text-ink-3 text-sm">${quote.premium?.toFixed(2)}/mo</span>
                  </div>
                ))}
                {ineligibleQuotes.length > 3 && (
                  <p className="text-ink-3 text-xs text-center">
                    +{ineligibleQuotes.length - 3} more carriers
                  </p>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer with Selected Quote Summary */}
        {activeQuote && (
          <div
            className="border-t border-rule p-4"
            style={{
              background: 'var(--sunken)',
            }}
          >
            <button
              onClick={() => setShowQuotePanel(false)}
              className="w-full py-4 rounded-card bg-brand text-brand-fg font-bold text-lg transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              Use {activeQuote.carrier} @ ${activeQuote.premium?.toFixed(2)}/mo
            </button>
          </div>
        )}
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER CARRIER CONFIRMATION PANEL
  // This is the "gatekeeper" that must be confirmed before submission
  // ─────────────────────────────────────────────────────────────────────────
  const renderCarrierConfirmation = () => {
    if (!showCarrierConfirmation) return null;

    return (
      <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/80 ">
        <div
          className="w-full max-w-md mx-4 rounded-card overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--rule)',
          }}
        >
          {/* Header */}
          <div className="px-6 py-4 border-b border-rule ">
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-ink">Confirm Carrier Selection</h3>
              <button
                onClick={() => setShowCarrierConfirmation(false)}
                className="p-1.5 hover:bg-sunken rounded-lg transition-colors"
              >
                <X size={20} className="text-ink-2" />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {activeQuote ? (
              <>
                {/* Carrier Display */}
                <div className="p-4 rounded-card bg-sunken border border-rule">
                  <div className="flex items-center gap-4">
                    {CARRIER_LOGOS[activeQuote.carrier] && (
                      <img
                        src={CARRIER_LOGOS[activeQuote.carrier]}
                        alt={activeQuote.carrier}
                        className="w-16 h-12 object-contain bg-sunken rounded-lg p-2"
                      />
                    )}
                    <div className="flex-1">
                      <p className="text-ink font-bold text-lg">{activeQuote.carrier}</p>
                      <p className="text-ink-2 text-sm">{activeQuote.planType} Plan</p>
                    </div>
                  </div>
                </div>

                {/* Quote Details */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-live-tint border border-live">
                    <p className="text-live-ink text-xs font-medium mb-1">Monthly Premium</p>
                    <p className="text-ink text-2xl font-bold">
                      ${activeQuote.premium?.toFixed(2)}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-money-tint border border-money">
                    <p className="text-money-ink text-xs font-medium mb-1">Coverage Amount</p>
                    <p className="text-ink text-2xl font-bold">
                      ${formData.selectedCoverage?.toLocaleString()}
                    </p>
                  </div>
                </div>

                {/* Customer Summary */}
                <div className="p-3 rounded-lg bg-sunken text-sm">
                  <p className="text-ink-2">
                    Customer:{' '}
                    <span className="text-ink">
                      {formData.firstName} {formData.lastName}
                    </span>
                  </p>
                  <p className="text-ink-2">
                    Age: <span className="text-ink">{formData.age}</span> | Gender:{' '}
                    <span className="text-ink">{formData.gender}</span>
                  </p>
                  <p className="text-ink-2">
                    State: <span className="text-ink">{formData.state}</span>
                  </p>
                </div>

                {/* Warning for non-American Amicable */}
                {activeQuote.carrier !== 'American Amicable' && (
                  <div className="p-3 rounded-lg bg-ringing-tint border border-ringing flex items-start gap-2">
                    <AlertCircle size={18} className="text-ringing-ink flex-shrink-0 mt-0.5" />
                    <p className="text-ringing-ink text-sm">
                      Automated submission is only available for American Amicable. You will need to
                      complete the {activeQuote.carrier} application manually.
                    </p>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => setShowCarrierConfirmation(false)}
                    className="flex-1 py-3 rounded-card bg-sunken hover:bg-rule text-ink font-medium transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmCarrier}
                    className="flex-1 py-3 rounded-card text-ink font-bold transition-all "
                  >
                    <span className="flex items-center justify-center gap-2">
                      <CheckCircle2 size={18} />
                      Confirm Selection
                    </span>
                  </button>
                </div>
              </>
            ) : (
              <div className="text-center py-8">
                <p className="text-ink-2">No carrier selected. Please select a quote first.</p>
                <button
                  onClick={() => {
                    setShowCarrierConfirmation(false);
                    setShowQuotePanel(true);
                  }}
                  className="mt-4 px-6 py-2 rounded-lg bg-brand text-brand-fg font-medium"
                >
                  View Quotes
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN RENDER
  // ─────────────────────────────────────────────────────────────────────────
  if (!node) {
    return (
      <div className="h-full flex items-center justify-center bg-surface rounded-card">
        <p className="text-dropped-ink">Node "{nodeId}" not found</p>
        <button onClick={resetScript} className="ml-4 px-4 py-2 bg-sunken text-ink rounded-lg">
          Reset
        </button>
      </div>
    );
  }

  const progressPercent = (node.phase / 15) * 100;
  const getOptionColor = color => {
    const colors = {
      emerald: 'border-live bg-live-tint hover:bg-brand hover:text-ink',
      amber: 'border-ringing bg-ringing-tint hover:bg-ringing-tint',
      blue: 'border-money bg-money-tint hover:bg-money-tint',
      red: 'border-dropped bg-dropped-tint hover:bg-dropped-tint',
      purple: 'border-brand bg-brand-tint hover:bg-brand-tint',
      orange: 'border-ringing bg-ringing-tint hover:bg-ringing-tint',
    };
    return colors[color] || 'border-rule-strong bg-sunken hover:bg-rule';
  };

  return (
    <div className="h-full flex flex-col bg-surface rounded-card overflow-hidden relative border border-rule">
      {/* HEADER */}
      <div className="flex items-center justify-between px-3 py-2 bg-sunken border-b border-rule flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={goBack}
            disabled={history.length <= 1}
            className="p-1.5 hover:bg-sunken rounded-lg disabled:opacity-30 transition-colors"
          >
            <ChevronLeft size={18} className="text-ink" />
          </button>
          <div>
            <h2 className="text-ink font-bold text-xl">{node.title}</h2>
            <p className="text-ink-3 text-sm">
              Phase {node.phase}/15 • Step {history.length}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {node.tip && (
            <button
              onClick={() => setShowTip(!showTip)}
              className={`p-1.5 rounded-lg transition-colors ${showTip ? 'bg-ringing-tint text-ringing-ink' : 'text-ink-2 hover:bg-sunken'}`}
              title="Show conversion tip"
            >
              <Info size={16} />
            </button>
          )}
          <button
            onClick={copyScript}
            className="p-1.5 hover:bg-sunken rounded-lg text-ink-2 transition-colors"
            title="Copy script"
          >
            {copied ? <Check size={16} className="text-live-ink" /> : <Copy size={16} />}
          </button>
          <button
            onClick={() => setShowQuotePanel(true)}
            className="flex items-center gap-1 px-3 py-1.5 bg-brand rounded-lg text-sm text-ink font-medium transition-all "
          >
            <DollarSign size={14} />
            {!ratesLoaded ? (
              <span className="animate-pulse">Loading...</span>
            ) : activeQuote ? (
              <span>${activeQuote.premium?.toFixed(2)}/mo</span>
            ) : (
              <span>Get Quote</span>
            )}
          </button>

          {/* CONFIRM CARRIER BUTTON - Shows when carrier not yet confirmed */}
          {!confirmedCarrier && (
            <button
              onClick={() => setShowCarrierConfirmation(true)}
              disabled={!activeQuote}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                activeQuote ? ' text-ink ' : 'bg-sunken text-ink-3 cursor-not-allowed'
              }`}
              title="Confirm carrier selection before submitting"
            >
              <CheckCircle2 size={14} />
              <span>Confirm Carrier</span>
            </button>
          )}

          {/* SUBMIT APPLICATION BUTTON - Only enabled after carrier confirmed */}
          {confirmedCarrier && (
            <button
              onClick={handleStartApplication}
              disabled={!isSubmitEnabled}
              className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                automationStarted
                  ? 'bg-live-tint text-live-ink border border-live cursor-default'
                  : isSubmitEnabled
                    ? ' text-ink '
                    : 'bg-sunken text-ink-3 cursor-not-allowed'
              }`}
              title={automationStarted ? 'Application started' : `Submit to ${confirmedCarrier}`}
            >
              {automationStarted ? (
                <>
                  <Check size={14} />
                  <span>App Started</span>
                </>
              ) : (
                <>
                  <Send size={14} />
                  <span>Submit to {confirmedCarrier.split(' ')[0]}</span>
                </>
              )}
            </button>
          )}

          <button
            onClick={resetScript}
            className="p-1.5 hover:bg-sunken rounded-lg text-ink-2 transition-colors"
            title="Reset"
          >
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

      {/* PROGRESS BAR */}
      <div className="h-1 bg-sunken flex-shrink-0">
        <div
          className="h-full bg-brand transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* TIP (Collapsible) */}
      {showTip && node.tip && (
        <div className="px-3 py-2 bg-ringing-tint border-b border-ringing flex-shrink-0">
          <p className="text-ringing-ink text-base font-medium">💡 {node.tip}</p>
        </div>
      )}

      {/* CONTENT - NO SCROLL */}
      <div ref={scrollRef} className="flex-1 overflow-hidden px-3 py-3 flex flex-col">
        {/* DATA SOURCE INDICATOR - Shows for location and DOB screens */}
        {(node.dynamicLocation || node.dynamicDOB) && (
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            {node.dynamicLocation && (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-full ${
                  formData.locationDataSource === 'webhook'
                    ? 'bg-live-tint text-live-ink border-live'
                    : formData.locationDataSource === 'areaCode'
                      ? 'bg-ringing-tint text-ringing-ink border-ringing'
                      : 'bg-money-tint text-money-ink border-money'
                }`}
              >
                <MapPin size={12} />
                {formData.locationDataSource === 'webhook' && 'Location from Webhook Data'}
                {formData.locationDataSource === 'areaCode' && 'State from Area Code'}
                {formData.locationDataSource === 'manual' && 'Manual Entry Required'}
              </span>
            )}
            {node.dynamicDOB && (
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-full ${
                  formData.dobDataSource === 'webhook' && formData.dob
                    ? 'bg-live-tint text-live-ink border-live'
                    : 'bg-money-tint text-money-ink border-money'
                }`}
              >
                <Calendar size={12} />
                {formData.dobDataSource === 'webhook' && formData.dob
                  ? 'DOB from Webhook Data'
                  : 'DOB Required'}
              </span>
            )}
          </div>
        )}

        {/* SCRIPT TEXT - Compact */}
        {/* Handle verify_age specially - show different script if DOB is missing */}
        {node.dynamicDOB && !formData.dob && !formData.age ? (
          // DOB MISSING - Show alternate script and input field
          <div className="mb-3 p-3 rounded-card border border-ringing">
            <div
              className="text-ink text-lg leading-7 font-normal mb-4"
              style={{
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              }}
            >
              <strong className="text-ringing-ink">What is your date of birth, please?</strong>
            </div>

            {/* DOB INPUT FIELD */}
            <div className="mt-3 p-4 rounded-card border-2 border-ringing bg-sunken">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-card flex items-center justify-center">
                  <Calendar className="w-5 h-5 text-ink" />
                </div>
                <div>
                  <p className="text-ink font-bold">Enter Date of Birth</p>
                  <p className="text-ink-2 text-sm">Required for quote calculation</p>
                </div>
              </div>
              <input
                type="date"
                value={formData.dob || ''}
                onChange={e => {
                  const newDob = e.target.value;
                  updateField('dob', newDob);
                  updateField('dobDataSource', 'manual');
                  // Calculate age from DOB
                  if (newDob) {
                    const birthDate = new Date(newDob);
                    const today = new Date();
                    let calculatedAge = today.getFullYear() - birthDate.getFullYear();
                    const monthDiff = today.getMonth() - birthDate.getMonth();
                    if (
                      monthDiff < 0 ||
                      (monthDiff === 0 && today.getDate() < birthDate.getDate())
                    ) {
                      calculatedAge--;
                    }
                    if (calculatedAge >= 0 && calculatedAge <= 120) {
                      updateField('age', calculatedAge);
                    }
                  }
                }}
                max={new Date().toISOString().split('T')[0]}
                min="1900-01-01"
                className="w-full px-4 py-3 bg-sunken border-2 border-ringing rounded-card text-ink text-lg focus:border-ringing focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {formData.dob && formData.age && (
                <p className="mt-2 text-live-ink font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  That makes you {formData.age} years young!
                </p>
              )}
            </div>
          </div>
        ) : (
          // DOB AVAILABLE - Show normal script
          <div className="mb-3 p-3 rounded-card bg-sunken border border-rule">
            <div
              className="text-ink text-lg leading-7 font-normal"
              style={{
                fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
              }}
              dangerouslySetInnerHTML={{
                __html: replaceVars(node.script)
                  .replace(/\*\*(.*?)\*\*/g, '<strong class="text-brand-ink font-bold">$1</strong>')
                  .replace(/\n\n/g, ' ')
                  .replace(/\n/g, ' '),
              }}
            />
          </div>
        )}

        {/* LOCATION VERIFICATION CARD - Compact */}
        {node.dynamicLocation && (
          <div className="mb-2 p-2 rounded-lg border border-rule bg-brand-tint">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-brand-tint flex items-center justify-center flex-shrink-0">
                <MapPin className="w-4 h-4 text-brand-ink" />
              </div>
              <div className="flex-1">
                <p className="text-ink font-medium text-sm">
                  Location:{' '}
                  {formData.locationDataSource === 'webhook'
                    ? `${formData.city}, ${formData.state}`
                    : formData.state || 'N/A'}
                </p>
              </div>
              {formData.locationDataSource === 'areaCode' && (
                <span className="text-ringing-ink text-xs">From area code</span>
              )}
            </div>
          </div>
        )}

        {/* DOB VERIFICATION CARD - Only when DOB is pre-filled via webhook */}
        {node.dynamicDOB && formData.dob && formData.dobDataSource === 'webhook' && (
          <div className="mt-4 p-4 rounded-card border border-rule ">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-card flex items-center justify-center">
                <Calendar className="w-5 h-5 text-ink" />
              </div>
              <div>
                <p className="text-ink font-bold">Date of Birth on File</p>
                <p className="text-ink-2 text-sm">
                  {new Date(formData.dob).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              {formData.age && (
                <div className="ml-auto text-right">
                  <p className="text-2xl font-bold text-brand-ink">{formData.age}</p>
                  <p className="text-ink-3 text-xs">years old</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DOB EDIT CARD - Show when DOB was manually entered and user is on verify_age */}
        {node.dynamicDOB && formData.dob && formData.dobDataSource === 'manual' && (
          <div className="mt-4 p-4 rounded-card border border-brand bg-brand-tint">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-card bg-brand-tint flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-brand-ink" />
              </div>
              <div>
                <p className="text-ink font-bold">Date of Birth Entered</p>
                <p className="text-ink-2 text-sm">
                  {new Date(formData.dob).toLocaleDateString('en-US', {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </p>
              </div>
              {formData.age && (
                <div className="ml-auto text-right">
                  <p className="text-2xl font-bold text-live-ink">{formData.age}</p>
                  <p className="text-ink-3 text-xs">years old</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* DOB OBJECTION REBUTTAL HIGHLIGHT */}
        {node.id === 'health_dob_objection' && (
          <div className="mt-4 p-4 rounded-card border-2 border-ringing bg-ringing-tint">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-ringing-tint flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertCircle className="w-5 h-5 text-ringing-ink" />
              </div>
              <div>
                <p className="text-ringing-ink font-bold text-sm mb-1">Objection Handling Script</p>
                <p className="text-ringing-ink text-sm">
                  Use this rebuttal if the user hesitates or refuses to provide their date of birth.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* DYNAMIC RAPPORT */}
        {node.rapportScript && formData.city && (
          <div className="mt-3 p-3 bg-brand-tint border border-brand rounded-lg">
            <p
              className="text-brand-ink text-sm italic"
              dangerouslySetInnerHTML={{
                __html: replaceVars(node.rapportScript).replace(
                  /\*\*(.*?)\*\*/g,
                  '<strong class="text-brand-ink">$1</strong>'
                ),
              }}
            />
          </div>
        )}

        {/* AGE DISPLAY */}
        {node.ageDisplay && formData.age && (
          <div className="mt-3 p-3 bg-brand-tint border border-brand rounded-lg">
            <p className="text-brand-ink text-sm">
              That makes you <strong className="text-brand-ink">{formData.age} years young</strong>.
            </p>
          </div>
        )}

        {/* COVERAGE SELECTOR - Ultra Compact */}
        {node.showCoverageSelector && (
          <div className="mt-3 p-3 rounded-card border border-rule bg-brand-tint">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-brand-tint flex items-center justify-center flex-shrink-0">
                <DollarSign className="w-4 h-4 text-brand-ink" />
              </div>
              <span className="text-ink font-medium text-sm">Coverage:</span>
              <span className="text-2xl font-bold text-brand-ink ml-auto">
                ${formData.selectedCoverage.toLocaleString()}
              </span>
            </div>

            {/* Coverage Slider */}
            <input
              type="range"
              min="5000"
              max="50000"
              step="2500"
              value={formData.selectedCoverage}
              onChange={e => updateField('selectedCoverage', parseInt(e.target.value))}
              className="w-full h-2 bg-sunken rounded-full appearance-none cursor-pointer mb-2"
              style={{
                background: `linear-gradient(to right, var(--brand) 0%, var(--brand) ${((formData.selectedCoverage - 5000) / 45000) * 100}%, var(--rule) ${((formData.selectedCoverage - 5000) / 45000) * 100}%, var(--rule) 100%)`,
              }}
            />

            {/* Quick Select - Single Row */}
            <div className="flex gap-1 mb-3">
              {[5000, 10000, 15000, 20000, 25000].map(amount => (
                <button
                  key={amount}
                  onClick={() => updateField('selectedCoverage', amount)}
                  className={`flex-1 py-1 rounded text-xs font-medium transition-all ${
                    formData.selectedCoverage === amount
                      ? 'bg-brand text-brand-fg'
                      : 'bg-sunken text-ink-2 hover:bg-sunken'
                  }`}
                >
                  ${amount / 1000}K
                </button>
              ))}
            </div>

            {/* Continue Button */}
            <button
              onClick={() => goTo(node.nextNode)}
              className="w-full py-2 rounded-lg bg-brand text-brand-fg font-bold text-sm flex items-center justify-center gap-2"
            >
              Continue <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* THREE OPTIONS QUOTE DISPLAY */}
        {/* THREE OPTIONS QUOTE DISPLAY - Ultra Compact */}
        {node.showThreeOptions && ratesLoaded && activeQuote && (
          <div className="mt-2 space-y-1.5">
            <div className="flex justify-between items-end px-1">
              <p className="text-ink-2 text-[10px] font-medium uppercase tracking-wider">
                Highest to Lowest
              </p>
              <p className="text-ink-3 text-[10px]">
                {activeQuote.carrier} • {activeQuote.planType}
              </p>
            </div>

            {/* Option 1 - High (+$5000) */}
            {(() => {
              const highCoverage = formData.selectedCoverage + 5000;
              const highPremium = calculateMonthlyPremium(
                activeQuote.carrier,
                formData.age,
                formData.gender,
                formData.tobacco,
                highCoverage,
                activeQuote.planType
              );
              return (
                <div className="px-3 py-2 rounded-lg bg-sunken border border-brand flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-brand flex items-center justify-center text-[10px] text-ink font-bold">
                      1
                    </div>
                    <div>
                      <p className="text-brand-ink font-bold text-xs">Max Protection</p>
                      <p className="text-brand-ink text-[10px]">${highCoverage.toLocaleString()}</p>
                    </div>
                  </div>
                  <p className="text-base font-bold text-brand-ink">
                    ${highPremium?.toFixed(2) || '—'}
                  </p>
                </div>
              );
            })()}

            {/* Option 2 - Mid (Target) */}
            {(() => {
              const midCoverage = formData.selectedCoverage;
              const midPremium = calculateMonthlyPremium(
                activeQuote.carrier,
                formData.age,
                formData.gender,
                formData.tobacco,
                midCoverage,
                activeQuote.planType
              );
              return (
                <div className="px-3 py-2 rounded-lg bg-live-tint border border-live flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-brand flex items-center justify-center text-[10px] text-ink font-bold">
                      2
                    </div>
                    <div>
                      <p className="text-live-ink font-bold text-xs">Standard</p>
                      <p className="text-live-ink text-[10px]">${midCoverage.toLocaleString()}</p>
                    </div>
                  </div>
                  <p className="text-base font-bold text-live-ink">
                    ${midPremium?.toFixed(2) || '—'}
                  </p>
                </div>
              );
            })()}

            {/* Option 3 - Low (-$5000) */}
            {(() => {
              const lowCoverage = Math.max(3000, formData.selectedCoverage - 5000);
              const lowPremium = calculateMonthlyPremium(
                activeQuote.carrier,
                formData.age,
                formData.gender,
                formData.tobacco,
                lowCoverage,
                activeQuote.planType
              );
              return (
                <div className="px-3 py-2 rounded-lg bg-brand-tint border border-brand flex justify-between items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-5 h-5 rounded bg-brand flex items-center justify-center text-[10px] text-ink font-bold">
                      3
                    </div>
                    <div>
                      <p className="text-brand-ink font-bold text-xs">Basic</p>
                      <p className="text-brand-ink text-[10px]">${lowCoverage.toLocaleString()}</p>
                    </div>
                  </div>
                  <p className="text-base font-bold text-brand-ink">
                    ${lowPremium?.toFixed(2) || '—'}
                  </p>
                </div>
              );
            })()}
          </div>
        )}

        {/* QUOTE DISPLAY (embedded) with Coverage Selection */}
        {node.showQuote && (
          <div
            className="mt-4 rounded-card border border-rule overflow-hidden"
            style={{
              background: 'var(--brand-tint)',
            }}
          >
            {/* Coverage Quick Select */}
            <div className="p-4 border-b border-rule">
              <div className="flex items-center justify-between mb-3">
                <span className="text-ink-2 font-medium text-sm">Coverage Amount</span>
                <span className="text-lg font-bold text-brand-ink">
                  ${formData.selectedCoverage.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {COVERAGE_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => updateField('selectedCoverage', opt.value)}
                    className={`px-3 py-1.5 rounded-full font-medium text-xs transition-all ${
                      formData.selectedCoverage === opt.value
                        ? 'bg-brand text-brand-fg '
                        : 'bg-sunken text-ink-2 hover:bg-sunken hover:text-ink border border-rule'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quote Result */}
            <div className="p-4">
              {!ratesLoaded ? (
                /* Loading State */
                <div className="flex items-center gap-4 py-2">
                  <div className="w-14 h-14 rounded-card bg-sunken flex items-center justify-center flex-shrink-0 animate-pulse">
                    <Calculator className="w-6 h-6 text-ink-3" />
                  </div>
                  <div className="flex-1">
                    <div className="h-5 w-32 bg-sunken rounded animate-pulse mb-2"></div>
                    <div className="h-4 w-24 bg-sunken rounded animate-pulse"></div>
                  </div>
                  <div className="text-right">
                    <div className="h-7 w-24 bg-sunken rounded animate-pulse"></div>
                  </div>
                </div>
              ) : activeQuote ? (
                /* Loaded Quote with Logo */
                <div className="flex items-center gap-4">
                  {/* Carrier Logo */}
                  <div className="w-14 h-14 rounded-card bg-surface flex items-center justify-center flex-shrink-0 overflow-hidden ring-2 ring-brand ring-offset-2 ring-offset-transparent">
                    {CARRIER_LOGOS[activeQuote.carrier] ? (
                      <img
                        src={CARRIER_LOGOS[activeQuote.carrier]}
                        alt={activeQuote.carrier}
                        className="w-12 h-12 object-contain"
                      />
                    ) : (
                      <span className="text-ink-3 font-bold text-sm">
                        {activeQuote.carrier?.substring(0, 3)}
                      </span>
                    )}
                  </div>

                  {/* Quote Info */}
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="px-2 py-0.5 bg-brand text-brand-fg text-xs font-bold rounded-full">
                        BEST RATE
                      </span>
                    </div>
                    <p className="text-ink font-bold">{activeQuote.carrier}</p>
                    <p className="text-ink-2 text-sm">{activeQuote.planType} Plan</p>
                  </div>

                  {/* Premium */}
                  <div className="text-right">
                    <p className="text-2xl font-bold text-brand-ink">
                      ${activeQuote.premium?.toFixed(2)}
                    </p>
                    <p className="text-ink-3 text-xs">per month</p>
                  </div>
                </div>
              ) : (
                /* No Quotes Available */
                <div className="text-center py-4">
                  <p className="text-ringing-ink font-medium">No quotes available</p>
                  <p className="text-ink-3 text-xs">Try adjusting coverage or criteria</p>
                </div>
              )}
            </div>

            {/* Action Button */}
            <div className="px-4 pb-4">
              <button
                onClick={() => setShowQuotePanel(true)}
                className="w-full py-3 rounded-card bg-brand text-brand-fg font-bold transition-all hover:scale-[1.02] flex items-center justify-center gap-2"
              >
                <Calculator className="w-4 h-4" />
                Compare All Carriers ({quotes.filter(q => q.isEligible && q.premium).length}{' '}
                available)
              </button>
            </div>
          </div>
        )}

        {/* DATA COLLECTION FIELDS - Compact */}
        {node.fields && node.fields.length > 0 && (
          <div className="mt-2 p-2 bg-sunken border border-rule rounded-lg">
            <div
              className={`grid gap-2 ${node.fields.some(f => f.inline) ? 'grid-cols-3' : 'grid-cols-2'}`}
            >
              {node.fields.map(field => renderField(field))}
            </div>
          </div>
        )}

        {/* DECISION OPTIONS - Compact */}
        {node.options && node.options.length > 0 && (
          <div className="mt-auto pt-2 space-y-1.5">
            {node.options.map((opt, i) => {
              const isPositive =
                opt.color === 'emerald' || opt.label.includes('✅') || opt.label.includes('Yes');
              const isNegative =
                opt.color === 'red' || opt.label.includes('❌') || opt.label.includes('No');
              const isWarning =
                opt.color === 'amber' || opt.color === 'orange' || opt.label.includes('⚠️');

              let buttonStyle = 'border-rule-strong hover:border-rule-strong hover:bg-sunken';
              let dotColor = 'bg-ink-3';

              if (isPositive) {
                buttonStyle = 'border-live hover:border-brand hover:bg-brand hover:text-ink';
                dotColor = 'bg-brand';
              } else if (isNegative) {
                buttonStyle = 'border-dropped hover:border-dropped hover:bg-dropped-tint';
                dotColor = 'bg-dropped';
              } else if (isWarning) {
                buttonStyle = 'border-ringing hover:border-ringing hover:bg-ringing-tint';
                dotColor = 'bg-ringing';
              }

              return (
                <button
                  key={i}
                  onClick={() => goTo(opt.next, { setData: opt.setData })}
                  className={`w-full px-3 py-2.5 rounded-lg bg-sunken ${buttonStyle} border text-left transition-all active:scale-[0.98] flex items-center gap-3`}
                >
                  <div className={`w-2.5 h-2.5 rounded-full ${dotColor} flex-shrink-0`}></div>
                  <span className="font-medium text-ink text-sm flex-1">{opt.label}</span>
                  <ChevronRight className="w-4 h-4 text-ink-3" />
                </button>
              );
            })}
          </div>
        )}

        {/* COMPLETION */}
        {node.isComplete && (
          <div className="mt-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-live-ink mx-auto mb-3" />
            <p className="text-live-ink font-bold text-lg">
              {node.id === 'congrats' ? 'Sale Complete! 🎉' : 'Call Ended'}
            </p>
            <button
              onClick={resetScript}
              className="mt-4 px-6 py-2 bg-sunken hover:bg-rule text-ink rounded-lg flex items-center gap-2 mx-auto"
            >
              <RotateCcw size={16} /> Start New Call
            </button>
          </div>
        )}
      </div>

      {/* AUTOMATION STATUS - Only visible during/after automation */}
      {(automationLoading ||
        automationSteps.length > 0 ||
        automationError ||
        applicationNumber) && (
        <div className="px-3 py-2 border-t border-rule bg-sunken">
          <div className="space-y-1">
            {automationSteps.slice(-3).map((stepData, idx) => (
              <div key={idx} className="flex items-center gap-2 text-xs">
                {stepData.status === 'completed' ? (
                  <CheckCircle2 size={12} className="text-live-ink shrink-0" />
                ) : stepData.status === 'failed' ? (
                  <XCircle size={12} className="text-dropped-ink shrink-0" />
                ) : (
                  <RefreshCw size={12} className="text-brand-ink animate-spin shrink-0" />
                )}
                <span className={stepData.status === 'failed' ? 'text-dropped-ink' : 'text-ink-2'}>
                  {stepData.message}
                </span>
              </div>
            ))}
            {automationLoading && automationSteps.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-ink-2">
                <RefreshCw size={12} className="text-brand-ink animate-spin" />
                Starting automation...
              </div>
            )}
            {applicationNumber && (
              <div className="text-live-ink text-xs font-medium">✓ App #{applicationNumber}</div>
            )}
            {automationError && (
              <div className="flex items-center justify-between gap-2 p-2 bg-dropped-tint rounded-lg border border-dropped">
                <span className="text-dropped-ink text-xs flex-1">{automationError}</span>
                <button
                  onClick={handleRetryApplication}
                  className="px-3 py-1 text-xs font-bold text-white bg-dropped hover:opacity-90 rounded-lg transition-colors flex items-center gap-1"
                >
                  <RotateCcw size={12} />
                  RETRY
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* QUOTE PANEL OVERLAY */}
      {renderQuotePanel()}

      {/* CARRIER CONFIRMATION MODAL */}
      {renderCarrierConfirmation()}

      {/* SETTINGS PANEL MODAL */}
      <SettingsPanel isOpen={showSettingsPanel} onClose={() => setShowSettingsPanel(false)} />
    </div>
  );
};

export default IntegratedScriptPanel;
