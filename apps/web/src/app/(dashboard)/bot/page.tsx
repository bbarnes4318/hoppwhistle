'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useState, useEffect, useRef, Suspense, useCallback } from 'react';

import { CampaignHeader, CampaignStatus } from './components/CampaignHeader';
import { StepState } from './components/CampaignStepper';
import { ContextPanel } from './components/ContextPanel';
import { LaunchConfirmationModal } from './components/LaunchConfirmationModal';
import { LiveMonitoringDrawer } from './components/LiveMonitoringDrawer';
import { ReadinessBanner } from './components/ReadinessBanner';
import { SaveStatus } from './components/SaveIndicator';
import { Step1VoiceScript } from './components/steps/Step1VoiceScript';
import { Step2RoutingNumbers } from './components/steps/Step2RoutingNumbers';
import { Step3LeadsCampaign, LeadUploadError } from './components/steps/Step3LeadsCampaign';
import { Step4ReviewLaunch } from './components/steps/Step4ReviewLaunch';

// Deepgram Aura voices
const VOICES = [
  { id: 'aura-asteria-en', name: 'Asteria', gender: 'Female', accent: 'American' },
  { id: 'aura-luna-en', name: 'Luna', gender: 'Female', accent: 'American' },
  { id: 'aura-stella-en', name: 'Stella', gender: 'Female', accent: 'American' },
  { id: 'aura-athena-en', name: 'Athena', gender: 'Female', accent: 'British' },
  { id: 'aura-hera-en', name: 'Hera', gender: 'Female', accent: 'American' },
  { id: 'aura-orion-en', name: 'Orion', gender: 'Male', accent: 'American' },
  { id: 'aura-arcas-en', name: 'Arcas', gender: 'Male', accent: 'American' },
  { id: 'aura-perseus-en', name: 'Perseus', gender: 'Male', accent: 'American' },
  { id: 'aura-angus-en', name: 'Angus', gender: 'Male', accent: 'Irish' },
  { id: 'aura-orpheus-en', name: 'Orpheus', gender: 'Male', accent: 'American' },
  { id: 'aura-helios-en', name: 'Helios', gender: 'Male', accent: 'British' },
  { id: 'aura-zeus-en', name: 'Zeus', gender: 'Male', accent: 'American' },
];

const DEFAULT_SCRIPT = `Hello! This is a quick call from {company}.

We're reaching out about the final expense coverage you requested information on.

Is this a good time to speak for just a moment?`;

interface Lead {
  id: string;
  phone: string;
  name?: string;
  status: 'pending' | 'calling' | 'success' | 'failed' | 'no_answer';
}

interface DialerStatus {
  status: CampaignStatus;
  active_calls: number;
  completed: number;
  remaining: number;
  timestamp: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

function BotDashboardContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Get current step from URL, default to 1
  const currentStep = parseInt(searchParams.get('step') || '1', 10);
  const setCurrentStep = (step: number) => {
    router.push(`/bot?step=${step}`);
  };

  // Campaign state
  const [campaignName, setCampaignName] = useState('New Campaign');
  const [campaignStatus, setCampaignStatus] = useState<CampaignStatus>('idle');
  const [activeCalls, setActiveCalls] = useState(0);
  const [completedCalls, setCompletedCalls] = useState(0);
  const [remainingCalls, setRemainingCalls] = useState(0);

  // Configuration state
  const [concurrency, setConcurrency] = useState(5);
  const [selectedVoice, setSelectedVoice] = useState('aura-asteria-en');
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [transferPhoneNumber, setTransferPhoneNumber] = useState('');
  const [callerId, setCallerId] = useState('');
  const [availableDids, setAvailableDids] = useState<string[]>([]);

  // Setup state
  const [hasPreviewedVoice, setHasPreviewedVoice] = useState(false);
  const [isScriptSaved, setIsScriptSaved] = useState(false);

  // Leads state
  const [leads, setLeads] = useState<Lead[]>([]);
  const [leadUploadError, setLeadUploadError] = useState<LeadUploadError | null>(null);

  // Save state
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Launch confirmation modal
  const [showLaunchModal, setShowLaunchModal] = useState(false);

  // Audio ref for voice preview
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Stats
  const [stats] = useState({
    transferred: 0,
  });

