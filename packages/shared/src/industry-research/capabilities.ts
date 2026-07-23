// Team capability taxonomy for the Industry Research feature.
// Shared between the web capability picker and the server-side prompt builder so
// the labels shown to users are exactly the labels sent to the research providers.

export interface CapabilityItem {
  id: string;
  label: string;
}

export interface CapabilityCategory {
  id: string;
  label: string;
  items: CapabilityItem[];
}

/** Build a stable id from a category + label. */
function item(label: string): CapabilityItem {
  const id = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return { id, label };
}

export const CAPABILITY_CATEGORIES: CapabilityCategory[] = [
  {
    id: 'technology-product',
    label: 'Technology & Product',
    items: [
      'Full-stack software development',
      'Front-end development',
      'Back-end and API development',
      'Mobile application development',
      'Rapid MVP development',
      'AI development and integration',
      'Machine-learning engineering',
      'Voice AI',
      'Telecommunications and VoIP',
      'Data engineering',
      'Data enrichment',
      'Workflow automation',
      'Systems integration',
      'Cybersecurity',
      'Product design',
      'Product management',
      'Marketplace development',
      'SaaS development',
      'Internal tooling',
      'Analytics and reporting',
    ].map(item),
  },
  {
    id: 'sales-growth',
    label: 'Sales & Growth',
    items: [
      'Lead generation',
      'Cold calling',
      'Cold email',
      'SMS outreach',
      'Paid acquisition',
      'SEO and content',
      'Appointment setting',
      'Inbound sales',
      'Enterprise sales',
      'Channel partnerships',
      'Affiliate marketing',
      'Account-based sales',
      'Sales operations',
      'Call-center operations',
      'Performance marketing',
      'Local-market sales',
      'Relationship-based selling',
    ].map(item),
  },
  {
    id: 'business-operations',
    label: 'Business & Operations',
    items: [
      'Strategic business consulting',
      'Business development',
      'Operational process design',
      'Financial modeling',
      'Pricing strategy',
      'Mergers and acquisitions',
      'Buying and selling businesses',
      'Vendor negotiation',
      'Outsourcing and offshore teams',
      'Customer support operations',
      'Compliance operations',
      'Project management',
      'Industry partnerships',
      'Capital raising',
      'Procurement',
      'Turnaround operations',
    ].map(item),
  },
  {
    id: 'commercial-models',
    label: 'Commercial Models We Can Execute',
    items: [
      'Sell a service before building software',
      'Productized service',
      'Managed service',
      'SaaS',
      'AI-enabled service',
      'Marketplace',
      'Brokerage',
      'Lead generation',
      'Appointment generation',
      'Pay-for-performance',
      'Data product',
      'API',
      'White-label software',
      'Licensing',
      'Infrastructure',
      'Outsourcing',
      'Acquisition of an existing operator',
      'Roll-up strategy',
      'Hybrid software-and-service model',
    ].map(label => {
      // avoid id collisions with the sales category "Lead generation"
      const base = item(label);
      return { id: `cm-${base.id}`, label: base.label };
    }),
  },
  {
    id: 'assets-advantages',
    label: 'Assets & Advantages',
    items: [
      'Existing customer relationships',
      'Existing sales team',
      'Existing call center',
      'Existing software platform',
      'Proprietary data',
      'Industry licenses',
      'Carrier or supplier relationships',
      'Access to capital',
      'Geographic presence',
      'Offshore labor',
      'Existing audience',
      'Existing distribution channel',
      'Ability to launch nationally',
      'Ability to operate locally',
      'Ability to conduct high-volume outreach',
    ].map(item),
  },
];

const LABEL_BY_ID = new Map<string, string>();
for (const cat of CAPABILITY_CATEGORIES) {
  for (const it of cat.items) LABEL_BY_ID.set(it.id, it.label);
}

/**
 * Resolve a mixed list of capability ids and free-text custom entries into
 * human-readable labels for the research brief. Unknown ids are treated as
 * custom, user-entered capabilities and passed through verbatim.
 */
export function resolveCapabilityLabels(idsOrCustom: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of idsOrCustom) {
    const label = LABEL_BY_ID.get(raw) ?? raw.trim();
    if (!label) continue;
    const key = label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

export const ALL_CAPABILITY_IDS: string[] = Array.from(LABEL_BY_ID.keys());
