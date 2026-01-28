'use client';

import {
  Headphones,
  FileText,
  DollarSign,
  Phone,
  User,
  Settings,
  Maximize2,
  Minimize2,
  X,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useCallback, useMemo } from 'react';

import { DialerControls } from './DialerControls';
import { QuotePanel } from './QuotePanel';
import { ScriptPanel } from './ScriptPanel';
import { IntegratedScriptPanel } from './IntegratedScriptPanel';
import { RoleSelector } from './UserRoleSettings';
import { ApplicationSubmission } from './ApplicationSubmission';

import { usePhone } from '@/components/phone/phone-provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  determineEligibilityTier,
  type HealthAnswers,
  type EligibilityResult,
} from '@/lib/call-center/quoteCalculator';
import { type ProspectData, INITIAL_PROSPECT_DATA } from '@/lib/call-center/types';
import { ScriptProvider } from '@/lib/call-center/ScriptContext';
import { cn } from '@/lib/utils';

// ============================================================================
// Call Center Portal - Main Orchestration Component
// Combines: Dialer, Script Panel, Quote Panel
// WIRED TO: hopbot's existing usePhone() hook (NOT fe-rickie's softphoneService)
//
// FULLSCREEN MODE: This component renders in a viewport-locked fullscreen mode
// with no scrollbars. The dashboard layout removes sidebar/header for this page.
// ============================================================================

type ActivePanel = 'script' | 'quotes' | 'both';

