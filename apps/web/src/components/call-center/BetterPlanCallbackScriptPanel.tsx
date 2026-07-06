'use client';

import {
  ShieldAlert,
  ChevronRight,
  RotateCcw,
  CheckCircle2,
  HelpCircle,
  ChevronLeft,
  UserCheck,
  Clock,
} from 'lucide-react';
import React, { useState, useEffect, useMemo, useCallback } from 'react';

import { apiClient } from '@/lib/api';

interface BetterPlanCallbackScriptPanelProps {
  prospectData?: any;
  leadId?: string | null;
  onDataUpdate?: (data: Record<string, unknown>) => void;
  setSelectedDisposition?: (disp: string) => void;
  setCallNotes?: (notes: string) => void;
  setShowDisposition?: (show: boolean) => void;
}

type NodeId =
  | 'greeting_start'
  | 'transfer_bridge'
  | 'transfer_failed'
  | 'schedule_callback'
  | 'confirm_callback'
  // Objections
  | 'what_is_this_about'
  | 'already_have_insurance'
  | 'is_this_sales_call'
  | 'trying_to_sell_another_policy'
  | 'dont_want_to_change_anything'
  | 'something_wrong_with_policy'
  | 'why_didnt_i_get_plan_before'
  | 'what_is_new_price'
  | 'how_much_will_i_save'
  | 'im_busy'
  | 'make_it_quick'
  | 'send_me_something'
  | 'need_to_think_about_it'
  | 'talk_to_family'
  | 'dont_trust_this'
  | 'know_this_is_real'
  | 'dont_give_personal_info'
  | 'cant_afford_more'
  | 'dont_want_two_payments'
  | 'canceling_current_policy'
  | 'will_i_lose_coverage'
  | 'did_my_payment_go_up'
  | 'stopped_paying_policy'
  | 'never_bought_that'
  | 'who_are_you_again'
  | 'what_company_are_you_with'
  | 'not_interested'
  | 'take_me_off_list'
  | 'angry_customer'
  | 'what_do_you_need_from_me'
  // Exits
  | 'polite_exit'
  | 'dnc_exit'
  | 'end_call';

interface ScriptNode {
  text: string;
  type?:
    | 'opening_statement'
    | 'bridge'
    | 'reassurance'
    | 'objection_handler'
    | 'exit'
    | 'callback_setter'
    | 'callback_confirmation';
  capture_variable?: string;
  options: Record<string, NodeId>;
  phase: 1 | 2 | 3 | 4; // 1 = greeting, 2 = transfer/callback, 3 = objections, 4 = exits
  phaseName: string;
  timingLabel: string;
}

