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

/**
 * What the page's bar shows: four workspace sections, then the principal's
 * two quieter ones. The two lookups are one section, Underwriting -- each is
 * still its own tab and its own URL (`?tab=conditions`, `?tab=drugs`), so a
 * bookmark or a shared link opens the same lookup it always did.
 */
export const QUOTE_SECTIONS = [
  { key: 'quote', label: 'Quote', tabs: ['quote'], secondary: false },
  { key: 'history', label: 'History', tabs: ['history'], secondary: false },
  { key: 'underwriting', label: 'Underwriting', tabs: ['conditions', 'drugs'], secondary: false },
  { key: 'carriers', label: 'Carriers', tabs: ['carriers'], secondary: false },
  { key: 'insights', label: 'Insights', tabs: ['insights'], secondary: true },
  { key: 'settings', label: 'Settings', tabs: ['settings'], secondary: true },
] as const satisfies ReadonlyArray<{
  key: string;
  label: string;
  tabs: ReadonlyArray<QuoteTabKey>;
  secondary: boolean;
}>;

export type QuoteSection = (typeof QUOTE_SECTIONS)[number];
export type QuoteSectionKey = QuoteSection['key'];

/** The sections this person may open: those with at least one tab they may. */
export function quoteSectionsFor(principal: boolean): ReadonlyArray<QuoteSection> {
  const allowed = new Set<QuoteTabKey>(quoteTabsFor(principal).map(t => t.key));
  return QUOTE_SECTIONS.filter(section =>
    section.tabs.some(tab => allowed.has(tab as QuoteTabKey))
  );
}

/** The section a tab belongs to. */
export function sectionOf(tab: QuoteTabKey): QuoteSectionKey {
  return (
    QUOTE_SECTIONS.find(section => (section.tabs as ReadonlyArray<string>).includes(tab))?.key ??
    'quote'
  );
}
