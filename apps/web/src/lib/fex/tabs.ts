/** The Quote page's tabs, and which ones an agent may open. */

export const QUOTE_TABS = [
  { key: 'quote', label: 'Quote', principal: false },
  { key: 'history', label: 'History', principal: false },
  { key: 'conditions', label: 'Condition lookup', principal: false },
  { key: 'drugs', label: 'Drug lookup', principal: false },
  { key: 'carriers', label: 'Carriers', principal: false },
  { key: 'insights', label: 'Insights', principal: true },
  { key: 'settings', label: 'Settings', principal: true },
] as const;

export type QuoteTabKey = (typeof QUOTE_TABS)[number]['key'];

/** The tabs this person may open. */
export function quoteTabsFor(principal: boolean): ReadonlyArray<(typeof QUOTE_TABS)[number]> {
  return QUOTE_TABS.filter(tab => principal || !tab.principal);
}
