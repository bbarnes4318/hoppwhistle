'use client';

import { AlertTriangle } from 'lucide-react';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

/**
 * Contain a render failure to the part of the page that failed.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The agency switcher read one field off a response under the wrong key, got an
 * object where it expected an array, and called `.map` on it. React has one
 * response to an uncaught error during render: unmount the whole tree from the
 * root. The switcher lives in the topbar, inside the dashboard layout, so the
 * layout went with it — every platform admin got "Application error: a
 * client-side exception has occurred" on a blank page and could not reach any
 * agency at all.
 *
 * That is the same failure mode as the Phase 1b login loop in a different
 * place: one narrow defect that removes every route out of itself. The
 * defect gets fixed; the blast radius is what this file is for.
 *
 * ── Why not Next's `error.tsx` ───────────────────────────────────────────────
 *
 * A route segment's `error.tsx` catches errors thrown by that segment's
 * children. It does NOT catch errors thrown by the layout itself, and the
 * switcher is part of the layout's chrome. An `error.tsx` under `(dashboard)`
 * would not have caught this crash. Containing a failure in the chrome takes a
 * real boundary, placed around the chrome.
 *
 * ── What it does not do ──────────────────────────────────────────────────────
 *
 * It does not retry, and it does not hide the failure. A boundary that silently
 * rendered nothing would have turned this crash into a switcher that quietly
 * stopped appearing, which is harder to notice and no easier to diagnose. It
 * says something is broken, in place, and leaves everything around it working.
 */

interface Props {
  children: ReactNode;
  /**
   * What failed, in the user's terms — "The agency switcher", "This page".
   * Used in the message, so it should name the thing they can see.
   */
  label: string;
  /**
   * Rendered instead of the default message. For chrome, where a full alert
   * block would not fit and would push the layout around.
   */
  fallback?: (error: Error) => ReactNode;
  /**
   * Changing this clears the error and re-renders the children. Pass the
   * pathname so navigating away from a broken page is a way out of it.
   */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: Props): void {
    // Navigating is the escape hatch: a boundary that stayed tripped would
    // leave somebody stuck on the message with no way back.
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    /*
     * Logged, not swallowed. Without this the only trace of a contained failure
     * is a message somebody has to screenshot, and the minified stack in the
     * original report ("at ew (layout-384525777f2d0156.js)") was the only clue
     * anybody had.
     */
    // eslint-disable-next-line no-console
    console.error(`[${this.props.label}] render failed`, error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) return this.props.fallback(error);

    return (
      <div
        role="alert"
        className="m-4 flex items-start gap-2 rounded border border-destructive/40 bg-destructive/10 p-3 text-sm"
      >
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div>
          <p className="font-medium">{this.props.label} could not be displayed.</p>
          <p className="text-muted-foreground">
            The rest of the page is unaffected. Please reload, and let NetEnroll know if it
            keeps happening.
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{error.message}</p>
        </div>
      </div>
    );
  }
}
