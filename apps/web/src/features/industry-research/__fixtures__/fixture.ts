import type { StructuredReport } from '@hopwhistle/shared';

import type { ReportResponse, ReportVerification } from '../api';

import structuredJson from './report-d8253e89.json';
import verificationJson from './verification-d8253e89.json';

/**
 * DEVELOPMENT FIXTURE — a real completed report (run d8253e89, "Residential
 * gutter cleaning, Austin TX", Full Due Diligence) pulled read-only from the
 * production database. Used ONLY by the dev-only `_v2-preview` route so Report V2
 * can be reviewed against real data without a live backend. Not imported by any
 * production code path.
 */
const structured = structuredJson as unknown as StructuredReport;

export const FIXTURE_RUN_ID = structured.reportMetadata.researchRunId;

export const fixtureReport: ReportResponse = {
  version: 1,
  verdict: structured.executiveVerdict.verdict,
  overallScore: structured.executiveVerdict.overallScore,
  markdown: '',
  structured,
  evidence: structured.evidenceLedger,
  sources: structured.sources,
  verification: verificationJson as unknown as ReportVerification,
  synthesisProvider: structured.reportMetadata.synthesisProvider,
  synthesisModel: structured.reportMetadata.synthesisModel,
  createdAt: structured.reportMetadata.generatedAt,
};
