'use client';

import { useMemo } from 'react';

import { useAuth } from './use-auth';

/**
 * "This session cannot change anything", for a save, submit or delete control.
 *
 * ── What this is, and what it is not ─────────────────────────────────────────
 *
 * A platform operator previewing an agency as OWNER or AGENT is refused every
 * non-GET request by a global hook on the API — see
 * `apps/api/src/middleware/read-only-preview.ts`. That hook is the guarantee and
 * it is not negotiable from here.
 *
 * This is the other half: so the operator learns it from the UI rather than from
 * a 403 after filling in a form. An enabled Save button that cannot save is a
 * screen lying about what will happen.
 *
 * So: this is advisory, it is about honesty rather than access, and a control
 * that forgets to use it is a worse experience and not a security hole.
 *
 * ── How to use it ────────────────────────────────────────────────────────────
 *
 *     const { readOnly, disabledProps } = useReadOnlyPreview();
 *     <Button {...disabledProps} onClick={save}>Save</Button>
 *
 * `disabledProps` is empty when no preview is active, so spreading it is a
 * no-op for every ordinary user and the control keeps whatever `disabled` it
 * already had. When a preview IS active it carries `disabled`, `aria-disabled`
 * and a `title` saying why — a tooltip rather than a new line of layout, because
 * the full-width banner under the top bar is already saying it loudly and a
 * third copy beside every button would be noise.
 */
export const READ_ONLY_PREVIEW_REASON =
  'This session is a read-only role preview. Leave the preview to make changes in this agency.';

export interface ReadOnlyPreview {
  /** True while this session is a read-only role preview. */
  readOnly: boolean;
  /** Spread onto a save, submit or delete control. Empty when not previewing. */
  disabledProps: { disabled?: true; 'aria-disabled'?: true; title?: string };
}

export function useReadOnlyPreview(): ReadOnlyPreview {
  const { isReadOnlyPreview } = useAuth();

  return useMemo(
    () => ({
      readOnly: isReadOnlyPreview,
      disabledProps: isReadOnlyPreview
        ? { disabled: true, 'aria-disabled': true, title: READ_ONLY_PREVIEW_REASON }
        : {},
    }),
    [isReadOnlyPreview]
  );
}
