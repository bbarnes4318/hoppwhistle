/**
 * The one thing that lets somebody out of the call centre.
 *
 * ── The loop this exists to break ─────────────────────────────────────────
 *
 * `/call-center` renders fullscreen: no sidebar, no topbar, one "Exit console"
 * button in its header. That button went to /dashboard, and /dashboard sends
 * anybody holding AGENT and nothing else straight back to /call-center. Two
 * correct-looking redirects, pointed at each other, and the person in the
 * middle could not reach any other page in the application. An owner whose
 * account had been given an AGENT role for testing signed in and could not get
 * off the call centre at all -- every route they tried landed back on it.
 *
 * The default routing is still right: an agent signing in belongs in the
 * console, not on the tenant-wide dashboard. What was wrong is that a DEFAULT
 * was being enforced against an EXPLICIT request. Clicking "Exit console" is a
 * person saying where they want to be, and it outranks the default for the rest
 * of that browser tab's life.
 *
 * `sessionStorage` rather than a query parameter, because the marker has to
 * survive the next navigation too: leaving the console for /dashboard and then
 * clicking through to /leads must not re-arm the bounce. It is per tab, so
 * opening the app fresh puts an agent back in the console as before, and it
 * carries no authority -- the API still authorises every request this page
 * makes. It only stops the browser dragging somebody back to a page they just
 * asked to leave.
 */

const KEY = 'hopwhistle:left-console';

/** Remember that this person asked to leave the console. */
export function markConsoleExit(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    // Private mode, or storage disabled. The exit still navigates; the worst
    // case is the old behaviour, and the escape hatch below still works.
  }
}

/** Whether they did. */
export function hasLeftConsole(): boolean {
  try {
    return sessionStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Signing out, or entering the console on purpose, clears it. */
export function clearConsoleExit(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing stored, nothing to clear.
  }
}
