import { notFound } from 'next/navigation';

import { fixtureReport, FIXTURE_RUN_ID } from '@/features/industry-research/__fixtures__/fixture';

import { V2Preview } from './V2Preview';

/**
 * DEVELOPMENT-ONLY preview / comparison route for Report V2. Renders the current
 * report and Report V2 from the same real fixture so they can be compared side
 * by side. Blocked in production; not linked from any production UI; V2 is NOT
 * wired as the default report. Promotion requires explicit approval.
 */
export default function ReportV2PreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <V2Preview report={fixtureReport} runId={FIXTURE_RUN_ID} />;
}
