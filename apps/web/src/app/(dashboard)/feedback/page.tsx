'use client';

import { FeedbackRoadmap } from '@/components/feedback/feedback-roadmap';

/**
 * Feedback & Roadmap: send the product team an idea or a problem, and follow
 * it from review to release. Every agency role that works the product has it;
 * the API decides who may read what (`routes/product-feedback.ts`).
 */
export default function FeedbackPage(): JSX.Element {
  return <FeedbackRoadmap />;
}
