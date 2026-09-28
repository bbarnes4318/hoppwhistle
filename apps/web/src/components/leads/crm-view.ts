/**
 * Which CRM list opens first.
 *
 * `?tab=` wins when it names a list: a link, a bookmark or the tab the owner
 * was last on (the page writes it back as they switch). Without one, the list
 * with something in it: an agency whose prospects have all become submitted
 * applications opens on Submitted Apps rather than on an empty Prospects list
 * with a pipeline full of business one click away. Until the counts are in,
 * Prospects.
 */

export type CrmView = 'prospects' | 'submitted';

export function isCrmView(value: unknown): value is CrmView {
  return value === 'prospects' || value === 'submitted';
}

export function defaultCrmView(
  requested: string | null | undefined,
  counts: { prospects: number; submittedApps: number } | null
): CrmView {
  if (isCrmView(requested)) return requested;
  if (counts && counts.prospects === 0 && counts.submittedApps > 0) return 'submitted';
  return 'prospects';
}