export function CallCenterPortal(): JSX.Element {
  const router = useRouter();
  // Using hopbot's existing phone hook
  const { currentCall, agentStatus } = usePhone();

  // Local state for prospect data
  const [prospectData, setProspectData] = useState<Partial<ProspectData>>(INITIAL_PROSPECT_DATA);
  const [activePanel, setActivePanel] = useState<ActivePanel>('both');
  const [selectedCarrier, setSelectedCarrier] = useState<string>('');
  const [selectedPremium, setSelectedPremium] = useState<number>(0);
  const [selectedCoverage, setSelectedCoverage] = useState<number>(0);
  const [selectedPlanType, setSelectedPlanType] = useState<string>('');
  const [isDialerExpanded, setIsDialerExpanded] = useState(true);

  // Compute eligibility tier from health question answers
  const eligibilityResult = useMemo<EligibilityResult>(() => {
    const answers: HealthAnswers = {
      q1: prospectData.q1,
      q2: prospectData.q2,
      q3: prospectData.q3,
      q4: prospectData.q4,
      q5: prospectData.q5,
      q6: prospectData.q6,
      q7a: prospectData.q7a,
      q8a: prospectData.q8a,
      q8b: prospectData.q8b,
      q8c: prospectData.q8c,
    };
    return determineEligibilityTier(answers);
  }, [prospectData]);

  // Update prospect data
  const handleDataUpdate = useCallback((updates: Partial<ProspectData>) => {
    setProspectData(prev => ({ ...prev, ...updates }));
  }, []);

  // Handle quote selection
  const handleQuoteSelect = useCallback(
    (carrier: string, planType: string, premium: number, faceAmount: number) => {
      setSelectedCarrier(carrier);
      setSelectedPremium(premium);
      setSelectedCoverage(faceAmount);
      setSelectedPlanType(planType);
      setProspectData(prev => ({
        ...prev,
        carrier,
        planType,
        monthlyPremium: premium,
        faceAmount,
      }));
    },
    []
  );

  // Handle submission complete
  const handleSubmissionComplete = useCallback((applicationNumber: string) => {
    setProspectData(prev => ({ ...prev, applicationNumber }));
    console.log('[CallCenterPortal] Application submitted:', applicationNumber);
  }, []);

  // Exit fullscreen mode - return to dashboard
  const handleExitFullscreen = useCallback(() => {
    router.push('/dashboard');
  }, [router]);

  // Get status color
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'available':
        return 'bg-emerald-500';
      case 'on-call':
        return 'bg-amber-500';
      case 'away':
        return 'bg-red-500';
      case 'dnd':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <ScriptProvider initialProspectData={prospectData}>
      <div className="h-screen w-screen flex flex-col bg-slate-950 overflow-hidden">
        {/* Compact Header with Exit Button - NO SCROLLING */}}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-2 border-b border-white/10 bg-slate-900/95">
        <div className="flex items-center gap-3">
          {/* Exit Fullscreen Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExitFullscreen}
            className="text-gray-400 hover:text-white hover:bg-white/10"
            title="Exit Call Center (Return to Dashboard)"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Exit
          </Button>

          <div className="h-6 w-px bg-white/20" />

          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center',
              'bg-gradient-to-br from-cyan-500/20 to-blue-500/20',
              'border border-cyan-500/30'
            )}
          >
            <Headphones className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white leading-none">Call Center</h1>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className={cn('w-1.5 h-1.5 rounded-full', getStatusColor(agentStatus))} />
              <span className="capitalize">{agentStatus}</span>
              {currentCall && currentCall.state !== 'ended' && (
                <>
                  <span className="text-gray-600">•</span>
                  <span className="text-cyan-400">Active Call</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Role Selector */}
        <div className="flex items-center gap-3">
          <RoleSelector className="hidden sm:flex" />
          <div className="h-6 w-px bg-white/20 hidden sm:block" />
        </div>

        {/* Panel Toggle */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActivePanel('script')}
            className={cn(
              'h-7 px-2 text-xs',
              activePanel === 'script'
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'text-gray-400 hover:text-white'
            )}
          >
            <FileText className="w-3 h-3 mr-1" />
            Script
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActivePanel('quotes')}
            className={cn(
              'h-7 px-2 text-xs',
              activePanel === 'quotes'
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'text-gray-400 hover:text-white'
            )}
          >
            <DollarSign className="w-3 h-3 mr-1" />
            Quotes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActivePanel('both')}
            className={cn(
              'h-7 px-2 text-xs',
              activePanel === 'both'
                ? 'bg-cyan-500/20 text-cyan-400'
                : 'text-gray-400 hover:text-white'
            )}
          >
            <Maximize2 className="w-3 h-3 mr-1" />
            Both
          </Button>
        </div>
      </div>

      {/* Main Content - FILLS REMAINING VIEWPORT, NO SCROLL */}
      <div className="flex-1 grid grid-cols-12 gap-2 p-2 min-h-0 overflow-hidden">
        {/* Left Column - Dialer & Prospect Info */}
        <div
          className={cn(
            'flex flex-col gap-2 min-h-0 overflow-hidden',
            activePanel === 'both' ? 'col-span-3' : 'col-span-3'
          )}
        >
          {/* Dialer Card */}
          <Card className="flex-shrink-0 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10">
            <CardHeader className="p-3 pb-1 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Phone className="w-3 h-3 text-cyan-400" />
                <h3 className="text-white font-semibold text-xs">Dialer</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-gray-400 hover:text-white"
                onClick={() => setIsDialerExpanded(!isDialerExpanded)}
              >
                {isDialerExpanded ? (
                  <Minimize2 className="w-2.5 h-2.5" />
                ) : (
                  <Maximize2 className="w-2.5 h-2.5" />
                )}
              </Button>
            </CardHeader>
            <CardContent className="p-3 pt-1">
              <DialerControls
                phoneNumber={prospectData.phone}
                onPhoneNumberChange={phone => handleDataUpdate({ phone })}
                compact={!isDialerExpanded}
              />
            </CardContent>
          </Card>

          {/* Prospect Info Card - Fills remaining space */}
          <Card className="flex-1 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 min-h-0 overflow-hidden flex flex-col">
            <CardHeader className="p-3 pb-1 flex-shrink-0">
              <div className="flex items-center gap-2">
                <User className="w-3 h-3 text-cyan-400" />
                <h3 className="text-white font-semibold text-xs">Prospect</h3>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-1 space-y-2 flex-1 overflow-y-auto min-h-0">
              {/* Quick Info */}
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="bg-slate-800/50 rounded-md p-1.5">
                  <span className="text-gray-500 block text-[10px]">Name</span>
                  <span className="text-white font-medium truncate block">
                    {prospectData.firstName
                      ? `${prospectData.firstName} ${prospectData.lastName}`
                      : '-'}
                  </span>
                </div>
                <div className="bg-slate-800/50 rounded-md p-1.5">
                  <span className="text-gray-500 block text-[10px]">Age</span>
                  <span className="text-white font-medium">{prospectData.age || '-'}</span>
                </div>
                <div className="bg-slate-800/50 rounded-md p-1.5">
                  <span className="text-gray-500 block text-[10px]">State</span>
                  <span className="text-white font-medium">{prospectData.state || '-'}</span>
                </div>
                <div className="bg-slate-800/50 rounded-md p-1.5">
                  <span className="text-gray-500 block text-[10px]">Gender</span>
                  <span className="text-white font-medium capitalize">
                    {prospectData.gender || '-'}
                  </span>
                </div>
              </div>

              {/* Selected Quote */}
              {selectedCarrier && (
                <div className="bg-emerald-500/10 rounded-md p-2 border border-emerald-500/20">
                  <span className="text-gray-400 block text-[10px] mb-0.5">Selected</span>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-emerald-400 font-semibold">{selectedCarrier}</span>
                    <span className="text-white font-bold">${prospectData.monthlyPremium}/mo</span>
                  </div>
                </div>
              )}

              {/* Eligibility Tier Badge */}
              <div
                className={cn(
                  'rounded-md p-2 border',
                  eligibilityResult.tier === 'LEVEL' && 'bg-emerald-500/10 border-emerald-500/20',
                  eligibilityResult.tier === 'ROP' && 'bg-blue-500/10 border-blue-500/20',
                  eligibilityResult.tier === 'GRADED' && 'bg-amber-500/10 border-amber-500/20',
                  eligibilityResult.tier === 'NOT_ELIGIBLE' && 'bg-red-500/10 border-red-500/20'
                )}
              >
                <span className="text-gray-400 block text-[10px] mb-0.5">Eligibility</span>
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'font-semibold',
                      eligibilityResult.tier === 'LEVEL' && 'text-emerald-400',
                      eligibilityResult.tier === 'ROP' && 'text-blue-400',
                      eligibilityResult.tier === 'GRADED' && 'text-amber-400',
                      eligibilityResult.tier === 'NOT_ELIGIBLE' && 'text-red-400'
                    )}
                  >
                    {eligibilityResult.planType}
                  </span>
                  <span className="text-gray-400 text-[10px] truncate">
                    {eligibilityResult.message}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Middle/Right - Script and/or Quotes - FILLS VIEWPORT */}
        {activePanel === 'both' ? (
          <>
            {/* Script Panel */}
            <Card className="col-span-5 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 min-h-0 overflow-hidden flex flex-col">
              <CardHeader className="p-3 pb-1 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <FileText className="w-3 h-3 text-cyan-400" />
                  <h3 className="text-white font-semibold text-xs">Script</h3>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-1 flex-1 overflow-y-auto min-h-0">
                <ScriptPanel prospectData={prospectData} onDataUpdate={handleDataUpdate} />
              </CardContent>
            </Card>

            {/* Quote Panel */}
            <Card className="col-span-4 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 min-h-0 overflow-hidden flex flex-col">
              <CardHeader className="p-3 pb-1 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <DollarSign className="w-3 h-3 text-emerald-400" />
                  <h3 className="text-white font-semibold text-xs">Quotes</h3>
                </div>
              </CardHeader>
              <CardContent className="p-3 pt-1 flex-1 overflow-y-auto min-h-0">
                <QuotePanel
                  prospectData={prospectData}
                  onSelectQuote={handleQuoteSelect}
                  selectedCarrier={selectedCarrier}
                />
                {/* Application Submission - Shows after carrier selection */}
                {selectedCarrier && (
                  <div className="mt-4 pt-4 border-t border-white/10">
                    <ApplicationSubmission
                      prospectData={prospectData}
                      selectedCarrier={selectedCarrier}
                      selectedPremium={selectedPremium}
                      selectedCoverage={selectedCoverage}
                      selectedPlanType={selectedPlanType}
                      onSubmissionComplete={handleSubmissionComplete}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        ) : activePanel === 'script' ? (
          <Card className="col-span-9 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 min-h-0 overflow-hidden flex flex-col">
            <CardHeader className="p-3 pb-1 flex-shrink-0">
              <div className="flex items-center gap-2">
                <FileText className="w-3 h-3 text-cyan-400" />
                <h3 className="text-white font-semibold text-xs">Script</h3>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-1 flex-1 overflow-y-auto min-h-0">
              <ScriptPanel prospectData={prospectData} onDataUpdate={handleDataUpdate} />
            </CardContent>
          </Card>
        ) : (
          <Card className="col-span-9 bg-gradient-to-b from-slate-900/95 to-slate-950/95 border-white/10 min-h-0 overflow-hidden flex flex-col">
            <CardHeader className="p-3 pb-1 flex-shrink-0">
              <div className="flex items-center gap-2">
                <DollarSign className="w-3 h-3 text-emerald-400" />
                <h3 className="text-white font-semibold text-xs">Quotes</h3>
              </div>
            </CardHeader>
            <CardContent className="p-3 pt-1 flex-1 overflow-y-auto min-h-0">
              <QuotePanel
                prospectData={prospectData}
                onSelectQuote={handleQuoteSelect}
                selectedCarrier={selectedCarrier}
              />
              {/* Application Submission - Shows after carrier selection */}
              {selectedCarrier && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <ApplicationSubmission
                    prospectData={prospectData}
                    selectedCarrier={selectedCarrier}
                    selectedPremium={selectedPremium}
                    selectedCoverage={selectedCoverage}
                    selectedPlanType={selectedPlanType}
                    onSubmissionComplete={handleSubmissionComplete}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      </div>
    </ScriptProvider>
  );
}

export default CallCenterPortal;
