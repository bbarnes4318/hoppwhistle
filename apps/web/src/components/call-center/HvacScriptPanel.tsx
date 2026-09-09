'use client';

import {
  FileText,
  User,
  Phone,
  Play,
  ArrowRight,
  HelpCircle,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  MapPin,
  Clock,
} from 'lucide-react';
import React, { useState, useMemo, useEffect } from 'react';

import { useAuth } from '@/hooks/use-auth';

// ─── TYPES ───────────────────────────────────────────────────
interface ProspectData {
  first_name?: string;
  last_name?: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  caller_id?: string;
  city?: string;
  City?: string;
  propertyCity?: string;
  [key: string]: unknown;
}

interface HvacScriptPanelProps {
  prospectData?: ProspectData | null;
  onDataUpdate?: (data: Record<string, unknown>) => void;
}

type ScriptStep =
  | 'opening'
  | 'if_yes'
  | 'give_number'
  | 'connect_now'
  | 'later'
  | 'confirm'
  | 'main_close';

// ─── MAIN COMPONENT ──────────────────────────────────────────
export default function HvacScriptPanel({ prospectData, onDataUpdate }: HvacScriptPanelProps) {
  const { user } = useAuth();

  // Script Flow State
  const [currentStep, setCurrentStep] = useState<ScriptStep>('opening');
  const [history, setHistory] = useState<ScriptStep[]>([]);

  // Custom Overrides / Inputs
  const [agentNameOverride, setAgentNameOverride] = useState('');
  const [cityOverride, setCityOverride] = useState('');
  const [scheduledTime, setScheduledTime] = useState('3:00 PM');

  // Active Rebuttal / FAQ state
  const [activeRebuttal, setActiveRebuttal] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState(false);

  // Sync initial values
  const defaultAgentName = useMemo(() => {
    if (user?.firstName) {
      return user.firstName;
    }
    return 'Agent';
  }, [user]);

  const defaultCity = useMemo(() => {
    return prospectData?.city || prospectData?.City || prospectData?.propertyCity || '';
  }, [prospectData]);

  useEffect(() => {
    if (defaultCity && !cityOverride) {
      setCityOverride(defaultCity);
    }
  }, [defaultCity, cityOverride]);

  const agentName = agentNameOverride || defaultAgentName;
  const city = cityOverride || '[City]';

  // Navigation helpers
  const navigateTo = (step: ScriptStep) => {
    setHistory(prev => [...prev, currentStep]);
    setCurrentStep(step);
    setActiveRebuttal(null); // Clear rebuttal when moving steps
  };

  const goBack = () => {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory(prevHistory => prevHistory.slice(0, -1));
      setCurrentStep(prev);
      setActiveRebuttal(null);
    }
  };

  const resetFlow = () => {
    setCurrentStep('opening');
    setHistory([]);
    setActiveRebuttal(null);
  };

  // Variable replacement helper
  const replaceVars = (text: string) => {
    if (!text) return '';

    // Split into tokens to replace variables with styled spans or inputs
    const processed = text
      .replace(/\[Your Name\]/g, agentName)
      .replace(/\[City\]/g, city)
      .replace(/\[Time\]/g, scheduledTime);

    return processed;
  };

  // Copy to clipboard helper
  const handleCopy = (text: string) => {
    const plainText = text
      .replace(/\[Your Name\]/g, agentName)
      .replace(/\[City\]/g, city)
      .replace(/\[Time\]/g, scheduledTime);
    navigator.clipboard.writeText(plainText).then(() => {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
    });
  };

  // ─── FLOW STAGES DEFINITIONS ───────────────────────────────
  const stepsContent: Record<ScriptStep, { title: string; script: string; phase: string }> = {
    opening: {
      phase: '1. Opening Hook',
      title: 'Opening Pitch',
      script: `Hey, this is [Your Name]. I just sent over a quick text about HVAC appointments in [City].

I’ll be quick — I’m not calling about software or a shared lead list. We’re placing prebooked, in-person HVAC appointments in [City], and we’re looking for one or two local HVAC companies that can take the work.

Are you currently taking on more service calls or installation estimates?`,
    },
    if_yes: {
      phase: '2. Value Proposition',
      title: 'Qualification & Details',
      script: `Perfect. These are homeowner appointments for service calls, repairs, replacements, and install estimates.

They are not aged leads or shared lists. They are scheduled opportunities with homeowners.

How many extra appointments could you handle per week?`,
    },
    give_number: {
      phase: '3. Volume Lock',
      title: 'Transition to Close / Connect',
      script: `Okay, that helps.

I can have Chris show you the available appointment volume in [City], how they are confirmed, and the pricing.

Would now be a bad time to connect you?`,
    },
    connect_now: {
      phase: '4. Live Transfer',
      title: 'Connect Instantly',
      script: `Perfect. Give me one second and I’ll bring Chris on.`,
    },
    later: {
      phase: '4. Schedule Callback',
      title: 'Schedule Meeting',
      script: `No problem. What time today works best?`,
    },
    confirm: {
      phase: '5. Confirmation',
      title: 'Confirm Booking Details',
      script: `Great. I have you down for [Time]. Chris will call you at this number and go over the HVAC appointments available in [City].`,
    },
    main_close: {
      phase: '3. Pitch Alternative',
      title: 'Direct Closes',
      script: `Based on what you told me, it sounds like it is at least worth a quick look.

I can have Chris show you the available HVAC appointments in [City], pricing, and how the appointments are verified.

Would now be a bad time to connect you?`,
    },
  };

  // ─── REBUTTALS / FAQS DEFINITIONS ─────────────────────────
  const rebuttals = [
    {
      id: 'how_works',
      label: 'How does it work?',
      text: `Pretty simple.

We find the homeowner, qualify the request, confirm the appointment, and send the appointment details to the HVAC company.

You are not buying random leads. You are getting scheduled homeowner appointments.`,
    },
    {
      id: 'what_kind',
      label: 'What kind of appointments?',
      text: `Mostly service calls, system checks, repair requests, replacement opportunities, and install estimates.

It depends on what is available in [City] and what type of work you want more of.`,
    },
    {
      id: 'how_much',
      label: 'How much?',
      text: `Pricing depends on the city, volume, and appointment type.

The best next step is to have Chris show you what is available in [City] and go over pricing with you.

Would now be a bad time to connect you?`,
    },
    {
      id: 'send_info',
      label: 'Send me info',
      text: `Absolutely.

Just so I send the right info, are you mainly looking for service calls, installation estimates, replacements, or all of the above?

[After they answer:]

Got it. I’ll send that over. If it looks like a fit, Chris can also walk you through pricing and available volume.

Would later today work for a quick call?`,
    },
    {
      id: 'already_leads',
      label: 'We already have leads',
      text: `Totally understand.

This is different because we are not selling shared internet leads. We are placing prebooked, in-person homeowner appointments.

If we could add a few extra scheduled HVAC opportunities in [City], would it be worth a quick look?`,
    },
    {
      id: 'not_interested',
      label: 'Not interested / Booked',
      text: `No problem.

Just so I know, are you fully booked right now, or do you just not buy appointments at all?

[IF FULLY BOOKED:]
That makes sense. When do you usually start needing more booked work again?

[IF THEY DO NOT BUY APPOINTMENTS:]
Understood. Is that because of bad lead quality in the past?

(If yes): That makes sense. That is exactly why we focus on prebooked appointments instead of shared lead lists. Would you be open to seeing how the appointments are confirmed?`,
    },
  ];

  const currentStepInfo = stepsContent[currentStep];

  return (
    <div className="h-full flex flex-col bg-surface border border-rule rounded-card overflow-hidden">
      {/* Header Banner */}
      <div className="bg-surface border-b border-brand p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-tint rounded-card border border-brand flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-brand-ink animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-black tracking-wider text-brand-ink flex items-center gap-1.5 uppercase">
                HVAC Appointment Sales Script
              </h2>
              <p className="text-[10px] text-ink-2">
                Qualify HVAC companies for prebooked homeowner appointments
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={resetFlow}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] text-ink-2 hover:text-ink border border-rule hover:bg-sunken rounded transition-all"
            >
              <RotateCcw className="w-3 h-3" /> Reset Flow
            </button>
          </div>
        </div>
      </div>

      {/* Script Variables Bar */}
      <div className="bg-sunken border-b border-rule p-3 flex flex-wrap items-center gap-3.5 flex-shrink-0 text-xs text-ink-2">
        {/* Agent Name field */}
        <div className="flex items-center gap-1.5">
          <User className="w-3.5 h-3.5 text-brand-ink" />
          <span className="text-[10px] uppercase font-bold text-ink-2">Agent:</span>
          <input
            type="text"
            value={agentName}
            onChange={e => setAgentNameOverride(e.target.value)}
            className="bg-sunken border border-rule rounded px-2 py-0.5 w-24 text-[11px] focus:outline-none focus:border-brand-ink text-ink font-medium"
            placeholder="Agent Name"
          />
        </div>

        {/* City Field */}
        <div className="flex items-center gap-1.5">
          <MapPin className="w-3.5 h-3.5 text-brand-ink" />
          <span className="text-[10px] uppercase font-bold text-ink-2">City:</span>
          <input
            type="text"
            value={cityOverride}
            onChange={e => {
              setCityOverride(e.target.value);
              onDataUpdate?.({ city: e.target.value });
            }}
            className="bg-sunken border border-rule rounded px-2 py-0.5 w-32 text-[11px] focus:outline-none focus:border-brand-ink text-ink font-medium"
            placeholder="[City]"
          />
        </div>

        {/* Scheduled Time field (used in confirmations) */}
        {(currentStep === 'later' || currentStep === 'confirm') && (
          <div className="flex items-center gap-1.5 animate-fadeIn">
            <Clock className="w-3.5 h-3.5 text-brand-ink" />
            <span className="text-[10px] uppercase font-bold text-ink-2">Time:</span>
            <input
              type="text"
              value={scheduledTime}
              onChange={e => setScheduledTime(e.target.value)}
              className="bg-sunken border border-rule rounded px-2 py-0.5 w-24 text-[11px] focus:outline-none focus:border-brand-ink text-ink font-medium"
              placeholder="e.g. 3:00 PM"
            />
          </div>
        )}
      </div>

      {/* Main Grid: Script + Rebuttals */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Left Panel: Stepper & Active Node Script */}
        <div className="flex-1 p-4 flex flex-col justify-between overflow-y-auto border-r border-rule gap-4">
          <div className="space-y-3">
            {/* Step Phase indicator */}
            <div className="flex justify-between items-center text-[10px] text-ink-2">
              <span className="font-bold text-brand-ink uppercase tracking-widest">
                {currentStepInfo.phase}
              </span>
              <span className="font-mono">{currentStepInfo.title}</span>
            </div>

            {/* Script Text Box */}
            <div className="relative bg-surface border border-brand rounded-card p-4.5 min-h-[140px] group shadow-inner">
              <button
                onClick={() => handleCopy(currentStepInfo.script)}
                className="absolute top-3 right-3 p-1.5 rounded bg-sunken hover:bg-rule text-ink-2 hover:text-ink transition-all border border-rule opacity-0 group-hover:opacity-100"
                title="Copy Script Text"
              >
                {copiedText ? (
                  <Check className="w-3.5 h-3.5 text-live-ink" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>

              <p className="text-ink text-[13px] leading-relaxed whitespace-pre-line font-medium pr-6">
                {replaceVars(currentStepInfo.script)}
              </p>
            </div>
          </div>

          {/* Stepper Navigation Buttons */}
          <div className="border-t border-rule pt-4 flex flex-col gap-2 flex-shrink-0">
            <span className="text-[9px] uppercase tracking-wider font-extrabold text-ink-3 block mb-1">
              Select Response / Script Branch:
            </span>

            <div className="flex flex-wrap gap-2">
              {/* Back Button */}
              {history.length > 0 && (
                <button
                  onClick={goBack}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-ink-2 hover:text-ink border border-rule hover:bg-sunken rounded-lg transition-all"
                >
                  ← Back
                </button>
              )}

              {/* Step Branches */}
              {currentStep === 'opening' && (
                <>
                  <button
                    onClick={() => navigateTo('if_yes')}
                    className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-brand hover:bg-brand-ink hover:text-surface rounded-lg transition-all"
                  >
                    Yes, taking more calls <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      navigateTo('main_close');
                      setActiveRebuttal('not_interested');
                    }}
                    className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4 py-2 text-xs text-dropped-ink hover:text-dropped-ink border border-dropped hover:bg-dropped-tint rounded-lg transition-all"
                  >
                    No / Not interested
                  </button>
                </>
              )}

              {currentStep === 'if_yes' && (
                <button
                  onClick={() => navigateTo('give_number')}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-brand hover:bg-brand-ink hover:text-surface rounded-lg transition-all"
                >
                  Gives a Number / Interest <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}

              {currentStep === 'give_number' && (
                <>
                  <button
                    onClick={() => navigateTo('connect_now')}
                    className="flex-1 min-w-[125px] flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-brand hover:bg-brand-ink hover:text-surface rounded-lg transition-all"
                  >
                    Connect Now <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <button
                    onClick={() => navigateTo('later')}
                    className="flex-1 min-w-[125px] flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-brand hover:bg-brand-ink hover:text-surface rounded-lg transition-all"
                  >
                    Later today / Callback <Clock className="w-3.5 h-3.5" />
                  </button>
                </>
              )}

              {currentStep === 'connect_now' && (
                <button
                  onClick={resetFlow}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-sunken hover:bg-rule border border-rule rounded-lg transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Finish call / Reset
                </button>
              )}

              {currentStep === 'later' && (
                <button
                  onClick={() => navigateTo('confirm')}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-brand hover:bg-brand-ink hover:text-surface rounded-lg transition-all"
                >
                  Log Time & Confirm <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}

              {currentStep === 'confirm' && (
                <button
                  onClick={resetFlow}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-sunken hover:bg-rule border border-rule rounded-lg transition-all"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Finish call / Reset
                </button>
              )}

              {currentStep === 'main_close' && (
                <>
                  <button
                    onClick={() => navigateTo('connect_now')}
                    className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-brand hover:bg-brand-ink hover:text-surface rounded-lg transition-all"
                  >
                    Connect Now <Play className="w-3.5 h-3.5 fill-current" />
                  </button>
                  <button
                    onClick={() => navigateTo('later')}
                    className="flex-1 min-w-[120px] flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-bold text-ink bg-brand hover:bg-brand-ink hover:text-surface rounded-lg transition-all"
                  >
                    Later today / Callback <Clock className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Quick Rebuttals & FAQs */}
        <div className="w-full md:w-80 p-4 bg-sunken flex flex-col justify-between overflow-y-auto gap-4">
          <div className="space-y-3.5">
            <span className="text-[9px] uppercase tracking-wider font-extrabold text-ink-3 block border-b border-rule pb-1.5 flex items-center gap-1">
              <HelpCircle className="w-3 h-3 text-brand-ink" /> Rebuttals & FAQs
            </span>

            <div className="grid grid-cols-2 md:grid-cols-1 gap-1.5">
              {rebuttals.map(reb => (
                <button
                  key={reb.id}
                  onClick={() => setActiveRebuttal(activeRebuttal === reb.id ? null : reb.id)}
                  className={`text-left p-2.5 rounded-lg border text-xs transition-all flex flex-col justify-between gap-1 ${
                    activeRebuttal === reb.id
                      ? 'bg-brand-tint border-brand'
                      : 'bg-surface border-rule hover:bg-sunken hover:border-brand'
                  }`}
                >
                  <span
                    className={`font-bold ${activeRebuttal === reb.id ? 'text-brand-ink' : 'text-ink'}`}
                  >
                    {reb.label}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Active Rebuttal Box */}
          {activeRebuttal && (
            <div className="bg-surface border border-brand rounded-card p-3.5 animate-fadeIn">
              <div className="flex justify-between items-center border-b border-rule pb-1.5 mb-2">
                <span className="text-[9px] uppercase tracking-widest font-black text-brand-ink">
                  Response Script
                </span>
                <button
                  onClick={() =>
                    handleCopy(rebuttals.find(r => r.id === activeRebuttal)?.text || '')
                  }
                  className="text-ink-2 hover:text-ink p-1 hover:bg-sunken rounded transition-all"
                  title="Copy rebuttal response"
                >
                  {copiedText ? (
                    <Check className="w-3 h-3 text-live-ink" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <p className="text-ink text-[11px] leading-relaxed whitespace-pre-line font-medium">
                {replaceVars(rebuttals.find(r => r.id === activeRebuttal)?.text || '')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
