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
 * it works without script and a link to `/account#security` lands there.
 * Below `lg` the sections simply stack, and the list is not rendered.
 */
export function AccountSectionNav({ sections }: { sections: AccountSectionLink[] }): JSX.Element {
  const [active, setActive] = React.useState(sections[0]?.id ?? '');

  React.useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const visible = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) visible.set(entry.target.id, entry.isIntersecting);
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
    return () => observer.disconnect();
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
                  const el = document.getElementById(section.id);
                  if (!el) return;
                  event.preventDefault();
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  window.history.replaceState(null, '', `#${section.id}`);
                  setActive(section.id);
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
