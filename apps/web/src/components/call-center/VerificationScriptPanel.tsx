'use client';

import { useState, useCallback, useMemo } from 'react';
import { HelpCircle, ChevronLeft, ShieldCheck, AlertOctagon, User, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ProspectVerificationData {
  agentName?: string;
  agent_name?: string;
  companyName?: string;
  firstName?: string;
  first_name?: string;
  lastName?: string;
  last_name?: string;
  phone?: string;
  caller_id?: string;
  dob?: string;
  selectedCarrier?: string;
  carrier?: string;
  carrierName?: string;
  selectedCoverage?: string | number;
  coverageAmount?: string | number;
  replacementFaceAmount?: string | number;
  faceAmount?: string | number;
  coverage_amount?: string | number;
  selectedPremium?: string | number;
  monthlyPremium?: string | number;
  premium?: string | number;
  monthly_premium?: string | number;
  requestedEffectiveDate?: string;
  effectiveDate?: string;
  effective_date?: string;
  draftDay?: string;
  draftDate?: string;
  draft_day?: string;
  beneficiaryName?: string;
  primaryBeneficiaryName?: string;
  primaryBenName?: string;
  beneficiary?: string;
  beneficiaryRelation?: string;
  primaryBeneficiaryRelationship?: string;
  primaryBenRel?: string;
  beneficiary_relationship?: string;
}

interface VerificationScriptPanelProps {
  prospectData?: ProspectVerificationData;
  onDataUpdate?: (data: Record<string, unknown>) => void;
  setSelectedDisposition?: (d: string) => void;
  setCallNotes?: (n: string) => void;
  setShowDisposition?: (s: boolean) => void;
}

type StepId =
  | 'greeting'
  | 'remember_call'
  | 'remember_call_yes'
  | 'remember_call_no'
  | 'authorized_app'
  | 'policy_details'
  | 'policy_details_no'
  | 'payment_auth'
  | 'payment_auth_no'
  | 'confirm_beneficiary'
  | 'confirm_beneficiary_no'
  | 'health_answers'
  | 'health_answers_no'
  | 'final_confirmation'
  | 'abort_wrapup';

interface StepOption {
  label: string;
  nextStep: StepId;
  color?: 'emerald' | 'red' | 'blue' | 'amber';
  action?: () => void;
}

interface StepContent {
  id: StepId;
  phase: number;
  title: string;
  subtitle?: string;
  script: string;
  stageDirection?: string;
  options?: StepOption[];
  nextStep?: StepId;
  isEndNode?: boolean;
  suggestedDisposition?: string;
}

export function VerificationScriptPanel({
  prospectData = {},
  onDataUpdate: _onDataUpdate,
  setSelectedDisposition,
  setCallNotes,
  setShowDisposition,
}: VerificationScriptPanelProps): JSX.Element {
  const [activeStepId, setActiveStepId] = useState<StepId>('greeting');
  const [history, setHistory] = useState<StepId[]>([]);

  // Extractions with fallbacks
  const agentName = prospectData?.agentName || prospectData?.agent_name || '[Agent Name]';
  const companyName = prospectData?.companyName || 'American Beneficiary LLC';
  const customerName = `${prospectData?.firstName || prospectData?.first_name || 'Customer'} ${prospectData?.lastName || prospectData?.last_name || ''}`.trim();
  const customerPhone = prospectData?.phone || prospectData?.caller_id || '';
  const customerDOB = prospectData?.dob || '[Date of Birth]';
  const carrierName = prospectData?.selectedCarrier || prospectData?.carrier || prospectData?.carrierName || '[Carrier Name]';
  const coverageAmount = prospectData?.selectedCoverage || prospectData?.coverageAmount || prospectData?.replacementFaceAmount || prospectData?.faceAmount || prospectData?.coverage_amount || '[Face Amount]';
  const monthlyPremium = prospectData?.selectedPremium || prospectData?.monthlyPremium || prospectData?.premium || prospectData?.monthly_premium || '[Premium]';
  const requestedEffectiveDate = prospectData?.requestedEffectiveDate || prospectData?.effectiveDate || prospectData?.effective_date || '[Requested Effective Date]';
  const draftDay = prospectData?.draftDay || prospectData?.draftDate || prospectData?.draft_day || '[Draft Day]';
  const beneficiaryName = prospectData?.beneficiaryName || prospectData?.primaryBeneficiaryName || prospectData?.primaryBenName || prospectData?.beneficiary || '[Beneficiary Name]';
  const beneficiaryRelationship = prospectData?.beneficiaryRelation || prospectData?.primaryBeneficiaryRelationship || prospectData?.primaryBenRel || prospectData?.beneficiary_relationship || '[Relationship]';

  // Navigation function
  const navigateTo = useCallback(
    (stepId: StepId) => {
      setHistory(prev => [...prev, activeStepId]);
      setActiveStepId(stepId);
    },
    [activeStepId]
  );

  const goBack = useCallback(() => {
    if (history.length > 0) {
      const prevStepId = history[history.length - 1];
      setHistory(prev => prev.slice(0, -1));
      setActiveStepId(prevStepId);
    }
  }, [history]);

  // Set disposition helper
  const handleLogDisposition = useCallback((disposition: string, autoNote?: string) => {
    let mapped = disposition;
    if (disposition === 'DENIES_APPLICATION') mapped = 'NOT_INTERESTED';
    else if (disposition === 'PAYMENT_ISSUE') mapped = 'NOT_QUALIFIED';
    else if (disposition === 'POLICY_DETAILS_WRONG') mapped = 'NOT_INTERESTED';
    else if (disposition === 'POSSIBLE_PRESSURE_COACHING') mapped = 'NOT_QUALIFIED';
    else if (disposition === 'NO_CONTACT') mapped = 'NO_ANSWER';

    if (setSelectedDisposition) setSelectedDisposition(mapped);
    if (setCallNotes && autoNote) setCallNotes(autoNote);
    if (setShowDisposition) setShowDisposition(true);
  }, [setSelectedDisposition, setCallNotes, setShowDisposition]);

  // The step definitions
  const STEPS: Record<StepId, StepContent> = useMemo(() => ({
    greeting: {
      id: 'greeting',
      phase: 1,
      title: 'Greeting & Verification',
      subtitle: 'Identify yourself, company, and verify contact identity',
      script: `Agent:
"Hi, this is ${agentName} calling from ${companyName}. I’m calling about a life insurance application that was recently submitted in your name.

Before I discuss anything private, I need to quickly verify I’m speaking with the right person.

Can you please confirm your full name and date of birth?"`,
      stageDirection: 'Verify full name and date of birth against prospect profile data.',
      options: [
        { label: 'Name & DOB Confirmed', nextStep: 'remember_call', color: 'blue' },
        { label: 'Customer Denies / Seems Confused', nextStep: 'abort_wrapup' },
      ],
    },
    remember_call: {
      id: 'remember_call',
      phase: 2,
      title: '1. Confirm They Remember the Call',
      subtitle: 'Ensure applicant remembers policy conversation',
      script: `Agent:
"Thank you. Do you remember speaking with someone recently about a final expense or whole life insurance policy?"

Customer must answer clearly.`,
      stageDirection: 'Listen carefully. If yes, proceed to confirm understanding. If no/confused, go to pause flow.',
      options: [
        { label: 'Yes (Heard/Understood)', nextStep: 'remember_call_yes', color: 'emerald' },
        { label: 'No / Sound Confused / Denies', nextStep: 'remember_call_no', color: 'red' },
      ],
    },
    remember_call_yes: {
      id: 'remember_call_yes',
      phase: 2,
      title: '1a. Explain What They Applied For',
      subtitle: 'Confirm understanding in their own words',
      script: `Agent:
"Great. In your own words, can you tell me what you understood you were applying for?"`,
      stageDirection: 'Listen for words like: life insurance, burial insurance, final expense, whole life, coverage for funeral expenses.',
      options: [
        { label: 'Understands coverage details -> Continue', nextStep: 'authorized_app', color: 'emerald' },
        { label: 'Seems confused / No memory -> Abort', nextStep: 'remember_call_no', color: 'red' },
      ],
    },
    remember_call_no: {
      id: 'remember_call_no',
      phase: 2,
      title: '1b. Pause Application Flow',
      subtitle: 'End call and send application for review',
      script: `Agent:
"No problem. I’m going to pause this application and send it for review. We do not want anything processed unless you clearly remember and understand it."`,
      stageDirection: 'Flag file and log disposition as NO MEMORY / CONFUSED or DENIES APPLICATION.',
      options: [
        {
          label: 'Log No Memory / Confused',
          nextStep: 'remember_call_no',
          color: 'amber',
          action: () => handleLogDisposition('NO_MEMORY_CONFUSED', 'Customer does not clearly remember applying or cannot explain what happened.'),
        },
        {
          label: 'Log Denies Application',
          nextStep: 'remember_call_no',
          color: 'red',
          action: () => handleLogDisposition('DENIES_APPLICATION', 'Customer says they did not apply or did not authorize it.'),
        },
      ],
      isEndNode: true,
    },
    authorized_app: {
      id: 'authorized_app',
      phase: 3,
      title: '2. Confirm They Authorized the Application',
      subtitle: 'Verify authorization and confirm lack of pressure',
      script: `Agent:
"Did you personally give permission for an application to be submitted for this policy?"
(Expected answer: Yes)

"Were you the person speaking on the phone during the application?"
(Expected answer: Yes)

"Did anyone pressure you, rush you, or tell you that you had to do this?"
(Expected answer: No)"`,
      stageDirection: 'If they say yes to pressure, are unclear, or hesitate heavily, route to Abort flow and flag.',
      options: [
        { label: 'Permission granted & No pressure -> Continue', nextStep: 'policy_details', color: 'emerald' },
        { label: 'Suspected Pressure / Coaching -> Abort', nextStep: 'abort_wrapup', action: () => handleLogDisposition('POSSIBLE_PRESSURE_COACHING', 'Customer says they were rushed, pressured, or told what to say.') },
        { label: 'No permission / Denies -> Abort', nextStep: 'abort_wrapup', action: () => handleLogDisposition('DENIES_APPLICATION', 'Customer did not personally authorize application.') },
      ],
    },
    policy_details: {
      id: 'policy_details',
      phase: 4,
      title: '3. Confirm Basic Policy Details',
      subtitle: 'Confirm carrier, coverage, premium, and date details',
      script: `Agent:
"I’m going to confirm the main details so we know everything was explained correctly.

You applied for a ${carrierName} final expense/whole life policy with a coverage amount of $${coverageAmount}.

Your monthly premium is $${monthlyPremium}, and the requested effective date is ${requestedEffectiveDate}.

Does that sound correct?"
(Expected answer: Yes)`,
      stageDirection: 'Confirm details match exactly. If they disagree, stop and send for review.',
      options: [
        { label: 'Details Correct -> Continue', nextStep: 'payment_auth', color: 'emerald' },
        { label: 'Details Wrong -> Abort', nextStep: 'policy_details_no', color: 'red' },
      ],
    },
    policy_details_no: {
      id: 'policy_details_no',
      phase: 4,
      title: '3b. Details Discrepancy Pause',
      subtitle: 'Pause application due to wrong policy details',
      script: `Agent:
"Okay, I’m going to stop this here and send it for review before anything moves forward."`,
      stageDirection: 'End verification. Suggest disposition: POLICY_DETAILS_WRONG.',
      options: [
        {
          label: 'Log Policy Details Wrong',
          nextStep: 'policy_details_no',
          color: 'red',
          action: () => handleLogDisposition('POLICY_DETAILS_WRONG', `Customer disagrees with premium ($${monthlyPremium}), coverage ($${coverageAmount}), carrier (${carrierName}), or effective date (${requestedEffectiveDate}).`),
        },
      ],
      isEndNode: true,
    },
    payment_auth: {
      id: 'payment_auth',
      phase: 5,
      title: '4. Confirm Payment Authorization',
      subtitle: 'Confirm draft day and bank draft approval (Limited Info Only)',
      script: `Agent:
"You selected payment by bank draft/EFT. I am only going to confirm limited information for security.

Did you authorize the insurance company to draft the monthly premium from your bank account?
(Expected answer: Yes)

Do you understand that this is a recurring monthly payment for the policy?
(Expected answer: Yes)

The draft day we have is the ${draftDay} of the month. Is that correct?
(Expected answer: Yes)"`,
      stageDirection: 'DO NOT ask for the full routing number, full account number, or full SSN.',
      options: [
        { label: 'Payment Authorized -> Continue', nextStep: 'confirm_beneficiary', color: 'emerald' },
        { label: 'Payment Issue / Authorization Denied', nextStep: 'payment_auth_no', color: 'red' },
      ],
    },
    payment_auth_no: {
      id: 'payment_auth_no',
      phase: 5,
      title: '4b. Payment Discrepancy Pause',
      subtitle: 'Pause application due to payment issue',
      script: `Agent:
"Thank you. I am going to pause this application immediately and send it for review. We will not draft any payments without full confirmation."`,
      stageDirection: 'Log as PAYMENT ISSUE.',
      options: [
        {
          label: 'Log Payment Issue',
          nextStep: 'payment_auth_no',
          color: 'red',
          action: () => handleLogDisposition('PAYMENT_ISSUE', 'Customer did not understand or authorize bank draft.'),
        },
      ],
      isEndNode: true,
    },
    confirm_beneficiary: {
      id: 'confirm_beneficiary',
      phase: 6,
      title: '5. Confirm Beneficiary',
      subtitle: 'Verify beneficiary name and relationship',
      script: `Agent:
"We also have ${beneficiaryName} listed as your beneficiary, with the relationship listed as ${beneficiaryRelationship}.

Is that correct?"
(Expected answer: Yes)`,
      stageDirection: 'If wrong, note correct details in call notes and flag for update, but you may proceed to health questions.',
      options: [
        { label: 'Correct -> Continue', nextStep: 'health_answers', color: 'emerald' },
        { label: 'Incorrect Beneficiary details', nextStep: 'confirm_beneficiary_no', color: 'amber' },
      ],
    },
    confirm_beneficiary_no: {
      id: 'confirm_beneficiary_no',
      phase: 6,
      title: '5b. Note Beneficiary Corrections',
      subtitle: 'Take note of the corrections and proceed',
      script: `Agent:
"Thank you. I have made a note of the correct beneficiary details so we can update the policy. Let's move to the last few questions."`,
      stageDirection: 'Instruct the agent to write the correct beneficiary name/relationship in the call notes on the right.',
      options: [
        { label: 'Proceed to Health Questions', nextStep: 'health_answers', color: 'emerald' },
      ],
    },
    health_answers: {
      id: 'health_answers',
      phase: 7,
      title: '6. Confirm Health Answers Were Theirs',
      subtitle: 'Verify honesty and personal completion of health questions',
      script: `Agent:
"During the application, you were asked health questions. Were those answers provided by you personally?
(Expected answer: Yes)

Were all of your answers truthful and accurate to the best of your knowledge?
(Expected answer: Yes)"`,
      stageDirection: 'Ensure they confirm answers were accurate. If not, flag policy for review.',
      options: [
        { label: 'Yes, truthful & personal -> Continue', nextStep: 'final_confirmation', color: 'emerald' },
        { label: 'No / Untruthful or Not Personal -> Abort', nextStep: 'health_answers_no', color: 'red' },
      ],
    },
    health_answers_no: {
      id: 'health_answers_no',
      phase: 7,
      title: '6b. Health Discrepancy Pause',
      subtitle: 'Stop verification due to health question discrepancy',
      script: `Agent:
"Okay. I am going to stop this here and send it for review. We want to ensure all medical records match correctly before proceeding."`,
      stageDirection: 'Suggest disposition: POLICY_DETAILS_WRONG or POSSIBLE_PRESSURE_COACHING.',
      options: [
        {
          label: 'Log Policy Details Wrong',
          nextStep: 'health_answers_no',
          color: 'red',
          action: () => handleLogDisposition('POLICY_DETAILS_WRONG', 'Customer claims health answers were not theirs or were inaccurate.'),
        },
      ],
      isEndNode: true,
    },
    final_confirmation: {
      id: 'final_confirmation',
      phase: 8,
      title: '7. Final Confirmation',
      subtitle: 'Final authorization to continue application',
      script: `Agent:
"Just to be clear, do you want this application to continue forward for approval?
(Expected answer: Yes)

Perfect. Thank you. We’re marking your application as verified. If the insurance company needs anything else, they may contact you directly. Do you have any questions before I let you go?"`,
      stageDirection: 'End verification. Log as VERIFIED.',
      options: [
        {
          label: 'Log VERIFIED',
          nextStep: 'final_confirmation',
          color: 'emerald',
          action: () => handleLogDisposition('VERIFIED', 'Customer remembers the call, confirms application, confirms premium/payment, and wants to proceed.'),
        },
        { label: 'Customer Denies at Last Moment', nextStep: 'abort_wrapup', action: () => handleLogDisposition('DENIES_APPLICATION', 'Customer decided not to continue application at final confirmation.') },
      ],
      isEndNode: true,
    },
    abort_wrapup: {
      id: 'abort_wrapup',
      phase: 8,
      title: 'Application Paused (Decline/Confusion)',
      subtitle: 'Standard fallback response for customer denial or heavy confusion',
      script: `Agent:
"Thank you for letting me know. I’m going to pause this application immediately and send it for review. We do not want anything submitted or processed unless you clearly understand it and personally authorized it."`,
      stageDirection: 'Do not argue. Do not explain too much. Do not try to save the sale. End call and select appropriate disposition.',
      options: [
        {
          label: 'Log No Memory / Confused',
          nextStep: 'abort_wrapup',
          color: 'amber',
          action: () => handleLogDisposition('NO_MEMORY_CONFUSED', 'Customer does not clearly remember applying or cannot explain what happened.'),
        },
        {
          label: 'Log Denies Application',
          nextStep: 'abort_wrapup',
          color: 'red',
          action: () => handleLogDisposition('DENIES_APPLICATION', 'Customer says they did not apply or did not authorize it.'),
        },
        {
          label: 'Log Payment Issue',
          nextStep: 'abort_wrapup',
          color: 'orange',
          action: () => handleLogDisposition('PAYMENT_ISSUE', 'Customer did not understand or authorize bank draft.'),
        },
        {
          label: 'Log Policy Details Wrong',
          nextStep: 'abort_wrapup',
          color: 'orange',
          action: () => handleLogDisposition('POLICY_DETAILS_WRONG', 'Customer disagrees with premium, coverage, carrier, beneficiary, or draft date.'),
        },
        {
          label: 'Log Possible Pressure / Coaching',
          nextStep: 'abort_wrapup',
          color: 'red',
          action: () => handleLogDisposition('POSSIBLE_PRESSURE_COACHING', 'Customer says they were rushed, pressured, or told what to say.'),
        },
      ],
      isEndNode: true,
    },
  }), [
    agentName,
    companyName,
    carrierName,
    coverageAmount,
    monthlyPremium,
    requestedEffectiveDate,
    draftDay,
    beneficiaryName,
    beneficiaryRelationship,
    handleLogDisposition,
  ]);

  const currentStep = STEPS[activeStepId] || STEPS.greeting;
  const progress = Math.round((currentStep.phase / 8) * 100);

  const handleOptionSelect = useCallback(
    (option: StepOption) => {
      if (option.action) {
        option.action();
      }
      navigateTo(option.nextStep);
    },
    [navigateTo]
  );

  return (
    <div className="h-full flex flex-col overflow-auto bg-background text-foreground border border-[#2e2e3e] rounded-xl">
      {/* Header Banner */}
      <div className="bg-muted border-b border-[#2e2e3e] p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-500/20 rounded-xl flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-emerald-400 uppercase tracking-wider">
                🛡️ Customer Policy Verification Script
              </h2>
              <p className="text-xs text-muted-foreground">
                Strict quality check and policy validation protocol
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-1 rounded">
            Step {currentStep.phase} / 8
          </span>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Customer Info strip */}
      {customerName && (
        <div className="bg-[#1e1e2e]/55 border-b border-[#2e2e3e] px-4 py-2 flex flex-wrap gap-4 text-xs font-mono text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-white font-medium">{customerName}</span>
          </div>
          {customerDOB && (
            <div className="flex items-center gap-1">
              <span>DOB:</span>
              <span className="text-white font-medium">{customerDOB}</span>
            </div>
          )}
          {customerPhone && (
            <div className="flex items-center gap-1">
              <Phone className="w-3 h-3 text-emerald-400" />
              <span className="text-white font-medium">{customerPhone}</span>
            </div>
          )}
          {carrierName && (
            <div className="flex items-center gap-1 border-l border-border pl-3">
              <span>Carrier:</span>
              <span className="text-white font-medium">{carrierName}</span>
            </div>
          )}
          {coverageAmount && (
            <div className="flex items-center gap-1">
              <span>Coverage:</span>
              <span className="text-white font-medium">${coverageAmount}</span>
            </div>
          )}
          {monthlyPremium && (
            <div className="flex items-center gap-1">
              <span>Premium:</span>
              <span className="text-white font-medium">${monthlyPremium}/mo</span>
            </div>
          )}
        </div>
      )}

      {/* Script Card */}
      <div className="flex-1 p-5 overflow-auto space-y-4">
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 bg-emerald-500/10 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
              <HelpCircle className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-base">{currentStep.title}</h3>
              {currentStep.subtitle && (
                <p className="text-xs text-muted-foreground mt-0.5">{currentStep.subtitle}</p>
              )}
            </div>
          </div>

          {/* Script Text */}
          <div className="bg-muted border border-[#2e2e3e] rounded-lg p-4 font-sans text-sm text-white whitespace-pre-wrap leading-relaxed">
            {currentStep.script}
          </div>

          {/* Stage Direction */}
          {currentStep.stageDirection && (
            <div className="flex items-start gap-2 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20 text-xs text-amber-200">
              <strong>Instruction:</strong> {currentStep.stageDirection}
            </div>
          )}

          {/* Response Buttons */}
          {currentStep.options && currentStep.options.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-mono">Select Response Option:</p>
              <div className="grid gap-2">
                {currentStep.options.map((option, idx) => {
                  const colorClasses = {
                    emerald: 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400',
                    red: 'bg-red-500/10 border-red-500/30 hover:bg-red-500/20 text-red-400',
                    blue: 'bg-emerald-500/10 border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400',
                    amber: 'bg-amber-500/10 border-amber-500/30 hover:bg-emerald-500/20 text-amber-400',
                    orange: 'bg-orange-500/10 border-orange-500/30 hover:bg-orange-500/20 text-orange-400',
                  };
                  const buttonClass = option.color
                    ? colorClasses[option.color as keyof typeof colorClasses]
                    : 'bg-slate-700/50 border-white/10 text-white hover:bg-slate-600/50';

                  return (
                    <Button
                      key={idx}
                      variant="outline"
                      onClick={() => handleOptionSelect(option)}
                      className={cn('justify-start text-left w-full border font-mono text-xs uppercase tracking-wider py-5 transition-all', buttonClass)}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Abort button available at all steps except final wrapups to allow quick pause */}
          {activeStepId !== 'abort_wrapup' && !currentStep.isEndNode && (
            <div className="pt-2 border-t border-border mt-4">
              <Button
                variant="outline"
                onClick={() => navigateTo('abort_wrapup')}
                className="w-full bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20 font-mono text-xs uppercase tracking-wider"
              >
                <AlertOctagon className="w-4 h-4 mr-2" />
                Customer Denies / Seems Confused (Abort)
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Footer Navigation */}
      <div className="flex items-center justify-between p-4 border-t border-[#2e2e3e] bg-card flex-shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={goBack}
          disabled={history.length === 0}
          className="border-border text-muted-foreground hover:bg-muted hover:text-foreground font-mono text-xs uppercase tracking-widest"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <span className="text-xs text-muted-foreground font-mono">
          {history.length} step{history.length !== 1 ? 's' : ''} navigated
        </span>
      </div>
    </div>
  );
}

export default VerificationScriptPanel;
