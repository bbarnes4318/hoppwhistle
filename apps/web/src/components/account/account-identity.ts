/**
 * The small, pure facts the Account page renders about a login: what to call
 * its role, its initials, how it signs in, which device this session is on, and
 * how strong a password someone is typing. Kept out of the components so each
 * one is tested on its own (`__tests__/account-identity.test.ts`).
 */

const ROLE_LABELS: Record<string, string> = {
  OWNER: 'Owner',
  ADMIN: 'Administrator',
  AGENT: 'Agent',
  BUYER: 'Buyer',
  PUBLISHER: 'Publisher',
  ANALYST: 'Analyst',
  READONLY: 'Read-only',
  SUPPORT: 'Support',
};

/** The order roles are listed in: the most senior first. */
const ROLE_ORDER = ['OWNER', 'ADMIN', 'AGENT', 'PUBLISHER', 'BUYER', 'ANALYST', 'SUPPORT'];

export function roleLabel(role: string): string {
  const key = role.toUpperCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  const words = key.toLowerCase().split('_').filter(Boolean).join(' ');
  return words ? words[0].toUpperCase() + words.slice(1) : role;
}

/** Each role once, most senior first, as labels. */
export function roleLabels(roles: readonly string[] | null | undefined): string[] {
  const unique = Array.from(new Set((roles ?? []).map(role => role.toUpperCase())));
  const rank = (role: string) => {
    const at = ROLE_ORDER.indexOf(role);
    return at === -1 ? ROLE_ORDER.length : at;
  };
  return unique.sort((a, b) => rank(a) - rank(b)).map(roleLabel);
}

export function initialsFor(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string | null | undefined
): string {
  const fromName = [firstName, lastName]
    .map(part => part?.trim()?.[0]?.toUpperCase())
    .filter(Boolean)
    .join('');
  return fromName || email?.trim()?.[0]?.toUpperCase() || '?';
}

export function signInMethodLabel(
  authMethod: string | null | undefined,
  hasPassword: boolean
): string {
  if (authMethod === 'GOOGLE') return hasPassword ? 'Google, or email and password' : 'Google';
  return 'Email and password';
}

export interface DeviceDescription {
  browser: string;
  os: string;
  mobile: boolean;
}

/** "Chrome on macOS", read from a user-agent string. Unknowns say so. */
export function describeDevice(userAgent: string | null | undefined): DeviceDescription {
  const ua = userAgent ?? '';

  // Order matters: Edge and Opera both say "Chrome", and Chrome says "Safari".
  let browser = 'Unknown browser';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/Firefox\/|FxiOS\//.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';

  let os = 'Unknown OS';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux/.test(ua)) os = 'Linux';

  return { browser, os, mobile: /Mobi|iPhone|Android/.test(ua) };
}

export type PasswordStrength = 0 | 1 | 2 | 3 | 4;

export const PASSWORD_STRENGTH_LABELS: Record<PasswordStrength, string> = {
  0: 'Too short',
  1: 'Weak',
  2: 'Fair',
  3: 'Good',
  4: 'Strong',
};

/**
 * A rough guide while typing, not a policy: the API's only rule is the minimum
 * length. Under the minimum is always 0; past it, length and variety of
 * character classes earn the rest.
 */
export function passwordStrength(password: string, minLength: number): PasswordStrength {
  if (password.length < minLength) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter(re => re.test(password)).length;
  let score = 1;
  if (classes >= 2) score += 1;
  if (classes >= 3 && password.length >= minLength + 2) score += 1;
  if (password.length >= 16 && classes >= 3) score += 1;
  else if (password.length >= 20) score += 1;
  return Math.min(4, score) as PasswordStrength;
}

/** "March 4, 2025", or null for a missing or malformed timestamp. */
export function formatLongDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** "Oct 11, 2026, 3:42 PM", or null for a missing or malformed timestamp. */
export function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return at.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
