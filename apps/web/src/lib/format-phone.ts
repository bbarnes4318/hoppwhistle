/**
 * The one display formatter for a phone number, everywhere in the product.
 *
 * NANP numbers render as (415) 555-0142 whether they were stored as
 * +14155550142, 14155550142 or 4155550142 — the portal is US-only, so the
 * "+1 " prefix is noise on every row. A number in another plan keeps its
 * country code and is grouped from the right so it stays scannable. Anything
 * that is not a phone number at all (a SIP URI, "anonymous") renders verbatim.
 *
 * Display only. The clipboard, the dialer and the API always get the stored
 * E.164 value, never this.
 */
export function formatPhone(raw: string | null | undefined): string {
  if (raw == null) return '';
  const trimmed = raw.trim();
  if (!trimmed) return '';
  // Only digits and the usual punctuation count as a phone number.
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return trimmed;

  const international = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  if (digits.length === 11 && digits.startsWith('1')) {
    const n = digits.slice(1);
    return `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (!international) return trimmed;

  // Unknown plan: group from the right in 3s so it stays scannable.
  const groups: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  return `+${groups.join(' ')}`;
}
