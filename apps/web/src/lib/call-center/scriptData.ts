// scriptData.ts - STATE MACHINE BUILT FROM "THE GOLDEN PATH" SCRIPT
// Source: Reverse-Engineered from 624 Successful Final Expense Sales
// Average Call Duration: 35 minutes 58 seconds | Script Adherence: 93.4%

import { NODE_TYPES, type ScriptNode, type ScriptPhase } from './types';

// ═══════════════════════════════════════════════════════════════════
// CONVERSION DATA FROM THE GOLDEN PATH ANALYSIS
// ═══════════════════════════════════════════════════════════════════
export const CONVERSION_DATA = {
  baseline: 93.4,
  totalSales: 624,
  averageCallDuration: '35:58',
  totalScriptSections: 12,
  timestampAverages: {
    qualificationEnded: '5:57',
    healthQuestionsStarted: '4:40',
    presentationStarted: '7:33',
    pricingPresented: '9:08',
    closeAttempted: '10:46',
    ssnCollected: '15:30',
    bankingCollected: '18:51',
  },
};

// ═══════════════════════════════════════════════════════════════════
// PHASE METADATA
// ═══════════════════════════════════════════════════════════════════
export const SCRIPT_PHASES: Record<number, ScriptPhase> = {
  1: { name: 'The Trust Anchor', timing: '0:00 - 0:45', color: 'blue' },
  2: { name: 'The Emotional Excavation', timing: '0:45 - 4:40', color: 'purple' },
  3: { name: 'The Eligibility Pivot', timing: '4:40 - 7:30', color: 'green' },
  4: { name: 'The Value Bridge', timing: '7:30 - 9:00', color: 'yellow' },
  5: { name: 'The Option Selection', timing: '9:00 - 10:45', color: 'orange' },
  6: { name: 'The Commitment Seal', timing: '10:45 - 12:00', color: 'red' },
  7: { name: 'The Identity Lock', timing: '12:00 - 15:30', color: 'indigo' },
  8: { name: 'The Financial Disarm', timing: '15:30 - 19:00', color: 'pink' },
  9: { name: 'The Victory Lap', timing: '19:00 - 35:58', color: 'teal' },
};