  // Auto-save function
  const performSave = useCallback(async () => {
    setSaveStatus('saving');
    try {
      const res = await fetch(`${API_URL}/api/bot/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          voice: selectedVoice,
          concurrency,
          transferPhoneNumber,
          callerId,
        }),
      });
      if (res.ok) {
        setSaveStatus('saved');
        setIsScriptSaved(true);
        // Clear saved status after 3 seconds
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        setSaveStatus('error');
      }
    } catch {
      setSaveStatus('error');
    }
  }, [script, selectedVoice, concurrency, transferPhoneNumber, callerId]);

  // Debounced auto-save on script changes
  const scriptDebounceRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    if (!isScriptSaved && script !== DEFAULT_SCRIPT) {
      if (scriptDebounceRef.current) clearTimeout(scriptDebounceRef.current);
      scriptDebounceRef.current = setTimeout(() => {
        void performSave();
      }, 2000);
    }
    return () => {
      if (scriptDebounceRef.current) clearTimeout(scriptDebounceRef.current);
    };
  }, [script, isScriptSaved, performSave]);

  // Load saved settings on mount
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const res = await fetch('/api/bot/settings');
        if (res.ok) {
          const data = await res.json();
          if (data.script) {
            setScript(data.script);
            setIsScriptSaved(true);
          }
          if (data.voice) setSelectedVoice(data.voice);
          if (data.concurrency) setConcurrency(data.concurrency);
          if (data.transferPhoneNumber) setTransferPhoneNumber(data.transferPhoneNumber);
          if (data.callerId) setCallerId(data.callerId);
        }
      } catch {
        // Use defaults
      }
    };
    void loadSettings();
  }, []);

  // Load DIDs
  useEffect(() => {
    const loadDids = async () => {
      try {
        const res = await fetch('/api/bot/dids');
        if (res.ok) {
          const data = await res.json();
          setAvailableDids(data.dids || []);
        }
      } catch {
        // Silent fail
      }
    };
    void loadDids();
  }, []);

  // Poll for status updates
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const res = await fetch('/api/bot/status');
        if (res.ok) {
          const data: DialerStatus = await res.json();
          setCampaignStatus(data.status);
          setActiveCalls(data.active_calls);
          setCompletedCalls(data.completed);
          setRemainingCalls(data.remaining);
        }
      } catch {
        // Silent fail
      }
    };

    void pollStatus();
    const interval = setInterval(() => void pollStatus(), 2000);
    return () => clearInterval(interval);
  }, []);

  // Step completion logic
  const step1Complete = Boolean(selectedVoice && isScriptSaved);
  const step1Warnings = !hasPreviewedVoice ? ['Voice preview recommended'] : [];

  const step2Complete = transferPhoneNumber.length >= 10;
  const step2Warnings = !callerId ? ['Using random caller ID'] : [];

  const step3Complete = leads.length > 0 && !leadUploadError;
  const step3Warnings: string[] = [];

  const isReady = step1Complete && step2Complete && step3Complete;

  const steps: StepState[] = [
    {
      id: 1,
      label: 'Voice & Script',
      complete: step1Complete,
      hasWarning: step1Warnings.length > 0,
    },
    { id: 2, label: 'Routing', complete: step2Complete, hasWarning: step2Warnings.length > 0 },
    { id: 3, label: 'Leads', complete: step3Complete, hasWarning: step3Warnings.length > 0 },
    { id: 4, label: 'Review', complete: isReady, hasWarning: false },
  ];

  // Blocking issues for banner
  const blockingIssues: string[] = [];
  if (!selectedVoice) blockingIssues.push('Select a voice');
  if (!isScriptSaved) blockingIssues.push('Save your script');
  if (!step2Complete) blockingIssues.push('Add transfer number');
  if (!step3Complete) blockingIssues.push('Upload leads');

  const allWarnings = [...step1Warnings, ...step2Warnings];

  // Handlers
  const handleStartRequest = () => {
    if (!isReady) return;
    setShowLaunchModal(true);
  };

  const handleConfirmStart = async () => {
    try {
      const res = await fetch(`${API_URL}/api/bot/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          concurrency,
          script,
          voice: selectedVoice,
          transferPhoneNumber,
          callerId,
        }),
      });
      if (res.ok) {
        setCampaignStatus('running');
      }
    } catch (e) {
      console.error('Failed to start campaign:', e);
    }
  };

  const handlePause = async () => {
    try {
      await fetch(`${API_URL}/api/bot/pause`, { method: 'POST' });
      setCampaignStatus('paused');
    } catch (e) {
      console.error('Failed to pause campaign:', e);
    }
  };

  const handleStop = async () => {
    try {
      await fetch(`${API_URL}/api/bot/stop`, { method: 'POST' });
      setCampaignStatus('idle');
    } catch (e) {
      console.error('Failed to stop campaign:', e);
    }
  };

  const handlePreviewVoice = async () => {
    try {
      const res = await fetch(`${API_URL}/api/bot/tts/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: script, voice: selectedVoice }),
      });
      if (res.ok) {
        const blob = await res.blob();
        const audio = new Audio(URL.createObjectURL(blob));
        audioRef.current = audio;
        void audio.play();
        setHasPreviewedVoice(true);
      }
    } catch (e) {
      console.error('TTS preview failed:', e);
    }
  };

  const handleSaveSettings = async () => {
    await performSave();
  };

  const handleUploadLeads = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.txt')) {
      setLeadUploadError({
        type: 'invalid_file',
        message: 'Please upload a CSV or TXT file.',
      });
      return;
    }

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_URL}/api/bot/leads/upload`, {
        method: 'POST',
        body: formData,
      });
      if (res.ok) {
        const data = await res.json();
        if (!data.leads || data.leads.length === 0) {
          setLeadUploadError({
            type: 'empty_file',
            message: 'The file contains no valid phone numbers.',
          });
          return;
        }
        setLeads(data.leads);
        setRemainingCalls(data.leads.length);
        setLeadUploadError(null);
        // Trigger auto-save after successful upload
        void performSave();
      } else {
        const errorData = await res.json().catch(() => ({}));
        setLeadUploadError({
          type: 'upload_failed',
          message: errorData.message || 'Failed to process the file. Please try again.',
        });
      }
    } catch {
      setLeadUploadError({
        type: 'upload_failed',
        message: 'Network error. Please check your connection and try again.',
      });
    }
  };

  const selectedVoiceData = VOICES.find(v => v.id === selectedVoice);

  // Render current step content
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <Step1VoiceScript
            selectedVoice={selectedVoice}
            onVoiceChange={setSelectedVoice}
            script={script}
            onScriptChange={setScript}
            hasPreviewedVoice={hasPreviewedVoice}
            onPreviewVoice={handlePreviewVoice}
            isScriptSaved={isScriptSaved}
            onSaveScript={handleSaveSettings}
            onContinue={() => setCurrentStep(2)}
            apiUrl={API_URL}
          />
        );
      case 2:
        return (
          <Step2RoutingNumbers
            transferPhoneNumber={transferPhoneNumber}
            onTransferPhoneNumberChange={setTransferPhoneNumber}
            callerId={callerId}
            onCallerIdChange={setCallerId}
            availableDids={availableDids}
            onContinue={() => setCurrentStep(3)}
            onBack={() => setCurrentStep(1)}
          />
        );
      case 3:
        return (
          <Step3LeadsCampaign
            leads={leads}
            onUploadLeads={handleUploadLeads}
            concurrency={concurrency}
            onConcurrencyChange={setConcurrency}
            onContinue={() => setCurrentStep(4)}
            onBack={() => setCurrentStep(2)}
            uploadError={leadUploadError}
            onClearError={() => setLeadUploadError(null)}
          />
        );
      case 4:
        return (
          <Step4ReviewLaunch
            campaignName={campaignName}
            voiceName={selectedVoiceData?.name || ''}
            transferNumber={transferPhoneNumber}
            callerId={callerId}
            leadCount={leads.length}
            concurrency={concurrency}
            stepStatuses={{
              step1: { complete: step1Complete, warnings: step1Warnings },
              step2: { complete: step2Complete, warnings: step2Warnings },
              step3: { complete: step3Complete, warnings: step3Warnings },
            }}
            isReady={isReady}
            onStart={handleStartRequest}
            onBack={() => setCurrentStep(3)}
            onGoToStep={setCurrentStep}
          />
        );
      default:
        return null;
    }
  };

  const successRate =
    completedCalls > 0 ? Math.round((stats.transferred / completedCalls) * 100) : 0;
  const isMonitoringVisible = campaignStatus === 'running' || campaignStatus === 'paused';

  return (
    <div className="flex flex-col min-h-screen">
      {/* Sticky Header */}
      <CampaignHeader
        campaignName={campaignName}
        onCampaignNameChange={setCampaignName}
        status={campaignStatus}
        currentStep={currentStep}
        steps={steps}
        onStepClick={setCurrentStep}
        isReady={isReady}
        onStart={handleStartRequest}
        onPause={() => void handlePause()}
        onStop={() => void handleStop()}
        canEditName={currentStep === 1}
        saveStatus={saveStatus}
        onRetrySave={() => void performSave()}
      />

      {/* Readiness Banner */}
      <ReadinessBanner isReady={isReady} blockingIssues={blockingIssues} warnings={allWarnings} />

      {/* Main Content: Two-Column Layout */}
      <div className="flex flex-1">
        {/* Primary Workspace (70%) */}
        <main
          className="flex-1 p-6 overflow-y-auto"
          style={{ paddingBottom: isMonitoringVisible ? '180px' : '24px' }}
        >
          <div className="max-w-4xl mx-auto">{renderStepContent()}</div>
        </main>

        {/* Context Panel (30%) - Hidden on mobile */}
        <div className="hidden lg:block">
          <ContextPanel currentStep={currentStep} />
        </div>
      </div>

      {/* Live Monitoring Drawer */}
      <LiveMonitoringDrawer
        isVisible={isMonitoringVisible}
        activeCalls={activeCalls}
        completedCalls={completedCalls}
        remainingCalls={remainingCalls}
        successRate={successRate}
        concurrency={concurrency}
      />

      {/* Launch Confirmation Modal */}
      <LaunchConfirmationModal
        open={showLaunchModal}
        onOpenChange={setShowLaunchModal}
        onConfirm={() => void handleConfirmStart()}
        leadCount={leads.length}
        voiceName={selectedVoiceData?.name || ''}
        transferNumber={transferPhoneNumber}
      />
    </div>
  );
}

export default function BotDashboard() {
  return (
    <Suspense
      fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}
    >
      <BotDashboardContent />
    </Suspense>
  );
}
