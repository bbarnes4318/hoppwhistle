/**
 * @hopwhistle/route-scoring — adaptive route scoring (Phase 5).
 *
 * Pure TypeScript. No I/O anywhere in this package: no network, no filesystem,
 * no database, no `Date.now()`, no `Math.random()`. It runs and tests on a
 * Windows dev checkout with no Asterisk, no Redis and no carrier.
 *
 * The seam to the `voip` repo is deliberately a FILE, not a call path. This
 * package produces a `RouteDecision`; the deployment step (§4.2, not built here)
 * renders it to `routes.csv` and `routectl.sh` loads that into astdb. Keeping
 * the SBC isolated from this monorepo is the point of the split, and nothing
 * here changes it.
 */

export {
  ASR_FLOOR,
  SAFETY_Z,
  createRng,
  deriveCellPosterior,
  lowerBoundAsr,
  posteriorSd,
  resolveConfidence,
  sampleAsr,
  upperBoundAsr,
  weakestConfidence,
  type CellPosterior,
} from './estimator.js';

export { estimateCell, ingest, scoreRoutes, type CellEstimate } from './scorer.js';

export {
  DEFAULT_ROUTE_SCORING_POLICY,
  ROUTE_REASON_TEXT,
  RouteReason,
  type Confidence,
  type DidSelectionReason,
  type RetryStats,
  type RouteConfig,
  type RouteDecision,
  type RouteObservation,
  type RoutePrefixDiff,
  type RouteScoreDetail,
  type RouteScoringInputs,
  type RouteScoringPolicy,
  type RouteTableDiff,
} from './types.js';

export {
  defaultRouteSimConfig,
  runRouteSimulation,
  truthKey,
  type RouteSimConfig,
  type RouteSimLead,
  type RouteSimNightRecord,
  type RouteSimResult,
} from './sim/simulator.js';
