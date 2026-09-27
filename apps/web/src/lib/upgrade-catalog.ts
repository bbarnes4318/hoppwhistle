/**
 * The upgrades catalog as the API answers it, and how a price reads.
 *
 * Shared by the agency's /upgrades page and the platform admin's price panel
 * on Admin -> Agencies, so the two say the same thing about the same price.
 */

/** One row of `GET /api/v1/upgrades`. */
export interface UpgradeCatalogRow {
  key: string;
  monthlyCents: number | null;
  setupCents: number | null;
  on: boolean;
  requestOpen: boolean;
}

/** One row of `GET /api/v1/admin/upgrade-prices`. */
export interface UpgradePriceRow {
  key: string;
  monthlyCents: number | null;
  setupCents: number | null;
}

/** One row of `GET /api/v1/admin/upgrade-requests`. */
export interface AdminUpgradeRequest {
  id: string;
  tenantId: string;
  tenantName: string;
  parentTenantId: string | null;
  upgradeKey: string;
  upgradeName: string;
  status: 'OPEN' | 'DONE' | 'DECLINED';
  userId: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** Whole dollars without cents ("$99"), otherwise to the cent ("$99.50"). */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** "$99/month · $250 setup", either half alone, or "Ask for pricing". */
export function upgradePriceLine(
  row: Pick<UpgradePriceRow, 'monthlyCents' | 'setupCents'>
): string {
  const parts: string[] = [];
  if (row.monthlyCents !== null) parts.push(`${formatCents(row.monthlyCents)}/month`);
  if (row.setupCents !== null) parts.push(`${formatCents(row.setupCents)} setup`);
  return parts.length > 0 ? parts.join(' · ') : 'Ask for pricing';
}

/**
 * A dollars input as cents: '' is null (no price), anything that is not a
 * non-negative amount with at most two decimals is undefined (invalid).
 */
export function centsFromDollars(input: string): number | null | undefined {
  const trimmed = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return undefined;
  return Math.round(Number(trimmed) * 100);
}

/** Cents as the dollars an input shows: 9900 -> '99', 9950 -> '99.50', null -> ''. */
export function dollarsFromCents(cents: number | null): string {
  if (cents === null) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}
