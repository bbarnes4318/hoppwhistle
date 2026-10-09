'use client';

import { ProductFeedbackConsole } from '@/components/feedback/staff/product-feedback-console';

/**
 * Admin -> Product feedback: the product team's side of Feedback & Roadmap.
 * A staff-only route (`lib/staff-only-routes.ts`); the API behind it is
 * `requirePlatformAdmin` whoever asks.
 */
export default function ProductFeedbackAdminPage(): JSX.Element {
  return <ProductFeedbackConsole />;
}
