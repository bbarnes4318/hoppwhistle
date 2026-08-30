import type { CanonicalBrief, ResearchPlan } from './types.js';

/**
 * Deterministically decompose the assignment into research workstreams from the
 * canonical brief. This is a structural plan (query families, preferred sources,
 * stopping criteria) — it contains no fabricated evidence, citations, or
 * findings. Real provider stages fill it with evidence.
 */
export function buildResearchPlan(brief: CanonicalBrief): ResearchPlan {
  const industry = brief.industry;
  const streams: Array<[string, string, string]> = [
    [
      'taxonomy',
      'Industry definition & taxonomy',
      'Define what the industry includes/excludes and its meaningful segments.',
    ],
    [
      'value_chain',
      'Value chain & money flow',
      'Map who creates, distributes, decides, pays, and earns the margin.',
    ],
    [
      'market_sizing',
      'Bottom-up market sizing',
      'Estimate obtainable market from counts × spend × penetration.',
    ],
    ['customer', 'Customer analysis', 'Identify personas, pains, budget, and switching triggers.'],
    ['operator', 'Operator reality', 'Reconstruct daily workflows, staffing, and hidden labor.'],
    ['voice', 'Voice of market', 'Collect firsthand practitioner and customer sentiment.'],
    ['competitors', 'Competitors & pricing', 'Build a competitor matrix and find whitespace.'],
    ['economics', 'Unit economics', 'Model conservative/base/aggressive scenarios.'],
    ['regulation', 'Regulation', 'Identify licensing, compliance cost, and enforcement risk.'],
    ['tech', 'Technology & AI opportunities', 'Find where software/AI creates measurable value.'],
    ['entry', 'Entry models & wedges', 'Generate and rank entry models.'],
    ['redteam', 'Red-team investigation', 'Premortem the recommended thesis.'],
  ];
  return {
    summary: `Research plan for entering ${industry} in ${brief.geography} with a ${brief.mode} pass.`,
    workstreams: streams.map(([key, title, objective]) => ({
      key,
      title,
      objective,
      queryFamilies: [
        `${industry} ${title.toLowerCase()}`,
        `${industry} pricing`,
        `${industry} complaints`,
      ],
      preferredSources: ['official statistics', 'pricing pages', 'practitioner forums'],
      evidenceTypes: ['primary', 'reported experience', 'estimate'],
      stoppingCriteria: 'Diminishing new sources or target source count reached.',
    })),
  };
}