// ═══════════════════════════════════════════════════════════════════
// SCRIPT NODES - GOLDEN PATH STATE MACHINE
// ═══════════════════════════════════════════════════════════════════
export const SCRIPT_NODES: Record<string, ScriptNode> = {
  // ═══════════════════════════════════════════════════════════════
  // PHASE 1: THE TRUST ANCHOR (0:00 - 0:45)
  // ═══════════════════════════════════════════════════════════════
  greeting_start: {
    id: 'greeting_start',
    type: NODE_TYPES.VERIFICATION,
    phase: 1,
    title: '👋 The Trust Anchor',
    timestamp: '0:00 - 0:45',
    conversionTip: { text: '+7.1% lift (dove_straight_in)', source: 'opening_approach' },
    script: `Hello, this is {agent_name}, the licensed field underwriter for the state of {state}.

Just to make sure I've got the right file in front of me... I am speaking with {first_name} {last_name}, correct?`,
    options: [
      { label: '✅ Yes', nextNode: 'verify_state' },
      { label: '❌ No / Need to correct', nextNode: 'correct_info' },
    ],
  },

  verify_state: {
    id: 'verify_state',
    type: NODE_TYPES.VERIFICATION,
    phase: 1,
    title: '📍 Verify State',
    conversionTip: { text: '+4.1% lift (full_name)', source: 'Full Name Verification' },
    script: `Okay, great. And you're in the state of {state}, right?`,
    options: [
      { label: '✅ Yes', nextNode: 'verify_age' },
      { label: '❌ No / Different state', nextNode: 'correct_state' },
    ],
  },

  correct_info: {
    id: 'correct_info',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 1,
    title: '✏️ Correct Information',
    script: `My apologies, let me update my file. What is the correct spelling of your name?`,
    captureVariable: 'first_name',
    nextNode: 'verify_state',
  },

  correct_state: {
    id: 'correct_state',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 1,
    title: '📍 Correct State',
    script: `Oh, I'm sorry. Which state are you in?`,
    captureVariable: 'state',
    nextNode: 'verify_age',
  },

  verify_age: {
    id: 'verify_age',
    type: NODE_TYPES.VERIFICATION,
    phase: 1,
    title: '🎂 Verify Age',
    conversionTip: {
      text: '+4.3% lift (controlled_conversation)',
      source: 'Controlled Conversation',
    },
    script: `And I have your date of birth listed as {dob}, making you {age} years young, correct?`,
    options: [
      { label: '✅ Yes', nextNode: 'purpose_statement' },
      { label: '❌ No / Need to correct', nextNode: 'correct_age' },
    ],
  },

  correct_age: {
    id: 'correct_age',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 1,
    title: '✏️ Correct Age',
    script: `Let me correct that. What is your actual date of birth?`,
    captureVariable: 'dob',
    nextNode: 'purpose_statement',
  },

  purpose_statement: {
    id: 'purpose_statement',
    type: NODE_TYPES.STATEMENT,
    phase: 1,
    title: '🎯 Purpose Statement',
    conversionTip: { text: '+11.7% lift (tie_downs)', source: 'Tie-Down Questions' },
    script: `Perfect. My job today is simple: as a state-regulated broker, I'm required to verify your information and see if you qualify for the state-approved final expense programs. Fair enough?`,
    options: [
      { label: '✅ Fair enough', nextNode: 'transition_to_discovery' },
      { label: '❓ What is this?', nextNode: 'explain_program' },
    ],
  },

  explain_program: {
    id: 'explain_program',
    type: NODE_TYPES.OBJECTION_HANDLER,
    phase: 1,
    title: '📋 Explain Program',
    script: `This is regarding the final expense benefits designed to cover burial and cremation costs so your family isn't left with a bill. I just need to ask a few questions to see what you qualify for.`,
    nextNode: 'transition_to_discovery',
  },

  // ═══════════════════════════════════════════════════════════════
  // PHASE 2: THE EMOTIONAL EXCAVATION (0:45 - 4:40)
  // ═══════════════════════════════════════════════════════════════
  transition_to_discovery: {
    id: 'transition_to_discovery',
    type: NODE_TYPES.QUESTION,
    phase: 2,
    title: '💜 Beneficiary Discovery',
    timestamp: '0:45 - 4:40',
    conversionTip: { text: '+12.7% lift (beneficiary_discussed)', source: 'needs_analysis' },
    script: `Now {first_name}, before we look at the numbers, I need to understand who we are protecting today. If something were to happen to you yesterday, who would be the person responsible for handling your arrangements?`,
    options: [
      { label: '👨‍👩‍👧 Child', nextNode: 'beneficiary_child' },
      { label: '💑 Spouse', nextNode: 'beneficiary_spouse' },
      { label: '👥 Sibling', nextNode: 'beneficiary_sibling' },
      { label: '❌ Nobody', nextNode: 'beneficiary_nobody' },
    ],
  },

  beneficiary_child: {
    id: 'beneficiary_child',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 2,
    title: '👶 Child Beneficiary',
    script: `Okay, and what is your child's name?`,
    captureVariable: 'beneficiary',
    nextNode: 'beneficiary_location',
  },

  beneficiary_spouse: {
    id: 'beneficiary_spouse',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 2,
    title: '💑 Spouse Beneficiary',
    script: `Okay, and what is your spouse's name?`,
    captureVariable: 'beneficiary',
    nextNode: 'beneficiary_location',
  },

  beneficiary_sibling: {
    id: 'beneficiary_sibling',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 2,
    title: '👥 Sibling Beneficiary',
    script: `Okay, and what is your sibling's name?`,
    captureVariable: 'beneficiary',
    nextNode: 'beneficiary_location',
  },

  beneficiary_location: {
    id: 'beneficiary_location',
    type: NODE_TYPES.QUESTION,
    phase: 2,
    title: '📍 Beneficiary Location',
    conversionTip: { text: '+5.9% lift (showed_genuine_interest)', source: 'Rapport Building' },
    script: `Does {beneficiary} live close by to you in {state}, or are they in a different state?`,
    options: [
      { label: '🏠 Close by', nextNode: 'financial_reality' },
      { label: '✈️ Far away', nextNode: 'financial_reality' },
    ],
  },

  financial_reality: {
    id: 'financial_reality',
    type: NODE_TYPES.QUESTION,
    phase: 2,
    title: '💰 Financial Reality Check',
    conversionTip: { text: '+5.9% lift (mentioned_family_burden)', source: 'Pain Point' },
    script: `God forbid, if you passed away today, would {beneficiary} have the $10,000 to $15,000 cash on hand to pay for the funeral immediately?`,
    options: [
      { label: '❌ No', nextNode: 'validate_concern' },
      { label: '✅ Yes', nextNode: 'why_insurance' },
    ],
  },

  why_insurance: {
    id: 'why_insurance',
    type: NODE_TYPES.QUESTION,
    phase: 2,
    title: '❓ Why Insurance',
    script: `That's a blessing that they have funds, but let me ask you—did you want them to use their own savings for this, or was your goal to leave them something extra?`,
    options: [
      { label: '🛡️ Protect savings', nextNode: 'validate_concern' },
      { label: '💝 Leave extra', nextNode: 'validate_concern' },
    ],
  },

  validate_concern: {
    id: 'validate_concern',
    type: NODE_TYPES.STATEMENT,
    phase: 2,
    title: '✅ Validate Concern',
    conversionTip: { text: '+12.9% lift (validated_prospect_concerns)', source: 'Validation' },
    script: `I understand completely. That is exactly why we are on the phone. We want to make sure {beneficiary} never has to worry about that bill. Does that make sense?`,
    nextNode: 'transition_to_health',
  },

  beneficiary_nobody: {
    id: 'beneficiary_nobody',
    type: NODE_TYPES.QUESTION,
    phase: 2,
    title: '⚰️ No Beneficiary',
    script: `If there is no one currently, the state would typically handle those arrangements. Is your goal to have a dignified service handled by a professional?`,
    options: [{ label: '✅ Yes', nextNode: 'transition_to_health' }],
  },

  transition_to_health: {
    id: 'transition_to_health',
    type: NODE_TYPES.TRANSITION,
    phase: 2,
    title: '🏥 Transition to Health',
    conversionTip: { text: '+1.02% (authority_title)', source: 'Authority Positioning' },
    script: `Okay {first_name}, based on what you've told me, I can definitely help. To find you the best rate, I just need to ask a few medical questions. Fair enough?`,
    nextNode: 'tobacco_check',
  },

  // ═══════════════════════════════════════════════════════════════
  // PHASE 3: THE ELIGIBILITY PIVOT (4:40 - 7:30)
  // ═══════════════════════════════════════════════════════════════
  tobacco_check: {
    id: 'tobacco_check',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '🚬 Tobacco Check',
    timestamp: '4:40 - 7:30',
    script: `First, have you used any form of tobacco or nicotine in the last 12 months?`,
    options: [
      { label: '✅ No', nextNode: 'height_weight', setData: { tobacco: false } },
      { label: '🚬 Yes', nextNode: 'height_weight', setData: { tobacco: true } },
    ],
  },

  height_weight: {
    id: 'height_weight',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 3,
    title: '📏 Height & Weight',
    script: `And roughly, how tall are you and how much do you weigh?`,
    captureVariable: 'height_weight',
    nextNode: 'health_intro',
  },

  health_intro: {
    id: 'health_intro',
    type: NODE_TYPES.STATEMENT,
    phase: 3,
    title: '🏥 Health Questions Intro',
    script: `Now I need to ask you some health questions. These are yes or no questions that help determine which plan you qualify for.`,
    nextNode: 'health_q1',
  },

  // ═══════════════════════════════════════════════════════════════
  // HEALTH QUESTIONS Q1-Q3: If ANY Yes = NOT ELIGIBLE
  // ═══════════════════════════════════════════════════════════════
  health_q1: {
    id: 'health_q1',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '❤️ Health Q1 - Critical Conditions',
    eligibilityNote: '⚠️ If Yes to Q1-Q3: NOT ELIGIBLE for coverage',
    script: `Are you currently hospitalized, confined to a nursing facility, a bed, or a wheelchair due to chronic illness, currently using oxygen equipment, receiving Hospice Care, or do you require assistance with activities of daily living?`,
    options: [
      { label: '✅ No', nextNode: 'health_q2', color: 'emerald', setData: { q1: false } },
      { label: '❌ Yes', nextNode: 'not_eligible', color: 'red', setData: { q1: true } },
    ],
  },

  health_q2: {
    id: 'health_q2',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '🏥 Health Q2 - Serious Conditions',
    eligibilityNote: '⚠️ If Yes to Q1-Q3: NOT ELIGIBLE for coverage',
    script: `Have you had or been advised to have an organ transplant or kidney dialysis, or been diagnosed with congestive heart failure, Alzheimer's, dementia, ALS, or a terminal condition?`,
    options: [
      { label: '✅ No', nextNode: 'health_q3', color: 'emerald', setData: { q2: false } },
      { label: '❌ Yes', nextNode: 'not_eligible', color: 'red', setData: { q2: true } },
    ],
  },

  health_q3: {
    id: 'health_q3',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '🔬 Health Q3 - HIV/AIDS',
    eligibilityNote: '⚠️ If Yes to Q1-Q3: NOT ELIGIBLE for coverage',
    script: `Have you been treated or diagnosed as having AIDS, AIDS related complex, or tested positive for HIV?`,
    options: [
      { label: '✅ No', nextNode: 'health_q4', color: 'emerald', setData: { q3: false } },
      { label: '❌ Yes', nextNode: 'not_eligible', color: 'red', setData: { q3: true } },
    ],
  },

  not_eligible: {
    id: 'not_eligible',
    type: NODE_TYPES.OBJECTION_HANDLER,
    phase: 3,
    title: '🚫 Not Eligible',
    script: `I appreciate your honesty. Unfortunately, based on your answer, you would not be eligible for coverage at this time. I apologize I wasn't able to help you today.`,
    options: [{ label: '📞 End Call', nextNode: 'end_call', color: 'gray' }],
  },

  // ═══════════════════════════════════════════════════════════════
  // HEALTH QUESTIONS Q4-Q7: If ANY Yes = ROP Plan
  // ═══════════════════════════════════════════════════════════════
  health_q4: {
    id: 'health_q4',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '💊 Health Q4 - Diabetes',
    eligibilityNote: 'ℹ️ If Yes to Q4-Q7: Qualifies for ROP Plan',
    script: `Have you ever been diagnosed or treated for complications of diabetes, including insulin shock, diabetic coma, or used insulin prior to age 50?`,
    options: [
      { label: '✅ No', nextNode: 'health_q5', color: 'emerald', setData: { q4: false } },
      { label: '⚠️ Yes', nextNode: 'health_q5', color: 'amber', setData: { q4: true } },
    ],
  },

  health_q5: {
    id: 'health_q5',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '🔬 Health Q5 - Kidney/Cancer',
    eligibilityNote: 'ℹ️ If Yes to Q4-Q7: Qualifies for ROP Plan',
    script: `Have you ever been diagnosed or treated for kidney failure, chronic kidney disease, or more than one occurrence of cancer (excluding basal cell skin cancer)?`,
    options: [
      { label: '✅ No', nextNode: 'health_q6', color: 'emerald', setData: { q5: false } },
      { label: '⚠️ Yes', nextNode: 'health_q6', color: 'amber', setData: { q5: true } },
    ],
  },

  health_q6: {
    id: 'health_q6',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '🩺 Health Q6 - Pending Tests',
    eligibilityNote: 'ℹ️ If Yes to Q4-Q7: Qualifies for ROP Plan',
    script: `Within the past 2 years, have you had any diagnostic testing or hospitalization advised which has not been completed?`,
    options: [
      { label: '✅ No', nextNode: 'health_q7a', color: 'emerald', setData: { q6: false } },
      { label: '⚠️ Yes', nextNode: 'health_q7a', color: 'amber', setData: { q6: true } },
    ],
  },

  health_q7a: {
    id: 'health_q7a',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '❤️ Health Q7a - Heart/Lung (2yr)',
    eligibilityNote: 'ℹ️ If Yes to Q4-Q7: Qualifies for ROP Plan',
    script: `Within the past 2 years, have you been diagnosed or treated for angina, stroke, cardiomyopathy, COPD, emphysema, or chronic bronchitis?`,
    options: [
      { label: '✅ No', nextNode: 'health_q8a', color: 'emerald', setData: { q7a: false } },
      { label: '⚠️ Yes', nextNode: 'health_q8a', color: 'amber', setData: { q7a: true } },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // HEALTH QUESTIONS Q8: If ANY Yes = Graded Plan
  // ═══════════════════════════════════════════════════════════════
  health_q8a: {
    id: 'health_q8a',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '❤️ Health Q8a - Heart (3yr)',
    eligibilityNote: 'ℹ️ If Yes to Q8: Qualifies for Graded Plan',
    script: `Within the past 3 years, have you been diagnosed or hospitalized for stroke, heart attack, aneurysm, or heart surgery?`,
    options: [
      { label: '✅ No', nextNode: 'health_q8b', color: 'emerald', setData: { q8a: false } },
      { label: '⚠️ Yes', nextNode: 'health_q8b', color: 'amber', setData: { q8a: true } },
    ],
  },

  health_q8b: {
    id: 'health_q8b',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '🫁 Health Q8b - Cancer/Lung (3yr)',
    eligibilityNote: 'ℹ️ If Yes to Q8: Qualifies for Graded Plan',
    script: `Within the past 3 years, have you been diagnosed or treated for any form of cancer (excluding basal cell), emphysema, COPD, or liver disease?`,
    options: [
      { label: '✅ No', nextNode: 'health_q8c', color: 'emerald', setData: { q8b: false } },
      { label: '⚠️ Yes', nextNode: 'health_q8c', color: 'amber', setData: { q8b: true } },
    ],
  },

  health_q8c: {
    id: 'health_q8c',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: '🧠 Health Q8c - Neurological (3yr)',
    eligibilityNote: 'ℹ️ If Yes to Q8: Qualifies for Graded Plan',
    script: `Within the past 3 years, have you been diagnosed or hospitalized for multiple sclerosis, seizures, Parkinson's, or muscular dystrophy?`,
    options: [
      { label: '✅ No', nextNode: 'health_summary', color: 'emerald', setData: { q8c: false } },
      { label: '⚠️ Yes', nextNode: 'health_summary', color: 'amber', setData: { q8c: true } },
    ],
  },

  health_summary: {
    id: 'health_summary',
    type: NODE_TYPES.STATEMENT,
    phase: 3,
    title: '📋 Health Summary',
    script: `Great, thank you for answering those questions honestly. Based on your responses, I can see what plans you qualify for. Let me pull up your rates.`,
    nextNode: 'transition_to_presentation',
  },

  transition_to_presentation: {
    id: 'transition_to_presentation',
    type: NODE_TYPES.TRANSITION,
    phase: 3,
    title: '⏭️ Transition to Presentation',
    script: `Excellent. Based on your health answers, I'm seeing some great options for you. Give me one moment to pull up the state-approved rates.`,
    nextNode: 'pricing_anchor',
  },

  // ═══════════════════════════════════════════════════════════════
  // PHASE 4: THE VALUE BRIDGE (7:30 - 9:00)
  // ═══════════════════════════════════════════════════════════════
  pricing_anchor: {
    id: 'pricing_anchor',
    type: NODE_TYPES.QUESTION,
    phase: 4,
    title: '⚓ Budget Anchor',
    timestamp: '7:30 - 9:00',
    conversionTip: { text: '+13.4% lift (used_anchoring)', source: 'anchoring' },
    script: `Now, most of my clients in {state} with a fixed income like to keep their budget between $50 and $80 a month to get the maximum coverage. Does that range sound comfortable for you?`,
    options: [
      { label: '✅ Comfortable', nextNode: 'coverage_selection' },
      { label: '⬇️ Lower', nextNode: 'coverage_selection' },
      { label: '⬆️ Higher', nextNode: 'coverage_selection' },
    ],
  },

  coverage_selection: {
    id: 'coverage_selection',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 4,
    title: '💵 Coverage Amount',
    conversionTip: { text: 'Three Option Strategy - show high/mid/low', source: 'Strategy' },
    script: `Based on what you told me about your budget, let me pull up the best rates. What coverage amount would work best for {beneficiary}?`,
    captureVariable: 'target_coverage',
    showCoverageSelector: true,
    nextNode: 'present_options',
  },

  present_options: {
    id: 'present_options',
    type: NODE_TYPES.QUOTE,
    phase: 4,
    title: '📋 Present Three Options',
    conversionTip: { text: '+10.3% lift (offered_multiple_options)', source: 'Multiple Options' },
    script: `Okay {first_name}, I have three options approved for you. Grab a pen and paper, let me know when you're ready.`,
    showQuoteCalculator: true,
    showThreeOptions: true,
    nextNode: 'trial_close_selection',
  },

  // ═══════════════════════════════════════════════════════════════
  // PHASE 5-6: CLOSE
  // ═══════════════════════════════════════════════════════════════
  trial_close_selection: {
    id: 'trial_close_selection',
    type: NODE_TYPES.QUESTION,
    phase: 6,
    title: '🎯 Trial Close',
    timestamp: '10:45 - 12:00',
    conversionTip: { text: '+20.3% lift (alternative_choice)', source: 'alternative_choice' },
    script: `Looking at those three, {first_name}, which one fits your budget best so we can get this to {beneficiary}?`,
    options: [
      { label: '💎 High', nextNode: 'assumptive_transition' },
      { label: '⭐ Mid', nextNode: 'assumptive_transition' },
      { label: '✅ Low', nextNode: 'assumptive_transition' },
      { label: '💰 Too expensive', nextNode: 'objection_price_handler' },
      { label: '🤔 Think about it', nextNode: 'objection_think_handler' },
    ],
  },

  assumptive_transition: {
    id: 'assumptive_transition',
    type: NODE_TYPES.STATEMENT,
    phase: 6,
    title: '✅ Assumptive Close',
    conversionTip: { text: '+30.3% lift (assumptive_close)', source: 'assumptive_close' },
    script: `Excellent choice. That's the one I would have picked for you as well. Let me just verify the spelling of your last name to get that started.`,
    options: [
      { label: '✅ Yes', nextNode: 'verify_address' },
      { label: '✏️ Correction needed', nextNode: 'verify_address' },
    ],
  },

  verify_address: {
    id: 'verify_address',
    type: NODE_TYPES.VERIFICATION,
    phase: 6,
    title: '📬 Verify Address',
    script: `And for the policy delivery, is {address} the best place to mail the hard copy?`,
    options: [
      { label: '✅ Yes', nextNode: 'ssn_intro' },
      { label: '✏️ No, different address', nextNode: 'ssn_intro' },
    ],
  },

  // ═══════════════════════════════════════════════════════════════
  // PHASE 7: THE IDENTITY LOCK (12:00 - 15:30)
  // ═══════════════════════════════════════════════════════════════
  ssn_intro: {
    id: 'ssn_intro',
    type: NODE_TYPES.STATEMENT,
    phase: 7,
    title: '🔒 SSN Introduction',
    timestamp: '12:00 - 15:30',
    script: `Okay, we are almost done. The insurance company requires an MIB check to verify your health. It's just an identity check.`,
    nextNode: 'ssn_ask',
  },

  ssn_ask: {
    id: 'ssn_ask',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 7,
    title: '🔢 SSN Collection',
    script: `What is your Social Security Number so I can verify your identity?`,
    captureVariable: 'ssn',
    options: [
      { label: '✅ Provides SSN', nextNode: 'ssn_confirmation' },
      { label: '⚠️ Hesitates', nextNode: 'ssn_reassurance' },
    ],
  },

  ssn_reassurance: {
    id: 'ssn_reassurance',
    type: NODE_TYPES.STATEMENT,
    phase: 7,
    title: '🔐 SSN Reassurance',
    script: `I understand. Just so you know, I cannot see the number once I type it in; it turns into asterisks for your security. Go ahead.`,
    options: [
      { label: '✅ Provides SSN', nextNode: 'ssn_confirmation' },
      { label: '❌ Still refuses', nextNode: 'bank_intro' },
    ],
  },

  ssn_confirmation: {
    id: 'ssn_confirmation',
    type: NODE_TYPES.STATEMENT,
    phase: 7,
    title: '✅ SSN Confirmed',
    script: `Thank you. Submitting to the medical bureau now... Okay, everything is checking out.`,
    nextNode: 'bank_intro',
  },

  // ═══════════════════════════════════════════════════════════════
  // PHASE 8: THE FINANCIAL DISARM (15:30 - 19:00)
  // ═══════════════════════════════════════════════════════════════
  bank_intro: {
    id: 'bank_intro',
    type: NODE_TYPES.STATEMENT,
    phase: 8,
    title: '🏦 Banking Introduction',
    timestamp: '15:30 - 19:00',
    conversionTip: { text: '+17.0% lift (explained_why_needed)', source: 'banking_approach' },
    script: `Now {first_name}, the last step is to set up your state-regulated profile so the carrier can send the money to {beneficiary}. They don't accept cash or checks through the mail anymore because of fraud.`,
    nextNode: 'bank_ask',
  },

  bank_ask: {
    id: 'bank_ask',
    type: NODE_TYPES.QUESTION,
    phase: 8,
    title: '🏦 Bank Question',
    conversionTip: { text: '+46.0% lift (normalized_the_ask)', source: 'banking_approach' },
    script: `Do you do your banking with a local bank like Chase or Wells Fargo, or a credit union?`,
    options: [
      { label: '🏦 Local bank', nextNode: 'routing_ask' },
      { label: '🏛️ Credit union', nextNode: 'routing_ask' },
      { label: '❌ No bank', nextNode: 'recap' },
    ],
  },

  routing_ask: {
    id: 'routing_ask',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 8,
    title: '🔢 Routing Number',
    script: `Okay, grab your checkbook. I need the 9-digit routing number to verify they are a participating bank.`,
    captureVariable: 'routing',
    nextNode: 'account_ask',
  },

  account_ask: {
    id: 'account_ask',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 8,
    title: '🔢 Account Number',
    script: `Perfect. Now, what is the account number right next to it?`,
    captureVariable: 'accountNum',
    nextNode: 'recap',
  },

  // ═══════════════════════════════════════════════════════════════
  // PHASE 9: THE VICTORY LAP (19:00 - 35:58)
  // ═══════════════════════════════════════════════════════════════
  recap: {
    id: 'recap',
    type: NODE_TYPES.STATEMENT,
    phase: 9,
    title: '🎉 Congratulations',
    timestamp: '19:00 - 35:58',
    conversionTip: { text: '+23.6% lift (summary_close)', source: 'Summary Close' },
    script: `Congratulations {first_name}, you are approved! You have {coverage_amount} of whole life coverage for {monthly_premium}. Your beneficiary is {beneficiary}.`,
    nextNode: 'goodbye',
  },

  goodbye: {
    id: 'goodbye',
    type: NODE_TYPES.STATEMENT,
    phase: 9,
    title: '👋 Closing',
    script: `You will receive your policy in the mail in about 7-10 days. Call me if you need anything. Have a blessed day!`,
    options: [{ label: 'End Call', nextNode: 'end_call' }],
  },

  end_call: {
    id: 'end_call',
    type: NODE_TYPES.STATEMENT,
    phase: 9,
    title: '📞 End Call',
    script: `Thank you for your time today, {first_name}. Have a great day!`,
    isEndNode: true,
  },

  // ═══════════════════════════════════════════════════════════════
  // OBJECTION HANDLERS
  // ═══════════════════════════════════════════════════════════════
  objection_price_handler: {
    id: 'objection_price_handler',
    type: NODE_TYPES.OBJECTION_HANDLER,
    phase: 6,
    title: '💰 Price Objection',
    script: `I completely understand. We are all on a budget these days. If we could drop the coverage slightly to get the payment under $50, would that be more comfortable?`,
    options: [
      { label: '✅ Yes', nextNode: 'present_options' },
      { label: '❌ No', nextNode: 'end_call' },
    ],
  },

  objection_think_handler: {
    id: 'objection_think_handler',
    type: NODE_TYPES.OBJECTION_HANDLER,
    phase: 6,
    title: '🤔 Think About It',
    script: `That's perfectly fine. Usually when folks say that, it's either the price or they want to talk to someone. Which is it for you?`,
    options: [
      { label: '👨‍👩‍👧 Talk to family', nextNode: 'responsibility_reframe' },
      { label: '💰 Price', nextNode: 'objection_price_handler' },
    ],
  },

  responsibility_reframe: {
    id: 'responsibility_reframe',
    type: NODE_TYPES.STATEMENT,
    phase: 6,
    title: '🎯 Reframe Responsibility',
    script: `I understand. But let me ask—if your kids said 'No, don't buy it', would you really want to leave them with the bill? Or is this something you want to take care of for them?`,
    options: [{ label: '✅ Take care of it', nextNode: 'assumptive_transition' }],
  },
};

// ═══════════════════════════════════════════════════════════════════
// STARTING NODE
// ═══════════════════════════════════════════════════════════════════
export const STARTING_NODE = 'greeting_start';

// ═══════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════
export function getNode(id: string): ScriptNode | null {
  return SCRIPT_NODES[id] || null;
}

export function replaceVariables(text: string, data: Record<string, unknown>): string {
  if (!text || !data) return text;

  // Import age calculation inline to avoid circular dependencies
  const calculateAgeFromDOB = (dob: string | undefined): number | null => {
    if (!dob) return null;
    const birthDate = new Date(dob);
    if (isNaN(birthDate.getTime())) return null;

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    return age >= 0 && age <= 120 ? age : null;
  };

  // Auto-calculate age from DOB if age not provided
  const calculatedAge = data.age || calculateAgeFromDOB(data.dob as string | undefined);

  let result = text;
  const vars: Record<string, string> = {
    agent_name: String(data.agent_name || 'Your Agent'),
    first_name: String(data.firstName || data.first_name || 'there'),
    last_name: String(data.lastName || data.last_name || ''),
    state: String(data.state || 'your state'),
    dob: String(data.dob || ''),
    age: calculatedAge ? String(calculatedAge) : '',
    beneficiary: String(data.beneficiary || data.primaryBenName || 'your loved one'),
    address: String(data.address || ''),
    coverage_amount: data.faceAmount ? `$${Number(data.faceAmount).toLocaleString()}` : '$10,000',
    monthly_premium: data.monthlyPremium ? `$${Number(data.monthlyPremium).toFixed(2)}` : '$75.00',
    billing_date: String(data.billingDate || data.draftDate || 'the 1st'),
    company: String(data.company || 'Hopwhistle'),
    agent_phone: String(data.agentPhone || '1-800-XXX-XXXX'),
    closer_name: String(data.closerName || 'our enrollment specialist'),
  };

  Object.entries(vars).forEach(([key, value]) => {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  });

  return result;
}
