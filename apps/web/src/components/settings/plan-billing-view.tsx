'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { DeliveryView } from '@/components/delivery/delivery-view';
import { SettlementsView } from '@/components/delivery/settlements-view';
import { Notice } from '@/components/domain';
import { RatingView } from '@/components/rating/rating-view';
import { useBrand } from '@/hooks/use-brand';
import { apiClient, payload, type Envelope } from '@/lib/api';

/**
 * Plan & Billing: what the agency pays, and how it is worked out.
 *
 * Three screens that were three sidebar entries -- Rate, Delivery and
 * Settlements -- stacked on one tab, each under its own heading and each the
 * same view its old URL renders. `?section=settlements` scrolls to the last,
 * which is where `/delivery/settlements` lands a white-label viewer.
 *
 * Only for an agency enrolled in per-application billing
 * (`AgencyBillingProfile.billingEnrolledAt`, read as `enrolled` off
 * `/api/v1/delivery/mandate`). One that is not has no rate, no block and no
 * settlements -- three sections of zeros -- so it gets one line saying where
 * its money is instead.
 */
const SECTIONS = [
  { id: 'rate', title: 'Rate', render: () => <RatingView /> },
  { id: 'delivery', title: 'Delivery', render: () => <DeliveryView /> },
  { id: 'settlements', title: 'Settlements', render: () => <SettlementsView /> },
] as const;

export function PlanBillingView(): JSX.Element | null {
  const { productName } = useBrand();
  const enrolled = useEnrolment();

  // Nothing until the answer is in: three sections flashing up and vanishing
  // would be worse than a moment of blank.
  if (enrolled === 'loading') return null;

  if (enrolled === false) {
    return (
      <div className="page-canvas">
        <Notice tone="info" data-testid="plan-not-enrolled">
          {productName} isn&apos;t billed per application. Your number charges and statements are
          under Revenue → Statements.
        </Notice>
      </div>
    );
  }

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
 * Whether the agency is enrolled in per-application billing.
 *
 * A failed read answers true: the sections then render as they always have,
 * each with its own error state, rather than telling an enrolled agency it is
 * not billed.
 */
function useEnrolment(): boolean | 'loading' {
  const [enrolled, setEnrolled] = useState<boolean | 'loading'>('loading');
  useEffect(() => {
    let live = true;
    void apiClient
      .get<Envelope<{ enrolled?: boolean }>>('/api/v1/delivery/mandate')
      .then(response => {
        if (live) setEnrolled(payload(response)?.enrolled !== false);
      })
      .catch(() => {
        if (live) setEnrolled(true);
      });
    return () => {
      live = false;
    };
  }, []);
  return enrolled;
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
