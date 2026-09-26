'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';

import { DeliveryView } from '@/components/delivery/delivery-view';
import { SettlementsView } from '@/components/delivery/settlements-view';
import { RatingView } from '@/components/rating/rating-view';

/**
 * Plan & Billing: what the agency pays, and how it is worked out.
 *
 * Three screens that were three sidebar entries -- Rate, Delivery and
 * Settlements -- stacked on one tab, each under its own heading and each the
 * same view its old URL renders. `?section=settlements` scrolls to the last,
 * which is where `/delivery/settlements` lands a white-label viewer.
 */
const SECTIONS = [
  { id: 'rate', title: 'Rate', render: () => <RatingView /> },
  { id: 'delivery', title: 'Delivery', render: () => <DeliveryView /> },
  { id: 'settlements', title: 'Settlements', render: () => <SettlementsView /> },
] as const;

export function PlanBillingView(): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col">
      <Suspense fallback={null}>
        <ScrollToSection />
      </Suspense>
      {SECTIONS.map(section => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-heading`}
          className="min-w-0 scroll-mt-4"
        >
          <h2
            id={`${section.id}-heading`}
            className="t-title px-4 pt-4 text-ink sm:px-6 sm:pt-6 min-[1440px]:px-8 min-[1440px]:pt-8"
          >
            {section.title}
          </h2>
          {section.render()}
        </section>
      ))}
    </div>
  );
}

/**
 * `?section=<id>` scrolls that section into view.
 *
 * Twice: once on mount, and once more after the sections above it have had a
 * moment to load, because each fills in from its own request and pushes the
 * target down as it does.
 */
function ScrollToSection(): null {
  const section = useSearchParams()?.get('section');
  useEffect(() => {
    if (!section) return;
    const scroll = () => document.getElementById(section)?.scrollIntoView?.({ block: 'start' });
    scroll();
    const again = window.setTimeout(scroll, 1200);
    return () => window.clearTimeout(again);
  }, [section]);
  return null;
}