const SCRIPT_NODES: Record<NodeId, ScriptNode> = {
  greeting_start: {
    text: 'Hi, this is Chantal. I’m calling about the final expense plan you purchased from [Carrier] last December.\n\nWe’ve actually found a plan that may be better for you because it could provide the same or more coverage and bring down your monthly payment.\n\nIf you have 5 minutes, I’ll add your licensed agent on the call and they’ll go over the details with you.\n\nCan I go ahead and add your agent on the call?',
    type: 'opening_statement',
    options: {
      'Yes / Agree to add agent': 'transfer_bridge',
      'What is this about?': 'what_is_this_about',
      'Already have insurance': 'already_have_insurance',
      'Is this a sales call?': 'is_this_sales_call',
      'Trying to sell another policy?': 'trying_to_sell_another_policy',
      "Don't want to change anything": 'dont_want_to_change_anything',
    },
    phase: 1,
    phaseName: 'Opening & Reason for Call',
    timingLabel: 'Phase 1: 0:00 - 0:45',
  },
  transfer_bridge: {
    text: 'Perfect. I’m adding your licensed agent now.\n\nJust so you know, they’ll review the current plan, explain the better option, and make sure nothing changes unless you understand it and decide it makes sense.\n\nHold on one moment while I bring them on.',
    type: 'bridge',
    options: {
      'Transfer Succeeded (End Call)': 'end_call',
      'Transfer Failed / Agent Unavailable': 'transfer_failed',
    },
    phase: 2,
    phaseName: 'Live Agent Transfer',
    timingLabel: 'Phase 2: Transferring',
  },
  transfer_failed: {
    text: 'It looks like the licensed agent is tied up for a moment.\n\nThis is important because it may lower your monthly payment.\n\nWhat time today would be best for them to call you back?',
    type: 'objection_handler',
    options: {
      'Schedule Callback': 'schedule_callback',
    },
    phase: 2,
    phaseName: 'Agent Unavailable',
    timingLabel: 'Phase 2: Fallback',
  },
  schedule_callback: {
    text: 'Okay, I’ll schedule the licensed agent to call you back at {callback_time}.\n\nJust so they know, you’re interested in reviewing whether we can get you the same or more final expense coverage at a lower monthly payment.\n\nIs that correct?',
    type: 'callback_setter',
    capture_variable: 'callbackTime',
    options: {
      'Yes (Confirm Callback)': 'confirm_callback',
      'No / Decline': 'polite_exit',
    },
    phase: 2,
    phaseName: 'Scheduling Callback',
    timingLabel: 'Phase 2: Callback',
  },
  confirm_callback: {
    text: 'Perfect. They’ll call you at {callback_time}. Have a good day.',
    type: 'callback_confirmation',
    options: {
      'End Call': 'end_call',
    },
    phase: 2,
    phaseName: 'Callback Confirmed',
    timingLabel: 'Phase 2: Complete',
  },
  what_is_this_about: {
    text: 'It’s just a policy review on the final expense plan you started last December with [Carrier].\n\nThe reason for the call is that we found an option that may give you the same or more coverage while lowering the monthly payment.\n\nYour licensed agent needs to review the actual details with you.\n\nCan I add them on real quick?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Policy Review details',
  },
  already_have_insurance: {
    text: 'Right, and that’s exactly why we’re calling.\n\nThis is not about adding another bill. It’s about seeing if the policy you already have can be improved — either same coverage for less money, or more coverage without increasing the payment.\n\nThe licensed agent can explain the comparison in just a few minutes.\n\nCan I add them on?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Existing Insurance',
  },
  is_this_sales_call: {
    text: 'It’s a policy review call.\n\nYou already purchased a final expense plan, and we’re calling because there may be a better option available now.\n\nNothing changes unless the licensed agent explains it, you understand it, and you decide it makes sense.\n\nCan I add the licensed agent so they can walk you through it?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Sales Call check',
  },
  trying_to_sell_another_policy: {
    text: 'No, not another bill.\n\nThe goal is to see if we can replace what you have with something better — same or more coverage at a lower monthly payment if you qualify.\n\nYour current policy should stay active unless a new plan is approved and you choose to move forward.\n\nCan I add your licensed agent on the call?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Another Policy',
  },
  dont_want_to_change_anything: {
    text: 'I understand. Nothing is being changed right now.\n\nThe licensed agent is only going to show you the comparison. If it doesn’t help you, you keep what you already have.\n\nCan I add them on so you can at least hear the numbers?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Change aversion',
  },
  something_wrong_with_policy: {
    text: 'No, nothing is wrong with your policy.\n\nThis is not a problem call. It’s a review call because we found an option that may be better for you.\n\nThe licensed agent can confirm everything and explain the comparison.\n\nCan I add them on?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Wrong policy fear',
  },
  why_didnt_i_get_plan_before: {
    text: 'That’s a fair question.\n\nPlans, rates, and eligibility can change. That’s why we’re reviewing it now instead of just leaving you in the same plan without checking.\n\nThe licensed agent can explain what changed and whether it actually benefits you.\n\nCan I add them on?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Why not before',
  },
  what_is_new_price: {
    text: 'The licensed agent has to review the exact numbers with you because it depends on the coverage, your age, state, and eligibility.\n\nThe reason I’m calling is because it looks like there may be an option that lowers the monthly payment.\n\nCan I add the agent so they can give you the exact details?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'New price inquiry',
  },
  how_much_will_i_save: {
    text: 'That’s exactly what the licensed agent will go over.\n\nI don’t want to give you the wrong number, but the reason for the call is that we found a plan that may lower your payment while keeping the same or more coverage.\n\nCan I add them on now?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Savings details',
  },
  im_busy: {
    text: 'I understand. This should only take about 5 minutes.\n\nThe only reason I don’t want you to miss it is because it may lower your monthly payment on the coverage you already have.\n\nCan I add the agent quickly, or would later today be better?',
    type: 'objection_handler',
    options: {
      'Yes, now': 'transfer_bridge',
      'Later today': 'schedule_callback',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Busy prospect',
  },
  make_it_quick: {
    text: 'Absolutely. I’ll keep it simple.\n\nWe found a possible better plan for your final expense coverage. The licensed agent just needs a few minutes to review the numbers with you.\n\nCan I add them now?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Make it quick',
  },
  send_me_something: {
    text: 'I can make a note, but the details need to be reviewed first because the numbers are personal to your policy.\n\nThe licensed agent can explain it in a few minutes, and then you can decide if you want anything sent or if you want to move forward.\n\nCan I add them on real quick?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Send mail request',
  },
  need_to_think_about_it: {
    text: 'Of course.\n\nThe only thing is, there’s really nothing to think about until you know whether the numbers are actually better.\n\nThe licensed agent can show you the comparison. If it doesn’t help, you don’t do anything.\n\nCan I add them on so you can at least hear it?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Need to think',
  },
  talk_to_family: {
    text: 'Absolutely, and you should talk it over before making a final decision.\n\nThis call is just to review the option and see if it actually saves you money or gives you better coverage.\n\nThe licensed agent can explain it first, and then you can decide if you want to involve your family.\n\nCan I add them on?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Spouse/Children consultation',
  },
  dont_trust_this: {
    text: 'I understand. You should be cautious.\n\nWe’re not asking you to give full banking information or your full Social Security number to me. This is just a review of the final expense policy you purchased from [Carrier] last December.\n\nThe licensed agent can explain who they are, what company they represent, and what the better option is.\n\nCan I add them on?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Trust objection',
  },
  know_this_is_real: {
    text: 'That’s a fair question.\n\nI’m calling about the policy you purchased from [Carrier] last December. I’m not asking you to cancel anything or give me sensitive information.\n\nThe licensed agent can verify the details and explain the comparison.\n\nCan I add them on the call?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Verification of call',
  },
  dont_give_personal_info: {
    text: 'I understand completely.\n\nI’m not asking for your full Social Security number, full bank account, or card information.\n\nThe licensed agent just needs to review the policy comparison and confirm basic details if you decide to move forward.\n\nCan I add them on?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Sensitive info fear',
  },
  cant_afford_more: {
    text: 'That’s exactly why we’re calling.\n\nThis is not about increasing your payment. The reason for the call is that we may be able to lower the monthly payment while keeping the same or more coverage.\n\nCan I add the licensed agent so they can go over the numbers?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Cannot afford',
  },
  dont_want_two_payments: {
    text: 'You should not have two payments long-term.\n\nThe licensed agent will explain how the process works and make sure your current policy stays active until anything new is approved and you choose to move forward.\n\nCan I add them on?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Double payments',
  },
  canceling_current_policy: {
    text: 'No. Nothing is canceled today.\n\nYour current policy should stay active unless a new plan is approved and you decide the new one makes sense.\n\nThis is just a comparison right now.\n\nCan I add the licensed agent so they can explain it?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Canceling policy',
  },
  will_i_lose_coverage: {
    text: 'No, you should not lose coverage.\n\nYour current plan should stay in place while the licensed agent reviews the new option with you. Nothing changes unless you choose to move forward and the new plan is approved.\n\nCan I add the agent now?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Lose coverage fear',
  },
  did_my_payment_go_up: {
    text: 'No, I’m not calling because your payment went up.\n\nI’m calling because we found a possible option to bring your payment down while keeping the same or more coverage.\n\nThe licensed agent can review the exact details.\n\nCan I add them on?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Premium increase query',
  },
  stopped_paying_policy: {
    text: 'Okay, that’s no problem.\n\nA lot of people stop because the payment got too high or the coverage didn’t feel worth it.\n\nThat may actually be another reason to review the newer option, because it could be a better fit.\n\nCan I add the licensed agent to see what may be available now?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Stopped paying',
  },
  never_bought_that: {
    text: 'Okay, no problem. It may have been something you looked into or started last December.\n\nEither way, the reason for the call is to see if there’s an affordable final expense option available.\n\nWould you want the licensed agent to check quickly, or should I mark that you’re not interested?',
    type: 'objection_handler',
    options: {
      'Yes, check quickly': 'transfer_bridge',
      'No, not interested': 'polite_exit',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Never bought',
  },
  who_are_you_again: {
    text: 'This is Chantal. I’m calling about the final expense policy you purchased from [Carrier] last December.\n\nWe found a plan that may give you the same or more coverage and lower the monthly payment.\n\nCan I add your licensed agent so they can go over the details?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Repeat identity',
  },
  what_company_are_you_with: {
    text: 'I’m calling on behalf of the final expense review team for the policy you purchased from [Carrier].\n\nYour licensed agent will go over the carrier, coverage, payment, and replacement details with you.\n\nCan I add them on now?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Company name check',
  },
  not_interested: {
    text: 'I understand.\n\nJust so I don’t waste your time — if your licensed agent could show you the same or more coverage at a lower monthly payment, would it be worth 5 minutes to hear it?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      No: 'polite_exit',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Not interested',
  },
  take_me_off_list: {
    text: 'No problem. I’ll mark that down. Have a good day.',
    type: 'exit',
    options: {
      'End Call': 'dnc_exit',
    },
    phase: 4,
    phaseName: 'Exit',
    timingLabel: 'Remove from list',
  },
  angry_customer: {
    text: 'I understand. I’m not trying to upset you.\n\nThe only reason for the call is that we found a possible way to improve the final expense plan you purchased last December.\n\nIf you don’t want to review it, I can mark that down.\n\nWould you like me to add the licensed agent, or should I close this out?',
    type: 'objection_handler',
    options: {
      'Yes, add agent': 'transfer_bridge',
      'No, close this out': 'polite_exit',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Angry customer reframe',
  },
  what_do_you_need_from_me: {
    text: 'Just your permission to add the licensed agent.\n\nThey’ll go over the plan details, explain the comparison, and answer any questions before anything changes.\n\nCan I add them now?',
    type: 'objection_handler',
    options: {
      Yes: 'transfer_bridge',
      'No / Other Objection': 'greeting_start',
    },
    phase: 3,
    phaseName: 'Objection Handling',
    timingLabel: 'Need permission',
  },
  polite_exit: {
    text: "No problem. I'll make a note. Have a good day.",
    type: 'exit',
    options: {
      'End Call': 'end_call',
    },
    phase: 4,
    phaseName: 'Exit Call',
    timingLabel: 'Polite Exit',
  },
  dnc_exit: {
    text: "No problem. I'll mark that down. Have a good day.",
    type: 'exit',
    options: {
      'End Call': 'end_call',
    },
    phase: 4,
    phaseName: 'DNC Exit',
    timingLabel: 'DNC request',
  },
  end_call: {
    text: 'Call completed. Please set the disposition in the wrap-up panel.',
    type: 'exit',
    options: {},
    phase: 4,
    phaseName: 'Finished',
    timingLabel: 'Wrap-up',
  },
};

export function BetterPlanCallbackScriptPanel({
  prospectData,
  leadId,
  onDataUpdate,
  setSelectedDisposition,
  setCallNotes,
  setShowDisposition,
}: BetterPlanCallbackScriptPanelProps) {
  const [activeStepId, setActiveStepId] = useState<NodeId>('greeting_start');
  const [history, setHistory] = useState<NodeId[]>([]);
  const [customCallbackTime, setCustomCallbackTime] = useState('');
  const [capturedData, setCapturedData] = useState<Record<string, string>>({});

  const activeNode = SCRIPT_NODES[activeStepId];

  // Try to resolve Carrier name from prospect data. It could be stored in a few places:
  const carrierName = useMemo(() => {
    if (!prospectData) return '[Carrier]';
    return (
      prospectData.carrier ||
      prospectData.insurance?.carrier ||
      prospectData.customFields?.carrier ||
      prospectData.customFields?.currentCarrier ||
      prospectData.existingCompanyName ||
      '[Carrier]'
    );
  }, [prospectData]);

  // Sync captured fields
  useEffect(() => {
    if (prospectData?.customFields) {
      const keys = ['callbackTime'];
      const initial: Record<string, string> = {};
      keys.forEach(k => {
        if (prospectData.customFields[k]) {
          initial[k] = String(prospectData.customFields[k]);
        }
      });
      setCapturedData(initial);
    }
  }, [prospectData]);

  const handleCaptureValue = useCallback(
    async (variable: string, val: string) => {
      setCapturedData(prev => ({ ...prev, [variable]: val }));
      if (onDataUpdate) {
        onDataUpdate({ [variable]: val });
      }
      if (leadId) {
        try {
          const currentCustomFields = {
            ...((prospectData?.customFields as Record<string, unknown>) || {}),
          };
          currentCustomFields[variable] = val;
          await apiClient.patch(`/api/v1/insurance-leads/${leadId}`, {
            customFields: currentCustomFields,
          });
        } catch (err) {
          console.error('[BetterPlanScript] Failed to auto-save variable:', err);
        }
      }
    },
    [leadId, onDataUpdate, prospectData]
  );

  const navigateTo = useCallback(
    (nextStepId: NodeId) => {
      setHistory(prev => [...prev, activeStepId]);
      setActiveStepId(nextStepId);
    },
    [activeStepId]
  );

  const handleGoBack = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setActiveStepId(previous);
  }, [history]);

  const handleRestart = useCallback(() => {
    setHistory([]);
    setActiveStepId('greeting_start');
  }, []);

  const handleObjectionJump = useCallback(
    (objectionStepId: NodeId) => {
      navigateTo(objectionStepId);
    },
    [navigateTo]
  );

  // Interpolated text replacing [Carrier] and callback times
  const interpolatedText = useMemo(() => {
    if (!activeNode) return '';
    return activeNode.text
      .replace(/\[Carrier\]/g, carrierName)
      .replace(/{carrier}/g, carrierName)
      .replace(/{callback_time}/g, capturedData.callbackTime || customCallbackTime || '[Time]');
  }, [activeNode, carrierName, capturedData.callbackTime, customCallbackTime]);

  const generateNotesSummary = useCallback((): string => {
    const lines: string[] = [];
    lines.push(`Carrier: ${carrierName}`);
    if (capturedData.callbackTime) lines.push(`Callback Time: ${capturedData.callbackTime}`);
    if (activeStepId === 'transfer_bridge') lines.push('Transferred to Licensed Agent');
    return `[FE Better Plan Outbound] ${lines.join(' | ')}`;
  }, [carrierName, capturedData.callbackTime, activeStepId]);

  const handleApplyDisposition = useCallback(
    (disp: string) => {
      const summaryNotes = generateNotesSummary();
      if (setSelectedDisposition) setSelectedDisposition(disp);
      if (setCallNotes) setCallNotes(summaryNotes);
      if (setShowDisposition) setShowDisposition(true);
    },
    [generateNotesSummary, setSelectedDisposition, setCallNotes, setShowDisposition]
  );

  const suggestedDisposition = useMemo((): { disp: string; label: string } | null => {
    if (activeNode.type !== 'exit' && activeStepId !== 'confirm_callback') return null;
    if (activeStepId === 'dnc_exit')
      return { disp: 'NOT_INTERESTED', label: 'Not Interested (DNC)' };
    if (activeStepId === 'polite_exit') return { disp: 'NOT_INTERESTED', label: 'Not Interested' };
    if (activeStepId === 'confirm_callback') return { disp: 'SET_CALLBACK', label: 'Set Callback' };
    if (activeStepId === 'transfer_bridge')
      return { disp: 'LIVE_TRANSFER', label: 'Live Transfer' };
    return { disp: 'FOLLOW_UP', label: 'Follow-Up' };
  }, [activeNode.type, activeStepId]);

  return (
    <div className="flex flex-col h-full bg-slate-900 border border-white/10 rounded-xl overflow-hidden shadow-2xl lg:flex-row">
      {/* Main script wizard section */}
      <div className="flex-1 flex flex-col p-5 overflow-y-auto border-r border-white/5 space-y-4">
        {/* Timing & Phase progress indicator */}
        <div className="bg-slate-950/40 rounded-lg p-3 border border-white/5 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-primary font-bold uppercase tracking-wider">
              {activeNode.phaseName}
            </span>
            <span className="text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-primary/70" />
              {activeNode.timingLabel}
            </span>
          </div>
          {/* Phase progress bar */}
          <div className="grid grid-cols-4 gap-1.5 h-1 bg-slate-800 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-colors ${activeNode.phase >= 1 ? 'bg-primary' : 'bg-transparent'}`}
            />
            <div
              className={`h-full rounded-full transition-colors ${activeNode.phase >= 2 ? 'bg-primary' : 'bg-transparent'}`}
            />
            <div
              className={`h-full rounded-full transition-colors ${activeNode.phase >= 3 ? 'bg-primary' : 'bg-transparent'}`}
            />
            <div
              className={`h-full rounded-full transition-colors ${activeNode.phase >= 4 ? 'bg-primary' : 'bg-transparent'}`}
            />
          </div>
        </div>

        {/* Script Content Card */}
        <div className="flex-1 flex flex-col justify-between bg-slate-950/20 border border-white/5 rounded-xl p-5 min-h-[220px]">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-primary/80 font-mono mb-2 font-semibold">
              Read to Prospect:
            </div>
            <p className="text-sm md:text-base font-medium text-slate-200 leading-relaxed font-sans whitespace-pre-line">
              {interpolatedText}
            </p>
          </div>

          {/* Dynamic input captures depending on node */}
          <div className="mt-4 pt-4 border-t border-white/5">
            {activeStepId === 'schedule_callback' && (
              <div className="flex flex-col gap-2 max-w-sm">
                <input
                  type="datetime-local"
                  value={customCallbackTime}
                  onChange={e => setCustomCallbackTime(e.target.value)}
                  className="bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs font-mono outline-none text-slate-100 focus:border-primary"
                />
                <button
                  disabled={!customCallbackTime}
                  onClick={() => {
                    void handleCaptureValue(
                      'callbackTime',
                      new Date(customCallbackTime).toLocaleString()
                    );
                    navigateTo(activeNode.options['Yes (Confirm Callback)']);
                  }}
                  className="bg-primary px-3 py-1.5 text-xs text-white font-mono rounded disabled:opacity-50"
                >
                  Save & Confirm Callback
                </button>
              </div>
            )}

            {/* Action options buttons */}
            {activeNode.options &&
              Object.keys(activeNode.options).length > 0 &&
              activeStepId !== 'schedule_callback' && (
                <div className="flex flex-wrap gap-2.5">
                  {Object.entries(activeNode.options).map(([label, targetId]) => {
                    const isPositive =
                      label.includes('Yes') ||
                      label.includes('Agree') ||
                      label.includes('Succeeded');
                    const isNegative =
                      label.includes('No') || label.includes('Decline') || label.includes('Failed');
                    return (
                      <button
                        key={label}
                        onClick={() => navigateTo(targetId)}
                        className={`px-4 py-2 text-xs font-mono uppercase tracking-widest rounded border transition-all ${
                          isPositive
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20'
                            : isNegative
                              ? 'bg-red-500/10 text-red-400 border-red-500/25 hover:bg-red-500/20'
                              : 'bg-slate-800 border-white/5 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        {label}
                        <ChevronRight className="w-3 h-3 inline ml-1" />
                      </button>
                    );
                  })}
                </div>
              )}

            {/* Suggested disposition button for exit nodes */}
            {suggestedDisposition && (
              <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
                  <div className="text-left">
                    <div className="text-xs font-mono uppercase text-emerald-400 tracking-wider">
                      Suggested Call Action
                    </div>
                    <div className="text-slate-300 text-xs">
                      Ready to log disposition:{' '}
                      <span className="font-semibold text-emerald-300">
                        {suggestedDisposition.label}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => handleApplyDisposition(suggestedDisposition.disp)}
                  className="bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-mono text-xs uppercase tracking-widest px-4 py-2 rounded shrink-0 transition-colors font-bold"
                >
                  Set Call Disposition
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Objection Jumps section */}
        <div className="bg-slate-950/20 rounded-xl p-4 border border-white/5 space-y-3">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold font-mono flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-primary/70" />
            Quick Objection Handling Jumps
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <button
              onClick={() => handleObjectionJump('what_is_this_about')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💬 What is this about?
            </button>
            <button
              onClick={() => handleObjectionJump('already_have_insurance')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🛡️ Already Have Insurance
            </button>
            <button
              onClick={() => handleObjectionJump('is_this_sales_call')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              📞 Is this a Sales Call?
            </button>
            <button
              onClick={() => handleObjectionJump('trying_to_sell_another_policy')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🛍️ Selling another policy?
            </button>
            <button
              onClick={() => handleObjectionJump('dont_want_to_change_anything')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              ❌ {"Don't want to change"}
            </button>
            <button
              onClick={() => handleObjectionJump('something_wrong_with_policy')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              ❓ Wrong with policy?
            </button>
            <button
              onClick={() => handleObjectionJump('why_didnt_i_get_plan_before')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🕒 Why not before?
            </button>
            <button
              onClick={() => handleObjectionJump('what_is_new_price')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💲 What is new price?
            </button>
            <button
              onClick={() => handleObjectionJump('how_much_will_i_save')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💰 How much will I save?
            </button>
            <button
              onClick={() => handleObjectionJump('im_busy')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              ⌛ {"I'm Busy"}
            </button>
            <button
              onClick={() => handleObjectionJump('make_it_quick')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              ⚡ Make it Quick
            </button>
            <button
              onClick={() => handleObjectionJump('send_me_something')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              ✉️ Send Me Something
            </button>
            <button
              onClick={() => handleObjectionJump('need_to_think_about_it')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💭 Need to Think
            </button>
            <button
              onClick={() => handleObjectionJump('talk_to_family')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              👥 Spouse / Family
            </button>
            <button
              onClick={() => handleObjectionJump('dont_trust_this')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🔒 {"Don't Trust This"}
            </button>
            <button
              onClick={() => handleObjectionJump('know_this_is_real')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🛡️ Is This Real?
            </button>
            <button
              onClick={() => handleObjectionJump('dont_give_personal_info')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              📇 No Info on Phone
            </button>
            <button
              onClick={() => handleObjectionJump('cant_afford_more')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💸 {"Can't Afford More"}
            </button>
            <button
              onClick={() => handleObjectionJump('dont_want_two_payments')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💳 Two Payments fear
            </button>
            <button
              onClick={() => handleObjectionJump('canceling_current_policy')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🛑 Canceling policy?
            </button>
            <button
              onClick={() => handleObjectionJump('will_i_lose_coverage')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              📉 Lose Coverage?
            </button>
            <button
              onClick={() => handleObjectionJump('did_my_payment_go_up')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              📈 Payment went up?
            </button>
            <button
              onClick={() => handleObjectionJump('stopped_paying_policy')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🚫 Stopped paying
            </button>
            <button
              onClick={() => handleObjectionJump('never_bought_that')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              ❌ Never Bought That
            </button>
            <button
              onClick={() => handleObjectionJump('who_are_you_again')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              👤 Who are you again?
            </button>
            <button
              onClick={() => handleObjectionJump('what_company_are_you_with')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🏢 What company?
            </button>
            <button
              onClick={() => handleObjectionJump('not_interested')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🚫 Not Interested
            </button>
            <button
              onClick={() => handleObjectionJump('angry_customer')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-amber-500 hover:bg-slate-800"
            >
              🔥 Angry Prospect
            </button>
            <button
              onClick={() => handleObjectionJump('what_do_you_need_from_me')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              📝 What do you need?
            </button>
            <button
              onClick={() => handleObjectionJump('take_me_off_list')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-red-400/80 hover:bg-slate-800 border-red-500/10"
            >
              ⚠️ Remove from list
            </button>
          </div>
        </div>

        {/* Compliance checklist card */}
        <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold font-mono flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            Compliance Guidelines & Warnings
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[11px] font-sans leading-relaxed text-amber-200/70">
            <div>
              <span className="font-bold text-red-400">DO NOT SAY</span>
              <ul className="list-disc pl-4 mt-1 space-y-1">
                <li>“You are approved.”</li>
                <li>“Your current policy is being canceled.”</li>
                <li>“This is guaranteed.”</li>
                <li>“I can change your policy.”</li>
                <li>“Give me your full Social Security number.”</li>
                <li>“Give me your full bank account number.”</li>
              </ul>
            </div>
            <div>
              <span className="font-bold text-emerald-400">ALWAYS SAY</span>
              <ul className="list-disc pl-4 mt-1 space-y-1">
                <li>“Nothing changes today unless you decide it makes sense.”</li>
                <li>“Your licensed agent will go over the details.”</li>
                <li>
                  “Your current policy should stay active unless a new plan is approved and you
                  choose to move forward.”
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Global Nav Controls */}
        <div className="flex items-center gap-2 border-t border-white/5 pt-3">
          <button
            onClick={handleGoBack}
            disabled={history.length === 0}
            className="flex items-center gap-1 px-3 py-1.5 border border-white/10 hover:bg-slate-800 disabled:opacity-50 text-slate-300 rounded text-xs font-mono uppercase"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Back
          </button>
          <button
            onClick={handleRestart}
            className="flex items-center gap-1 px-3 py-1.5 border border-white/10 hover:bg-slate-800 text-slate-300 rounded text-xs font-mono uppercase"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Restart
          </button>
        </div>
      </div>

      {/* Captured details sidebar */}
      <div className="w-full lg:w-72 bg-slate-950/40 p-5 flex flex-col space-y-4">
        <div>
          <h3 className="text-xs font-semibold font-mono uppercase tracking-widest text-slate-200 pb-2 border-b border-white/10 mb-3">
            Captured Lead Details
          </h3>
          <p className="text-[10px] text-muted-foreground leading-normal mb-4 font-sans">
            Carrier from Column R of lead list & live callback logs.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 font-mono text-[11px] max-h-[250px] lg:max-h-none">
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Current Carrier:</span>
            <span className="text-slate-200 font-semibold">{carrierName}</span>
          </div>
          {capturedData.callbackTime && (
            <div className="flex flex-col border-b border-white/5 pb-1 gap-0.5">
              <span className="text-muted-foreground uppercase">Callback Scheduled:</span>
              <span className="text-emerald-400 font-semibold">{capturedData.callbackTime}</span>
            </div>
          )}
        </div>

        {leadId && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded p-2.5 flex items-center gap-1.5 mt-auto">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[10px] text-emerald-300/80 font-mono">
              Real-time sync active (ID: {leadId.slice(0, 8)})
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default BetterPlanCallbackScriptPanel;
