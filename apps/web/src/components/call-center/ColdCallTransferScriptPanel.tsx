'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  ShieldAlert, 
  ChevronRight, 
  RotateCcw, 
  CheckCircle2, 
  PhoneForwarded, 
  HelpCircle, 
  ChevronLeft, 
  UserCheck, 
  AlertTriangle,
  Clock
} from 'lucide-react';
import { useUserRoles } from '@/hooks/useUserRoles';
import { apiClient } from '@/lib/api';

interface ColdCallTransferScriptPanelProps {
  prospectData?: any;
  leadId?: string | null;
  onDataUpdate?: (data: Record<string, unknown>) => void;
  setSelectedDisposition?: (disp: string) => void;
  setCallNotes?: (notes: string) => void;
  setShowDisposition?: (show: boolean) => void;
}

type NodeId =
  | 'greeting_start'
  | 'age_permission_question'
  | 'age_explanation'
  | 'who_is_this_handler'
  | 'coverage_check'
  | 'existing_coverage_type'
  | 'review_existing_policy_bridge'
  | 'term_work_bridge'
  | 'not_sure_coverage_handler'
  | 'family_responsibility_question'
  | 'financial_burden_question'
  | 'protect_savings_question'
  | 'validate_need'
  | 'soft_review_bridge'
  | 'nobody_handler'
  | 'transition_to_quick_qualifying'
  | 'state_check'
  | 'correct_state'
  | 'tobacco_check'
  | 'tobacco_type'
  | 'major_health_check'
  | 'major_health_details'
  | 'checking_savings_check'
  | 'no_bank_handler'
  | 'basic_info_reassurance'
  | 'bank_question_reassurance'
  | 'transfer_bridge'
  | 'live_transfer_hold'
  | 'warm_transfer_intro'
  | 'schedule_callback'
  | 'confirm_callback'
  // Objections
  | 'not_interested_micro_commitment'
  | 'micro_question'
  | 'not_interested_second_attempt'
  | 'not_today_handler'
  | 'price_before_transfer_handler'
  | 'price_bridge'
  | 'think_about_it_handler'
  | 'think_bridge'
  | 'mail_me_something'
  | 'mail_bridge'
  | 'spouse_or_family'
  | 'responsibility_reframe'
  | 'trust_objection'
  | 'trust_reassurance'
  // Exits
  | 'wrong_number_exit'
  | 'dnc_exit'
  | 'under_age_exit'
  | 'over_age_exit'
  | 'state_not_available_exit'
  | 'polite_exit'
  | 'soft_exit'
  | 'end_call_after_transfer'
  | 'end_call';

interface ScriptNode {
  text: string;
  type?: 'opening_statement' | 'qualification_question' | 'discovery_question' | 'clarifying_question' | 'bridge' | 'education_bridge' | 'reassurance' | 'beneficiary_discovery' | 'pain_question' | 'validation_statement' | 'soft_bridge' | 'discovery_handler' | 'transition' | 'data_collection' | 'qualification_handler' | 'trust_handler' | 'transfer_request' | 'transfer_instruction' | 'agent_to_agent_intro' | 'callback_setter' | 'callback_confirmation' | 'objection_handler' | 'exit';
  capture_variable?: string;
  options: Record<string, NodeId>;
  phase: 1 | 2 | 3 | 4 | 5; // 5 = objections/exits
  phaseName: string;
  timingLabel: string;
}

