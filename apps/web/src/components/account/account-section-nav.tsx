'use client';

import * as React from 'react';

import { cn } from '@/lib/utils';

export interface AccountSectionLink {
  id: string;
  label: string;
  icon: React.ElementType;
}

/**
 * The Account page's own table of contents: a sticky list at the left from
 * `lg`, highlighting the section in view. Each entry is an in-page anchor, so
 * a link to `/account#security` lands there.
 * Below `lg` the sections simply stack, and the list is not rendered.
 */
/** How far below the scroll area's top edge a section lands. */
const SECTION_OFFSET_PX = 24;

/** The nearest ancestor that actually scrolls: the dashboard's <main>. */
function scrollParentOf(el: HTMLElement): HTMLElement | null {
  for (let node = el.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
  }
  return null;
}

/*
 * ── Why not `scrollIntoView` or a plain anchor jump ──────────────────────────
 *
 * The dashboard shell is a stack of `overflow-hidden` boxes around a scrolling
 * <main>, and both of those scroll EVERY ancestor needed to bring the target to
 * the top -- `overflow: hidden` included. The last section is too short to
 * reach the top of <main>, so the browser made up the difference by scrolling
 * the shell itself, which slid the topbar and the sidebar out of the window
 * with no scrollbar to bring them back. So only the real scroller is moved.
 */
function scrollToSection(id: string, behavior: ScrollBehavior): void {
  const el = document.getElementById(id);
  if (!el) return;
  const scroller = scrollParentOf(el);
  if (!scroller) {
    window.scrollTo({
      top: el.getBoundingClientRect().top + window.scrollY - SECTION_OFFSET_PX,
      behavior,
    });
    return;
  }
  const top =
    el.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop -
    SECTION_OFFSET_PX;
  scroller.scrollTo({ top: Math.max(0, top), behavior });
}

export function AccountSectionNav({ sections }: { sections: AccountSectionLink[] }): JSX.Element {
  const [active, setActive] = React.useState(sections[0]?.id ?? '');
  // After a click, the clicked entry stays lit while the scroll settles, even
  // when its section is too short to reach the reading band.
  const pinnedUntil = React.useRef(0);

  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
        if (Date.now() < pinnedUntil.current) return;
        // The first section, in page order, whose top is in the reading band.
        const first = sections.find(section => visible.get(section.id));
        if (first) setActive(first.id);
      },
      { rootMargin: '-15% 0px -65% 0px' }
    );
    for (const section of sections) {
      const el = document.getElementById(section.id);
      if (el) observer.observe(el);
    }

    // Scrolled to the very end: the last section is the one being read, though
    // it can never climb into the band above.
    const firstEl = sections[0] ? document.getElementById(sections[0].id) : null;
    const scroller = firstEl ? scrollParentOf(firstEl) : null;
    const onScroll = () => {
      if (!scroller || Date.now() < pinnedUntil.current) return;
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        const last = sections[sections.length - 1];
        if (last) setActive(last.id);
      }
    };
    scroller?.addEventListener('scroll', onScroll, { passive: true });

    // Opened as /account#security: go there, without moving the shell.
    const hash = window.location.hash.slice(1);
    if (hash && sections.some(section => section.id === hash)) {
      setActive(hash);
      pinnedUntil.current = Date.now() + 1000;
      scrollToSection(hash, 'auto');
    }

    return () => {
      observer.disconnect();
      scroller?.removeEventListener('scroll', onScroll);
    };
  }, [sections]);

  return (
    <nav aria-label="Account sections" className="hidden lg:block">
      <ul className="sticky top-6 grid gap-0.5">
        {sections.map(section => {
          const current = section.id === active;
          return (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                onClick={event => {
                  event.preventDefault();
                  pinnedUntil.current = Date.now() + 1000;
                  setActive(section.id);
                  scrollToSection(section.id, 'smooth');
                  window.history.replaceState(null, '', `#${section.id}`);
                }}
                aria-current={current ? 'location' : undefined}
                className={cn(
                  'relative flex h-9 items-center gap-2.5 rounded-control px-3 text-sm',
                  'transition-colors duration-150 ease-out',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  current
                    ? 'bg-brand-tint font-medium text-brand-ink'
                    : 'text-ink-2 hover:bg-sunken hover:text-ink'
                )}
              >
                <section.icon aria-hidden className="h-4 w-4 shrink-0" />
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
