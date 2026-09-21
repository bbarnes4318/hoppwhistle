/**
 * Which columns the call ledger shows, merging a stored choice over today's
 * defaults.
 *
 * ── The bug this exists to prevent ───────────────────────────────────────────
 *
 * The ledger persists its column checkboxes in `localStorage` and used to read
 * them back as the whole answer:
 *
 *     const stored = localStorage.getItem(KEY);
 *     if (stored) return JSON.parse(stored);
 *
 * A column added later is absent from every returning user's stored copy, so
 * it reads as `undefined`, so it renders as hidden. Not hidden by their choice
 * -- hidden permanently, for everyone who had ever opened the page, with
 * nothing on screen to say it exists. Every column shipped that way was
 * invisible to exactly the people who use the screen most, and visible only to
 * somebody opening it for the first time.
 *
 * Merging fixes it in the only direction that is safe: a key the user has an
 * opinion about keeps their opinion, a key they have never seen takes its
 * default.
 *
 * ── It is deliberately forgiving about what comes back ───────────────────────
 *
 * `localStorage` is shared across every tab and survives every deploy, so the
 * stored value can be a string from an older build, `null`, an array, or
 * nothing at all. None of those is a reason to render a table with no columns:
 * anything that is not a usable object falls back to the defaults whole.
 */
export function resolveVisibleColumns(
  stored: string | null,
  defaults: Record<string, boolean>
): Record<string, boolean> {
  if (!stored) return { ...defaults };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return { ...defaults };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ...defaults };
  }

  /*
   * Only booleans are taken from the stored object. A key holding a string or
   * a number is a value from some other build of this screen, and letting it
   * through would put a truthy non-boolean into a `visibleColumns[x] &&` test
   * -- which renders, but is no longer a choice anybody made.
   */
  const merged: Record<string, boolean> = { ...defaults };
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'boolean') merged[key] = value;
  }
  return merged;
}