const SCRIPT_NODES: Record<NodeId, ScriptNode> = {
  greeting_start: {
    text: "Hi, this is {agent_name} calling about final expense life insurance options in {state}. The reason for the call is simple — these plans are designed to help cover funeral, burial, or cremation costs so the family is not left trying to handle everything out of pocket.",
    type: "opening_statement",
    options: {
      "Continues Listening": "age_permission_question",
      "Who is this?": "who_is_this_handler",
      "Not Interested": "not_interested_micro_commitment",
      "Wrong Number": "wrong_number_exit",
      "Do Not Call (DNC)": "dnc_exit"
    },
    phase: 1,
    phaseName: "The Permission-Based Trust Opener",
    timingLabel: "Phase 1: 0:00 - 0:30"
  },
  age_permission_question: {
    text: "Let me ask you one quick question first — are you between 50 and 80 years old?",
    type: "qualification_question",
    capture_variable: "ageRange",
    options: {
      "Yes (50 - 80)": "coverage_check",
      "No (Under 50)": "under_age_exit",
      "No (Over 80)": "over_age_exit",
      "Asks why / Explanation": "age_explanation"
    },
    phase: 1,
    phaseName: "The Permission-Based Trust Opener",
    timingLabel: "Phase 1: 0:00 - 0:30"
  },
  age_explanation: {
    text: "Most of these final expense plans are designed around age, state, and basic health. I’m just checking if it makes sense to have a licensed agent review options with you.",
    type: "explanation" as any,
    options: {
      "Yes, makes sense": "coverage_check",
      "No, not interested": "polite_exit"
    },
    phase: 1,
    phaseName: "The Permission-Based Trust Opener",
    timingLabel: "Phase 1: 0:00 - 0:30"
  },
  who_is_this_handler: {
    text: "This is {agent_name}. I’m calling about final expense coverage options that help families with funeral and burial costs. I’m only going to ask a couple of quick questions to see if it even makes sense to connect you with a licensed agent.",
    type: "objection_handler",
    options: {
      "Continue": "age_permission_question",
      "Not Interested": "not_interested_micro_commitment"
    },
    phase: 1,
    phaseName: "The Permission-Based Trust Opener",
    timingLabel: "Phase 1: 0:00 - 0:30"
  },
  coverage_check: {
    text: "Do you currently have anything specifically set aside for funeral or burial expenses?",
    type: "discovery_question",
    capture_variable: "hasFinalExpenseCoverage",
    options: {
      "No / None": "family_responsibility_question",
      "Yes": "existing_coverage_type",
      "Not Sure": "not_sure_coverage_handler"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  existing_coverage_type: {
    text: "That’s good. Is it a permanent whole life policy, or is it something through work, term insurance, or something you’re not completely sure about?",
    type: "clarifying_question",
    capture_variable: "coverageType",
    options: {
      "Whole Life": "review_existing_policy_bridge",
      "Term or Work Insurance": "term_work_bridge",
      "Not Sure": "not_sure_coverage_handler"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  review_existing_policy_bridge: {
    text: "Okay, good. A licensed agent can still review whether the amount is enough and whether the price still makes sense. I’ll ask the same quick questions either way.",
    type: "bridge",
    options: {
      "Continue": "family_responsibility_question"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  term_work_bridge: {
    text: "Got it. The reason I asked is because term or work coverage can sometimes end. Final expense is usually designed to stay in place as long as the premiums are paid. I’ll ask a couple of quick questions so the licensed agent can look at it correctly.",
    type: "education_bridge",
    options: {
      "Continue": "family_responsibility_question"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  not_sure_coverage_handler: {
    text: "That’s completely fine. A lot of people are not sure what type they have. That is exactly why it helps to have a licensed agent look at the options and explain the difference clearly.",
    type: "reassurance",
    options: {
      "Continue": "family_responsibility_question"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  family_responsibility_question: {
    text: "If something happened unexpectedly, who would most likely be responsible for handling your arrangements — a spouse, child, sibling, or someone else?",
    type: "beneficiary_discovery",
    capture_variable: "responsiblePerson",
    options: {
      "Spouse": "financial_burden_question",
      "Child": "financial_burden_question",
      "Sibling": "financial_burden_question",
      "Someone Else": "financial_burden_question",
      "Nobody": "nobody_handler"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  financial_burden_question: {
    text: "Would paying for everything all at once be a burden on {responsible_person}, or would they already have money set aside for it?",
    type: "pain_question",
    capture_variable: "financialBurden",
    options: {
      "Burden to them": "validate_need",
      "Money is set aside": "protect_savings_question",
      "Not Sure": "validate_need"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  protect_savings_question: {
    text: "That’s good if they have savings. Would you rather them use their own money for that, or would you prefer to have something separate in place specifically for final expenses?",
    type: "clarifying_question",
    options: {
      "Prefer separate coverage": "validate_need",
      "Use their own savings": "soft_review_bridge",
      "Not Sure": "soft_review_bridge"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  validate_need: {
    text: "I understand. That is the main reason people look at this — they want something simple in place so the family is not stuck trying to figure it out during a difficult time.",
    type: "validation_statement",
    options: {
      "Continue": "transition_to_quick_qualifying"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  soft_review_bridge: {
    text: "That makes sense. Either way, it may still be worth having a licensed agent show you what is available so you can decide if it makes sense.",
    type: "soft_bridge",
    options: {
      "Continue": "transition_to_quick_qualifying"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  nobody_handler: {
    text: "I understand. Even then, some people still want something in place so their final wishes are handled properly and there is money available for the arrangements.",
    type: "discovery_handler",
    options: {
      "Continue": "transition_to_quick_qualifying"
    },
    phase: 2,
    phaseName: "The Short Family-Burden Discovery",
    timingLabel: "Phase 2: 0:30 - 1:30"
  },
  transition_to_quick_qualifying: {
    text: "Fair enough. I’m going to ask just a few quick questions, then I can connect you with a licensed agent who can check the actual options in your state.",
    type: "transition",
    options: {
      "Continue": "state_check"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  state_check: {
    text: "Are you currently living in {state}?",
    type: "qualification_question",
    capture_variable: "state",
    options: {
      "Yes": "tobacco_check",
      "No": "correct_state",
      "Refuses basic info": "basic_info_reassurance"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  correct_state: {
    text: "No problem. What state are you in?",
    type: "data_collection",
    capture_variable: "correctState",
    options: {
      "Save State": "tobacco_check",
      "State is Not Covered": "state_not_available_exit"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  tobacco_check: {
    text: "Have you used any tobacco or nicotine in the last 12 months — cigarettes, cigars, chew, or vape?",
    type: "qualification_question",
    capture_variable: "tobaccoStatus",
    options: {
      "No": "major_health_check",
      "Yes": "tobacco_type",
      "Refuses basic info": "basic_info_reassurance"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  tobacco_type: {
    text: "Okay, was that cigarettes or something else?",
    type: "data_collection",
    capture_variable: "tobaccoType",
    options: {
      "Cigarettes": "major_health_check",
      "Something Else (Chew, Vape, Pipe)": "major_health_check"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  major_health_check: {
    text: "In the last 2 years, have you had a heart attack, stroke, cancer, or been hospitalized overnight?",
    type: "qualification_question",
    capture_variable: "majorHealthHistory",
    options: {
      "No": "checking_savings_check",
      "Yes": "major_health_details",
      "Refuses basic info": "basic_info_reassurance"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  major_health_details: {
    text: "Okay, which one was it, and about how long ago did that happen?",
    type: "data_collection",
    capture_variable: "majorHealthDetails",
    options: {
      "Save details": "checking_savings_check"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  checking_savings_check: {
    text: "And if you decided to apply later with the licensed agent, do you have a checking or savings account for monthly payments?",
    type: "qualification_question",
    capture_variable: "hasBankAccount",
    options: {
      "Yes": "transfer_bridge",
      "No": "no_bank_handler",
      "Refuses bank question": "bank_question_reassurance"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  no_bank_handler: {
    text: "Okay, that may limit some options, but I’ll still let the licensed agent explain what may or may not be available.",
    type: "qualification_handler",
    options: {
      "Continue": "transfer_bridge"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  basic_info_reassurance: {
    text: "I understand. I’m not asking for anything sensitive — no Social Security number, no banking information, and no private application details. These are just the basic questions the licensed agent needs before checking options.",
    type: "trust_handler",
    options: {
      "Resume Question": "greeting_start", // special handler mapping back
      "Still Refuses / Exit": "polite_exit"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  bank_question_reassurance: {
    text: "I’m not asking for bank information. I’m only asking whether you have checking or savings because most carriers use monthly payments if someone decides to apply.",
    type: "trust_handler",
    options: {
      "Answers Yes": "transfer_bridge",
      "Answers No": "no_bank_handler",
      "Still Refuses": "transfer_bridge"
    },
    phase: 3,
    phaseName: "The Eligibility Pivot",
    timingLabel: "Phase 3: 1:30 - 2:45"
  },
  transfer_bridge: {
    text: "Okay, based on what you told me, it makes sense to have a licensed agent check the options for you. They can explain the coverage, pricing, and what you may be eligible for. Do you have 3 to 5 minutes right now so I can connect you?",
    type: "transfer_request",
    options: {
      "Yes, Transfer Now": "live_transfer_hold",
      "Not Now / Call Me Back": "schedule_callback",
      "Wants Price First": "price_before_transfer_handler",
      "Needs to Think About It": "think_about_it_handler",
      "Not Interested": "not_interested_second_attempt"
    },
    phase: 4,
    phaseName: "The Licensed Agent Transfer",
    timingLabel: "Phase 4: 2:45 - 3:30"
  },
  live_transfer_hold: {
    text: "Perfect. Stay on the line for me. I’m bringing the licensed agent on now.",
    type: "transfer_instruction",
    options: {
      "Agent Connected / Introduce": "warm_transfer_intro"
    },
    phase: 4,
    phaseName: "The Licensed Agent Transfer",
    timingLabel: "Phase 4: 2:45 - 3:30"
  },
  warm_transfer_intro: {
    text: "Hi {licensed_agent_name}, I have someone on the line in {state} interested in final expense coverage. They are between {age_range}, tobacco status is {tobacco_status}, major health history is {major_health_history}, and the main concern is making sure final expenses do not become a burden on the family. I’ll let you take it from here.",
    type: "agent_to_agent_intro",
    options: {
      "Transfer Successful / End Call": "end_call_after_transfer"
    },
    phase: 4,
    phaseName: "The Licensed Agent Transfer",
    timingLabel: "Phase 4: 2:45 - 3:30"
  },
  schedule_callback: {
    text: "No problem. Would later today or tomorrow be better for the licensed agent to call you back?",
    type: "callback_setter",
    capture_variable: "callbackTime",
    options: {
      "Save Callback Time": "confirm_callback",
      "Refuses time": "soft_exit"
    },
    phase: 4,
    phaseName: "The Licensed Agent Transfer",
    timingLabel: "Phase 4: 2:45 - 3:30"
  },
  confirm_callback: {
    text: "Perfect. I’ll have a licensed agent follow up with you at {callback_time}. Please keep an eye out for the call.",
    type: "callback_confirmation",
    options: {
      "End Call": "end_call"
    },
    phase: 4,
    phaseName: "The Licensed Agent Transfer",
    timingLabel: "Phase 4: 2:45 - 3:30"
  },

  // Objection Handlers
  not_interested_micro_commitment: {
    text: "I understand. Most people are not looking for this when we call. Let me ask one quick question and I’ll let you go.",
    type: "objection_handler",
    options: {
      "Acknowledge & Ask Check": "micro_question"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Micro Commitment"
  },
  micro_question: {
    text: "Do you already have something specifically set aside for funeral or burial expenses?",
    type: "objection_handler",
    options: {
      "Yes": "existing_coverage_type",
      "No": "family_responsibility_question",
      "Still Not Interested / Exit": "polite_exit"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Micro Commitment"
  },
  not_interested_second_attempt: {
    text: "I understand. Is it because you already have coverage, or because you just don’t want to look at anything today?",
    type: "objection_handler",
    options: {
      "Already Covered": "existing_coverage_type",
      "Just Not Today": "not_today_handler",
      "Angry Objection / Exit": "polite_exit"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Objection Reframe"
  },
  not_today_handler: {
    text: "That’s fair. The only reason I asked is because the licensed agent can usually tell you in just a few minutes what is available and whether it fits your budget. There is nothing to decide with me.",
    type: "objection_handler",
    options: {
      "Agree to Transfer": "live_transfer_hold",
      "Decline / Exit": "soft_exit"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Objection Reframe"
  },
  price_before_transfer_handler: {
    text: "That’s the right question. The price depends on age, state, tobacco use, health, and the amount of coverage. I don’t want to guess and give you the wrong number.",
    type: "objection_handler",
    options: {
      "Explain and Bridge": "price_bridge"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Price Objection"
  },
  price_bridge: {
    text: "The licensed agent can check the actual options and show you what fits your budget. It only takes a few minutes. Let me connect you now.",
    type: "objection_handler",
    options: {
      "Agree to Transfer": "live_transfer_hold",
      "Decline / Callback": "schedule_callback"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Price Objection"
  },
  think_about_it_handler: {
    text: "That’s completely fair. There is nothing to decide with me. The licensed agent’s job is just to explain what is available and what it would cost.",
    type: "objection_handler",
    options: {
      "Explain & Bridge": "think_bridge"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Think About It Objection"
  },
  think_bridge: {
    text: "Once you hear the options, you can decide if it makes sense. Do you have 3 to 5 minutes right now?",
    type: "objection_handler",
    options: {
      "Yes, Transfer": "live_transfer_hold",
      "No, Callback": "schedule_callback"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Think About It Objection"
  },
  mail_me_something: {
    text: "The licensed agent would need to know your age, state, health, and the amount of coverage you want before anything accurate can be sent. Otherwise it would just be generic information.",
    type: "objection_handler",
    options: {
      "Explain details needed": "mail_bridge"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Mail Request"
  },
  mail_bridge: {
    text: "Let me connect you so they can check what actually applies to you.",
    type: "objection_handler",
    options: {
      "Agree to Transfer": "live_transfer_hold",
      "Decline / Callback": "schedule_callback"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Mail Request"
  },
  spouse_or_family: {
    text: "That makes sense. A lot of people like to talk it over with family.",
    type: "objection_handler",
    options: {
      "Acknowledge and Reframe": "responsibility_reframe"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Family Decision"
  },
  responsibility_reframe: {
    text: "The only thing I would say is this: the licensed agent can at least show you the options first, then you’ll know exactly what you’re talking over with them.",
    type: "objection_handler",
    options: {
      "Agree to Transfer": "live_transfer_hold",
      "Decline / Callback": "schedule_callback"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Family Decision"
  },
  trust_objection: {
    text: "I understand. You should be careful with calls like this.",
    type: "objection_handler",
    options: {
      "Acknowledge & Reassure": "trust_reassurance"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Trust Objection"
  },
  trust_reassurance: {
    text: "That’s why I’m not asking for anything sensitive. No Social Security number, no banking information, and no application information. I’m only asking basic qualifying questions before connecting you with a licensed agent.",
    type: "objection_handler",
    options: {
      "Agree / Continue": "transition_to_quick_qualifying",
      "Decline / Exit": "polite_exit"
    },
    phase: 5,
    phaseName: "Objection Handling",
    timingLabel: "Trust Objection"
  },

  // Exits
  wrong_number_exit: {
    text: "No problem. I’ll mark this as the wrong number. Have a good day.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  },
  dnc_exit: {
    text: "No problem. I’ll place you on our do-not-call list. Have a good day.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  },
  under_age_exit: {
    text: "No problem. These options are usually designed for people 50 and older. I appreciate your time.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  },
  over_age_exit: {
    text: "No problem. Some options may be limited based on age. I appreciate your time.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  },
  state_not_available_exit: {
    text: "I’m sorry, we are not able to help in that state right now. I appreciate your time.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  },
  polite_exit: {
    text: "I understand. I appreciate your time. Have a good day.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  },
  soft_exit: {
    text: "No problem. I appreciate your time. Have a good day.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  },
  end_call_after_transfer: {
    text: "Transfer completed successfully. You may now disconnect from the call.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  },
  end_call: {
    text: "Call completed. You may now disconnect.",
    type: "exit",
    options: {},
    phase: 5,
    phaseName: "Exit",
    timingLabel: "Exit"
  }
};

export function ColdCallTransferScriptPanel({
  prospectData,
  leadId,
  onDataUpdate,
  setSelectedDisposition,
  setCallNotes,
  setShowDisposition,
}: ColdCallTransferScriptPanelProps) {
  const { user } = useUserRoles();
  const [activeStepId, setActiveStepId] = useState<NodeId>('greeting_start');
  const [history, setHistory] = useState<NodeId[]>([]);
  const [licensedAgentName, setLicensedAgentName] = useState('Yazzyl');
  
  // Custom inputs inside some nodes
  const [customState, setCustomState] = useState('');
  const [customHealthDetails, setCustomHealthDetails] = useState('');
  const [customCallbackTime, setCustomCallbackTime] = useState('');

  // Local copy of captured variables to show in the side panel
  const [capturedData, setCapturedData] = useState<Record<string, string>>({});

  const agentName = user?.firstName || 'the agent';
  const currentState = prospectData?.state || prospectData?.stateCode || customState || 'your state';

  const activeNode = SCRIPT_NODES[activeStepId];

  // Initialize captured variables if they already exist on lead customFields
  useEffect(() => {
    if (prospectData?.customFields) {
      const keys = [
        'ageRange', 'hasFinalExpenseCoverage', 'coverageType', 'responsiblePerson',
        'financialBurden', 'correctState', 'tobaccoStatus', 'tobaccoType',
        'majorHealthHistory', 'majorHealthDetails', 'hasBankAccount', 'callbackTime'
      ];
      const initial: Record<string, string> = {};
      keys.forEach(k => {
        if (prospectData.customFields[k]) {
          initial[k] = String(prospectData.customFields[k]);
        }
      });
      setCapturedData(initial);
    }
  }, [prospectData]);

  // Persistent auto-save helper
  const handleCaptureValue = useCallback(async (variable: string, val: string) => {
    // 1. Update local UI state
    setCapturedData(prev => ({ ...prev, [variable]: val }));

    // 2. Propagate up to activeCallData
    if (onDataUpdate) {
      onDataUpdate({ [variable]: val });
    }

    // 3. Auto-save directly in CRM Lead record if we have an ID
    if (leadId) {
      try {
        const currentCustomFields = { ...((prospectData?.customFields as Record<string, unknown>) || {}) };
        currentCustomFields[variable] = val;

        await apiClient.patch(`/api/v1/insurance-leads/${leadId}`, {
          customFields: currentCustomFields,
          // Sync key first-class fields
          ...(variable === 'state' || variable === 'correctState' ? { state: val } : {}),
          ...(variable === 'tobaccoStatus' ? { smoker: val === 'Yes' ? 'YES' : 'NO' } : {}),
        });
      } catch (err) {
        console.error('[ColdCallScript] Failed to auto-save variable:', err);
      }
    }
  }, [leadId, onDataUpdate, prospectData]);

  // Navigate to target step and push history
  const navigateTo = useCallback((nextStepId: NodeId) => {
    setHistory(prev => [...prev, activeStepId]);
    
    // special handling for basic_info_reassurance's resume behavior
    if (nextStepId as string === 'resume_last_question') {
      const prev = history[history.length - 1] || 'greeting_start';
      setActiveStepId(prev);
      return;
    }

    setActiveStepId(nextStepId);
  }, [activeStepId, history]);

  // Go back to previous step
  const handleGoBack = useCallback(() => {
    if (history.length === 0) return;
    const previous = history[history.length - 1];
    setHistory(prev => prev.slice(0, -1));
    setActiveStepId(previous);
  }, [history]);

  // Reset script to start
  const handleRestart = useCallback(() => {
    setHistory([]);
    setActiveStepId('greeting_start');
  }, []);

  // Quick jump to objection handling
  const handleObjectionJump = useCallback((objectionStepId: NodeId) => {
    navigateTo(objectionStepId);
  }, [navigateTo]);

  // Interpolate script text templates with actual live variables
  const interpolatedText = useMemo(() => {
    if (!activeNode) return '';
    return activeNode.text
      .replace(/{agent_name}/g, agentName)
      .replace(/{state}/g, currentState)
      .replace(/{responsible_person}/g, capturedData.responsiblePerson || 'family member')
      .replace(/{age_range}/g, capturedData.ageRange || 'between 50 and 80')
      .replace(/{tobacco_status}/g, capturedData.tobaccoStatus || 'non-tobacco')
      .replace(/{major_health_history}/g, capturedData.majorHealthHistory || 'no major history')
      .replace(/{callback_time}/g, capturedData.callbackTime || customCallbackTime || 'scheduled time')
      .replace(/{licensed_agent_name}/g, licensedAgentName);
  }, [activeNode, agentName, currentState, capturedData, customCallbackTime, licensedAgentName]);

  // Auto-generate call notes summary based on all captured data
  const generateNotesSummary = useCallback((): string => {
    const lines: string[] = [];
    if (capturedData.ageRange) lines.push(`Age: ${capturedData.ageRange}`);
    if (capturedData.hasFinalExpenseCoverage) lines.push(`Has Coverage: ${capturedData.hasFinalExpenseCoverage}`);
    if (capturedData.coverageType) lines.push(`Coverage Type: ${capturedData.coverageType}`);
    if (capturedData.responsiblePerson) lines.push(`Arranger: ${capturedData.responsiblePerson}`);
    if (capturedData.financialBurden) lines.push(`Family Burden: ${capturedData.financialBurden}`);
    if (capturedData.correctState || prospectData?.state) lines.push(`State: ${capturedData.correctState || prospectData?.state}`);
    if (capturedData.tobaccoStatus) lines.push(`Tobacco Nicotine: ${capturedData.tobaccoStatus} (${capturedData.tobaccoType || 'N/A'})`);
    if (capturedData.majorHealthHistory) lines.push(`2-Yr Major Health: ${capturedData.majorHealthHistory} (${capturedData.majorHealthDetails || 'None'})`);
    if (capturedData.hasBankAccount) lines.push(`Has Bank: ${capturedData.hasBankAccount}`);
    if (capturedData.callbackTime) lines.push(`Callback Time: ${capturedData.callbackTime}`);
    if (licensedAgentName && activeStepId === 'warm_transfer_intro') lines.push(`Transferred to Agent: ${licensedAgentName}`);

    return `[FE Outbound script] ${lines.join(' | ')}`;
  }, [capturedData, licensedAgentName, activeStepId, prospectData]);

  // Set the suggested disposition in the wrap-up panel
  const handleApplyDisposition = useCallback((disp: string) => {
    const summaryNotes = generateNotesSummary();
    if (setSelectedDisposition) setSelectedDisposition(disp);
    if (setCallNotes) setCallNotes(summaryNotes);
    if (setShowDisposition) setShowDisposition(true);
  }, [generateNotesSummary, setSelectedDisposition, setCallNotes, setShowDisposition]);

  // Determine suggested disposition for the current node if it's an exit node
  const suggestedDisposition = useMemo((): { disp: string; label: string } | null => {
    if (activeNode.type !== 'exit' && activeStepId !== 'confirm_callback') return null;

    if (activeStepId === 'wrong_number_exit') return { disp: 'WRONG_NUMBER', label: 'Wrong Number' };
    if (activeStepId === 'dnc_exit') return { disp: 'NOT_INTERESTED', label: 'Not Interested (DNC)' };
    if (activeStepId === 'under_age_exit' || activeStepId === 'over_age_exit' || activeStepId === 'state_not_available_exit') {
      return { disp: 'NOT_QUALIFIED', label: 'Not Qualified' };
    }
    if (activeStepId === 'confirm_callback') return { disp: 'SET_CALLBACK', label: 'Set Callback' };
    if (activeStepId === 'end_call_after_transfer') return { disp: 'LIVE_TRANSFER', label: 'Live Transfer' };

    return { disp: 'FOLLOW_UP', label: 'Follow-Up' };
  }, [activeNode, activeStepId]);

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
          {/* Phase bar */}
          <div className="grid grid-cols-4 gap-1.5 h-1 bg-slate-800 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-colors ${activeNode.phase >= 1 ? 'bg-primary' : 'bg-transparent'}`} />
            <div className={`h-full rounded-full transition-colors ${activeNode.phase >= 2 ? 'bg-primary' : 'bg-transparent'}`} />
            <div className={`h-full rounded-full transition-colors ${activeNode.phase >= 3 ? 'bg-primary' : 'bg-transparent'}`} />
            <div className={`h-full rounded-full transition-colors ${activeNode.phase >= 4 ? 'bg-primary' : 'bg-transparent'}`} />
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
            {activeStepId === 'correct_state' && (
              <div className="flex items-center gap-2 max-w-sm">
                <input 
                  type="text" 
                  value={customState}
                  onChange={e => setCustomState(e.target.value.toUpperCase().slice(0, 2))}
                  placeholder="Enter 2-letter state (e.g. FL)..."
                  className="bg-slate-900 border border-white/10 rounded px-2.5 py-1.5 text-xs font-mono outline-none text-slate-100 flex-1 focus:border-primary"
                />
                <button
                  disabled={customState.length !== 2}
                  onClick={() => {
                    void handleCaptureValue('correctState', customState);
                    navigateTo(activeNode.options['Save State']);
                  }}
                  className="bg-primary px-3 py-1.5 text-xs text-white font-mono rounded disabled:opacity-50"
                >
                  Save & Continue
                </button>
              </div>
            )}

            {activeStepId === 'major_health_details' && (
              <div className="flex flex-col gap-2 max-w-md">
                <textarea 
                  value={customHealthDetails}
                  onChange={e => setCustomHealthDetails(e.target.value)}
                  placeholder="Type health event details & timeframe (e.g., stroke 1.5 years ago)..."
                  rows={2}
                  className="bg-slate-900 border border-white/10 rounded p-2 text-xs font-mono outline-none text-slate-100 focus:border-primary resize-none"
                />
                <button
                  disabled={!customHealthDetails.trim()}
                  onClick={() => {
                    void handleCaptureValue('majorHealthDetails', customHealthDetails);
                    navigateTo(activeNode.options['Save details']);
                  }}
                  className="bg-primary self-end px-3 py-1.5 text-xs text-white font-mono rounded disabled:opacity-50"
                >
                  Save & Continue
                </button>
              </div>
            )}

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
                    void handleCaptureValue('callbackTime', new Date(customCallbackTime).toLocaleString());
                    navigateTo(activeNode.options['Save Callback Time']);
                  }}
                  className="bg-primary px-3 py-1.5 text-xs text-white font-mono rounded disabled:opacity-50"
                >
                  Save & Continue
                </button>
              </div>
            )}

            {activeStepId === 'warm_transfer_intro' && (
              <div className="flex items-center gap-2 max-w-sm mb-3">
                <label className="text-[10px] font-mono text-muted-foreground uppercase">Agent Name:</label>
                <input 
                  type="text" 
                  value={licensedAgentName}
                  onChange={e => setLicensedAgentName(e.target.value)}
                  placeholder="Licensed Agent Name..."
                  className="bg-slate-900 border border-white/10 rounded px-2.5 py-1 text-xs font-mono outline-none text-slate-100 focus:border-primary"
                />
              </div>
            )}

            {/* Action options buttons */}
            {activeNode.options && Object.keys(activeNode.options).length > 0 && !['correct_state', 'major_health_details', 'schedule_callback'].includes(activeStepId) && (
              <div className="flex flex-wrap gap-2.5">
                {Object.entries(activeNode.options).map(([label, targetId]) => {
                  const isPositive = label.includes('Yes') || label.includes('Continues') || label.includes('Agree');
                  const isNegative = label.includes('No') || label.includes('Decline') || label.includes('Refuses');
                  return (
                    <button
                      key={label}
                      onClick={() => {
                        // Capture variable value if needed
                        if (activeNode.capture_variable) {
                          const varName = activeNode.capture_variable;
                          let valueToSave = label;
                          if (varName === 'responsiblePerson') {
                            if (label === 'Spouse') valueToSave = 'your spouse';
                            else if (label === 'Child') valueToSave = 'your child';
                            else if (label === 'Sibling') valueToSave = 'your sibling';
                            else if (label === 'Someone Else') valueToSave = 'your family member';
                          } else if (varName === 'state') {
                            valueToSave = currentState;
                          }
                          void handleCaptureValue(varName, valueToSave);
                        }
                        navigateTo(targetId);
                      }}
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
                    <div className="text-xs font-mono uppercase text-emerald-400 tracking-wider">Suggested Call Action</div>
                    <div className="text-slate-300 text-xs">Ready to log disposition: <span className="font-semibold text-emerald-300">{suggestedDisposition.label}</span></div>
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
              onClick={() => handleObjectionJump('who_is_this_handler')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💬 Who is this?
            </button>
            <button 
              onClick={() => handleObjectionJump('not_interested_micro_commitment')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🚫 Not Interested
            </button>
            <button 
              onClick={() => handleObjectionJump('price_before_transfer_handler')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💲 Wants Price First
            </button>
            <button 
              onClick={() => handleObjectionJump('mail_me_something')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              ✉️ Mail Me Something
            </button>
            <button 
              onClick={() => handleObjectionJump('spouse_or_family')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              👥 Talk with Spouse
            </button>
            <button 
              onClick={() => handleObjectionJump('trust_objection')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              🔒 Trust / Security
            </button>
            <button 
              onClick={() => handleObjectionJump('think_about_it_handler')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-slate-400 hover:bg-slate-800"
            >
              💭 Needs to Think
            </button>
            <button 
              onClick={() => handleObjectionJump('wrong_number_exit')}
              className="px-2.5 py-1.5 bg-slate-900 border border-white/5 rounded text-left text-[10px] font-mono uppercase text-red-400/80 hover:bg-slate-800 border-red-500/10"
            >
              ⚠️ Wrong Number
            </button>
          </div>
        </div>

        {/* Compliance checklist card */}
        <div className="bg-amber-500/5 border border-amber-500/10 rounded-xl p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-amber-400 font-semibold font-mono flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
            Compliance Guidelines & Warnings
          </div>
          <ul className="text-[11px] text-amber-200/70 space-y-1 font-sans leading-relaxed list-disc pl-4">
            <li><strong>Do not</strong> say "God forbid".</li>
            <li><strong>Do not</strong> tell the prospect we do not have their name.</li>
            <li><strong>Do not</strong> collect sensitive SSN, banking, routing, or account numbers.</li>
            <li><strong>Do not</strong> say approved, qualified, guaranteed, government, free, or state-approved.</li>
            <li>You are screening and transferring to a licensed agent, <strong>NOT</strong> selling the policy.</li>
          </ul>
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
            These variables are updated in real-time and synced to the CRM profile.
          </p>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2.5 font-mono text-[11px] max-h-[400px] lg:max-h-none">
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Age Range:</span>
            <span className="text-slate-200">{capturedData.ageRange || '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Has Coverage:</span>
            <span className="text-slate-200">{capturedData.hasFinalExpenseCoverage || '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Coverage Type:</span>
            <span className="text-slate-200">{capturedData.coverageType || '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Arranger:</span>
            <span className="text-slate-200">{capturedData.responsiblePerson || '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Burden Pain:</span>
            <span className="text-slate-200">{capturedData.financialBurden || '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">State:</span>
            <span className="text-slate-200">{capturedData.correctState || prospectData?.state || '—'}</span>
          </div>
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Tobacco Status:</span>
            <span className="text-slate-200">{capturedData.tobaccoStatus || '—'}</span>
          </div>
          {capturedData.tobaccoType && (
            <div className="flex items-center justify-between border-b border-white/5 pb-1 pl-2">
              <span className="text-muted-foreground uppercase">Tobacco Type:</span>
              <span className="text-slate-200">{capturedData.tobaccoType}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Health History:</span>
            <span className="text-slate-200">{capturedData.majorHealthHistory || '—'}</span>
          </div>
          {capturedData.majorHealthDetails && (
            <div className="flex flex-col border-b border-white/5 pb-1 pl-2 gap-0.5">
              <span className="text-muted-foreground uppercase">Health Details:</span>
              <span className="text-slate-300 break-words">{capturedData.majorHealthDetails}</span>
            </div>
          )}
          <div className="flex items-center justify-between border-b border-white/5 pb-1">
            <span className="text-muted-foreground uppercase">Bank Account:</span>
            <span className="text-slate-200">{capturedData.hasBankAccount || '—'}</span>
          </div>
          {capturedData.callbackTime && (
            <div className="flex flex-col border-b border-white/5 pb-1 gap-0.5">
              <span className="text-muted-foreground uppercase">Callback Scheduled:</span>
              <span className="text-emerald-400">{capturedData.callbackTime}</span>
            </div>
          )}
        </div>

        {leadId && (
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded p-2.5 flex items-center gap-1.5 mt-auto">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span className="text-[10px] text-emerald-300/80 font-mono">Real-time sync active (ID: {leadId.slice(0,8)})</span>
          </div>
        )}
      </div>
    </div>
  );
}
