'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * ThemeScope — makes a `data-theme` subtree work for portalled content too.
 *
 * The tokens in globals.css are CSS custom properties, so they inherit down the
 * DOM. That works for everything rendered inside the scope — and silently fails
 * for anything Radix portals to document.body: drawers, dialogs, select menus,
 * popovers, the command palette. A portal is a DOM sibling of the scope, not a
 * descendant, so it inherits from <html> instead.
 *
 * Today that shows up as a dark drawer opening over a light page. After prompt 3
 * removes <html class="dark"> it inverts and gets worse: on the admin live
 * board — the one dark screen, themed with data-theme="dark" — every dropdown
 * and drawer would render light over it.
 *
 * So the theme is carried in context as well as in the attribute, and portalled
 * components stamp `data-theme` on their own content. Any new component that
 * portals must do the same; `useThemeScope()` is how.
 */

type Theme = 'light' | 'dark';

const ThemeScopeContext = React.createContext<Theme | undefined>(undefined);

/**
 * The theme of the nearest enclosing ThemeScope, or undefined at the top level
 * (where the document's own theme already applies and no stamp is needed).
 */
export function useThemeScope(): Theme | undefined {
  return React.useContext(ThemeScopeContext);
}

export interface ThemeScopeProps extends React.HTMLAttributes<HTMLDivElement> {
  theme: Theme;
  /** Render as a bare provider with no wrapper element. */
  asChild?: boolean;
}

export function ThemeScope({
  theme,
  asChild = false,
  className,
  children,
  ...props
}: ThemeScopeProps) {
  if (asChild) {
    return <ThemeScopeContext.Provider value={theme}>{children}</ThemeScopeContext.Provider>;
  }
  return (
    <ThemeScopeContext.Provider value={theme}>
      <div data-theme={theme} className={cn('bg-paper text-ink', className)} {...props}>
        {children}
      </div>
    </ThemeScopeContext.Provider>
  );
}
