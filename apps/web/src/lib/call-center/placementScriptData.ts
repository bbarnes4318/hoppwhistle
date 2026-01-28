// Placement Script Data - Script B
// 6-step decision tree for placement calls (verifying and confirming existing applications)

import { type ScriptNode, NODE_TYPES } from './types';

// ============================================================================
// PLACEMENT SCRIPT PHASES
// ============================================================================

export const PLACEMENT_PHASES: Record<number, { name: string; timing: string; color: string }> = {
  1: { name: 'Paperwork Opener', timing: '0:00-0:30', color: 'bg-blue-500' },
  2: { name: 'Fridge Anchor', timing: '0:30-1:00', color: 'bg-purple-500' },
  3: { name: 'Money Logic', timing: '1:00-2:00', color: 'bg-amber-500' },
  4: { name: 'Beneficiary Lock', timing: '2:00-2:30', color: 'bg-rose-500' },
  5: { name: 'Spam Vaccine', timing: '2:30-3:00', color: 'bg-teal-500' },
  6: { name: 'Closing', timing: '3:00-3:30', color: 'bg-emerald-500' },
};

// ============================================================================
// PLACEMENT SCRIPT NODES
// ============================================================================

export const PLACEMENT_SCRIPT_NODES: Record<string, ScriptNode> = {
  // ==========================================================================
  // STEP 1: PAPERWORK OPENER
  // ==========================================================================
  paperwork_opener: {
    id: 'paperwork_opener',
    type: NODE_TYPES.QUESTION,
    phase: 1,
    title: 'The Paperwork Opener',
    script: `Hi {first_name}, this is {agent_name} with {company}. I'm the manager checking the paperwork for the state-regulated burial program you just qualified for.

Everything looks good, but I have the approval right here on my desk and I just need to check the spelling of your beneficiary's name before I can stick this in the mail. Do you have a minute?`,
    conversionTip: {
      text: 'Establish authority without scaring them. You are just "checking the work."',
      source: 'Placement Best Practices',
    },
    options: [
      {
        label: 'Yes / Okay',
        nextNode: 'fridge_anchor',
        color: 'emerald',
      },
      {
        label: "I didn't do this / Confusion",
        nextNode: 'rebuttal_confusion',
        color: 'amber',
      },
      {
        label: 'Cancel / Remorse',
        nextNode: 'rebuttal_remorse',
        color: 'red',
      },
    ],
  },

  // Rebuttal: Confusion
  rebuttal_confusion: {
    id: 'rebuttal_confusion',
    type: NODE_TYPES.OBJECTION_HANDLER,
    phase: 1,
    title: 'Confusion Rebuttal',
    script: `Oh, I know, honey. {closer_name} is the agent who submitted the paperwork for you earlier. I'm just the person in the back office making sure they spelled your daughter's name right so the check doesn't bounce when the time comes. It takes two seconds.`,
    conversionTip: {
      text: 'Position yourself as back office support, not a salesperson.',
      source: 'Placement Handler',
    },
    nextNode: 'fridge_anchor',
  },

  // Rebuttal: Buyer's Remorse
  rebuttal_remorse: {
    id: 'rebuttal_remorse',
    type: NODE_TYPES.OBJECTION_HANDLER,
    phase: 1,
    title: "Buyer's Remorse Handler",
    script: `I understand. Since I have the paperwork on my desk right now, I can certainly help you with that.

But before I put this in the 'Deny' pile, I have to document who would have received the check, just so we know who is being left out. Who was the beneficiary listing?`,
    conversionTip: {
      text: "Re-anchor to beneficiary protection. Ask 'Was the main reason you wanted to leave this for {beneficiary} so she wouldn't have to pay for the funeral out of her own pocket?'",
      source: 'Placement Recovery',
    },
    options: [
      {
        label: 'Client gives beneficiary name (Continue)',
        nextNode: 'fridge_anchor',
        color: 'emerald',
      },
      {
        label: 'Still wants to cancel',
        nextNode: 'closing_cancelled',
        color: 'red',
      },
    ],
  },

  // ==========================================================================
  // STEP 2: FRIDGE ANCHOR (Compliance Test)
  // ==========================================================================
  fridge_anchor: {
    id: 'fridge_anchor',
    type: NODE_TYPES.QUESTION,
    phase: 2,
    title: 'The Refrigerator Anchor',
    script: `Okay, good. Now, do me a favor. Do you have a pen handy? I want to give you my direct line so you don't have to talk to those computers if you ever need help.`,
    conversionTip: {
      text: 'Get them to physically commit to the relationship.',
      source: 'Placement Best Practices',
    },
    options: [
      {
        label: 'Got a pen / Okay',
        nextNode: 'fridge_info',
        color: 'emerald',
      },
      {
        label: "I'll remember it",
        nextNode: 'rebuttal_no_pen',
        color: 'amber',
      },
    ],
  },

  // Fridge Info (after pen is ready)
  fridge_info: {
    id: 'fridge_info',
    type: NODE_TYPES.STATEMENT,
    phase: 2,
    title: 'Give Contact Info',
    script: `Write down {company}. That is us. And write down my name: {agent_name}. My direct phone number is {agent_phone}.

I want you to stick that on your refrigerator. That way, if you ever have a question about your bill or the policy, you call me directly. You don't call the bank, you don't call the TV numbers. You call me and I'll fix it. Does that sound fair?`,
    nextNode: 'money_logic',
  },

  // Rebuttal: No pen
  rebuttal_no_pen: {
    id: 'rebuttal_no_pen',
    type: NODE_TYPES.OBJECTION_HANDLER,
    phase: 2,
    title: 'Compliance Requirement',
    script: `I know you have a good memory, but I actually require you to write it down before I can mail the policy. It's part of the safety check. I can wait while you grab a napkin or an envelope.`,
    conversionTip: {
      text: 'Do not proceed until they say they are ready.',
      source: 'Placement Compliance',
    },
    nextNode: 'fridge_info',
  },

  // ==========================================================================
  // STEP 3: MONEY LOGIC (Fixed Income Friendly)
  // ==========================================================================
  money_logic: {
    id: 'money_logic',
    type: NODE_TYPES.QUESTION,
    phase: 3,
    title: 'The Money Logic',
    script: `Now, I want to make sure the bank doesn't mess this up. I see the premium is ${'{monthly_premium}'}.

We have it set to come out on the {billing_date}. Is that the day your Social Security money actually is in the account, or does it sometimes come a day or two later?`,
    conversionTip: {
      text: 'Ensure the billing date matches the Social Security deposit exactly.',
      source: 'Placement Retention',
    },
    options: [
      {
        label: 'Date is Correct',
        nextNode: 'date_confirmed',
        color: 'emerald',
      },
      {
        label: 'Date is Wrong (Different Day)',
        nextNode: 'date_picker',
        color: 'amber',
      },
      {
        label: 'Too Expensive',
        nextNode: 'downsell_coverage',
        color: 'red',
      },
    ],
  },

  // Date confirmed
  date_confirmed: {
    id: 'date_confirmed',
    type: NODE_TYPES.STATEMENT,
    phase: 3,
    title: 'Date Confirmed',
    script: `Okay, perfect. I'm going to keep it on the {billing_date} then.

Just write '${'{monthly_premium}'} - Insurance' on your calendar on the {billing_date} so you don't accidentally spend it at the grocery store and lose the coverage.`,
    nextNode: 'beneficiary_confirm',
  },

  // Date picker for wrong date
  date_picker: {
    id: 'date_picker',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 3,
    title: 'Update Billing Date',
    script: `Okay, I am glad we checked. If we try to take it on the wrong day but the government doesn't pay you until later, the bank might bounce it.

What day does your Social Security actually hit your account?`,
    fields: [
      {
        id: 'billing_date',
        label: 'New Billing Date',
        type: 'select',
        dataKey: 'billingDate',
        required: true,
        options: [
          { value: '1st', label: '1st of the month' },
          { value: '2nd', label: '2nd of the month' },
          { value: '3rd', label: '3rd of the month' },
          { value: '4th', label: '4th of the month' },
          { value: '5th', label: '5th of the month' },
          { value: '10th', label: '10th of the month' },
          { value: '15th', label: '15th of the month' },
          { value: '20th', label: '20th of the month' },
        ],
      },
    ],
    conversionTip: {
      text: 'Update ProspectData.billingDate immediately.',
      source: 'Data Sync',
    },
    nextNode: 'date_updated_confirm',
  },

  date_updated_confirm: {
    id: 'date_updated_confirm',
    type: NODE_TYPES.STATEMENT,
    phase: 3,
    title: 'Date Updated',
    script: `I am going to move your date to the {billing_date} to be safe. Does that work better?`,
    nextNode: 'beneficiary_confirm',
  },

  // Downsell for "Too Expensive"
  downsell_coverage: {
    id: 'downsell_coverage',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 3,
    title: 'Downsell Coverage',
    script: `I understand. My job is just to make sure this is comfortable for you.

If ${'{monthly_premium}'} is tight, we can lower the benefit slightly to drop that price down. That way you still have protection, but it's easier on the budget.

What monthly amount would feel more comfortable?`,
    showQuoteCalculator: true,
    showCoverageSelector: true,
    fields: [
      {
        id: 'face_amount',
        label: 'Coverage Amount',
        type: 'currency',
        dataKey: 'faceAmount',
        required: true,
      },
    ],
    conversionTip: {
      text: 'Show the Quote Panel and let them pick a lower coverage amount.',
      source: 'Downsell Recovery',
    },
    nextNode: 'beneficiary_confirm',
  },

  // ==========================================================================
  // STEP 4: BENEFICIARY CONFIRMATION (Emotional Lock)
  // ==========================================================================
  beneficiary_confirm: {
    id: 'beneficiary_confirm',
    type: NODE_TYPES.QUESTION,
    phase: 4,
    title: 'Beneficiary Confirmation',
    script: `Next, let's double-check the most important part. The check.

When the time comes, I have instructions to send the tax-free check to {beneficiary}. Is that still the right person?`,
    conversionTip: {
      text: 'Remind them who this is for - emotional re-anchor.',
      source: 'Placement Lock',
    },
    options: [
      {
        label: 'Confirmed',
        nextNode: 'beneficiary_locked',
        color: 'emerald',
      },
      {
        label: 'Change Name',
        nextNode: 'beneficiary_edit',
        color: 'amber',
      },
    ],
  },

  beneficiary_locked: {
    id: 'beneficiary_locked',
    type: NODE_TYPES.STATEMENT,
    phase: 4,
    title: 'Beneficiary Locked',
    script: `Okay. I have verified the spelling. I am locking that in.

This policy is for {beneficiary}, so we are going to make sure it stays active for them.`,
    nextNode: 'spam_vaccine',
  },

  beneficiary_edit: {
    id: 'beneficiary_edit',
    type: NODE_TYPES.DATA_COLLECTION,
    phase: 4,
    title: 'Update Beneficiary',
    script: `Okay, who should receive the money?`,
    fields: [
      {
        id: 'beneficiary_name',
        label: 'Beneficiary Name',
        type: 'text',
        dataKey: 'primaryBenName',
        required: true,
        placeholder: 'Full legal name',
      },
      {
        id: 'beneficiary_rel',
        label: 'Relationship',
        type: 'select',
        dataKey: 'primaryBenRel',
        options: [
          { value: 'Spouse', label: 'Spouse' },
          { value: 'Child', label: 'Child' },
          { value: 'Parent', label: 'Parent' },
          { value: 'Sibling', label: 'Sibling' },
          { value: 'Other', label: 'Other' },
        ],
      },
    ],
    conversionTip: {
      text: 'Update ProspectData.primaryBenName immediately.',
      source: 'Data Sync',
    },
    nextNode: 'beneficiary_updated_confirm',
  },

  beneficiary_updated_confirm: {
    id: 'beneficiary_updated_confirm',
    type: NODE_TYPES.STATEMENT,
    phase: 4,
    title: 'Beneficiary Updated',
    script: `Okay, I have updated the legal record. This ensures {beneficiary} won't have to fight the state for the money later.`,
    nextNode: 'spam_vaccine',
  },

  // ==========================================================================
  // STEP 5: SPAM VACCINE (Retention)
  // ==========================================================================
  spam_vaccine: {
    id: 'spam_vaccine',
    type: NODE_TYPES.QUESTION,
    phase: 5,
    title: 'The Spam Vaccine',
    script: `Last thing, {first_name}. Now that you are approved, your name effectively goes onto a 'State List' showing you have coverage.

That means in the next few weeks, your phone is going to ring. You're going to get calls from people claiming they need to 'review your policy' or that 'your insurance is expiring.'

Those are lies. They are just trying to trick you into cancelling this to buy their plan.

When they call, I want you to look at that note on your fridge, remember that I already took care of you, and just hang up on them.

Can you promise me you'll do that?`,
    conversionTip: {
      text: 'Inoculate them against other agents calling.',
      source: 'Placement Retention',
    },
    options: [
      {
        label: 'Yes, I promise',
        nextNode: 'closing',
        color: 'emerald',
      },
      {
        label: 'Why would they do that?',
        nextNode: 'spam_explanation',
        color: 'amber',
      },
    ],
  },

  spam_explanation: {
    id: 'spam_explanation',
    type: NODE_TYPES.STATEMENT,
    phase: 5,
    title: 'Spam Explanation',
    script: `Because they see you are a responsible person who bought insurance, so they want to steal your business. Don't let them confuse you.

Stick with the number on the fridge.`,
    nextNode: 'closing',
  },

  // ==========================================================================
  // STEP 6: CLOSING
  // ==========================================================================
  closing: {
    id: 'closing',
    type: NODE_TYPES.CLOSE,
    phase: 6,
    title: 'Closing',
    script: `Alright, I've stamped the approval. The policy is going in the mail today.

Keep an eye out for a white envelope from {company} in about 10 days.

Welcome to the family, {first_name}.`,
    isEndNode: true,
    conversionTip: {
      text: 'Celebrate the placement! Policy is confirmed.',
      source: 'Placement Success',
    },
  },

  // Cancelled path
  closing_cancelled: {
    id: 'closing_cancelled',
    type: NODE_TYPES.CLOSE,
    phase: 6,
    title: 'Call Cancelled',
    script: `I understand. I will mark this as cancelled in the system.

If you change your mind or have any questions in the future, you can always reach us at the number I gave you.

Take care, {first_name}.`,
    isEndNode: true,
  },
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function getPlacementNode(nodeId: string): ScriptNode | undefined {
  return PLACEMENT_SCRIPT_NODES[nodeId];
}

export function getPlacementStartNode(): string {
  return 'paperwork_opener';
}

export function getTotalPlacementPhases(): number {
  return Object.keys(PLACEMENT_PHASES).length;
}
