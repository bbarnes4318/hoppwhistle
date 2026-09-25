'use client';

import { useEffect } from 'react';

import { useBrand } from '@/hooks/use-brand';

/**
 * Applies the active agency brand to the document: `data-brand` on <html>, which
 * is what the palette blocks in globals.css answer to, and the favicon and
 * apple-touch-icon.
 *
 * Mounted by the authenticated shell only. The login page is never branded --
 * the tenant is unknown until somebody signs in -- and leaving the shell removes
 * everything this set, so a brand cannot outlive the session that was given it.
 * Switching to "All agencies" and signing out both reload the page, and the
 * next `/api/auth/me` answers with no brand, which removes it too.
 */
export function BrandThemeSync(): null {
  const { brand } = useBrand();
  const key = brand?.key ?? null;
  const favicon = brand?.favicon ?? null;
  const mark = brand?.mark ?? null;
  const appleTouchIcon = brand?.appleTouchIcon ?? null;

  useEffect(() => {
    const root = document.documentElement;
    if (!key) {
      root.removeAttribute('data-brand');
      return;
    }

    root.setAttribute('data-brand', key);
    const restoreIcons = swapIcons({ favicon, mark, appleTouchIcon });
    return () => {
      root.removeAttribute('data-brand');
      restoreIcons();
    };
  }, [key, favicon, mark, appleTouchIcon]);

  return null;
}

/**
 * Point the document's icon links at the brand's files, and return the undo.
 *
 * The links themselves are the ones the root layout's metadata rendered; they
 * are re-pointed rather than supplemented, because which of two competing
 * icons a browser picks is not something to leave to chance.
 */
function swapIcons(icons: {
  favicon: string | null;
  mark: string | null;
  appleTouchIcon: string | null;
}): () => void {
  const changed: { link: HTMLLinkElement; href: string }[] = [];
  const links = document.head.querySelectorAll<HTMLLinkElement>(
    'link[rel~="icon"], link[rel="apple-touch-icon"]'
  );

  links.forEach(link => {
    // The large icon slot gets the 512px mark, not the 32px favicon scaled up.
    const next =
      link.rel === 'apple-touch-icon'
        ? icons.appleTouchIcon
        : link.getAttribute('sizes') === '512x512'
          ? icons.mark
          : icons.favicon;
    if (!next) return;
    changed.push({ link, href: link.getAttribute('href') ?? '' });
    link.setAttribute('href', next);
  });

  return () => {
    for (const { link, href } of changed) link.setAttribute('href', href);
  };
}
