/**
 * The final expense carrier data, loaded once per API process.
 *
 * ── Server-side only, deliberately ───────────────────────────────────────────
 *
 * The bundle holds every carrier's rate tables, underwriting-guide rules and
 * prescription lists. That dataset is the product: shipping it to every
 * signed-in browser would hand it to anyone with a login. So the engine runs
 * here, the browser asks `/api/v1/fex/*` and gets back results, and nothing in
 * this file's output is ever serialised whole.
 *
 * ── Where the file is ────────────────────────────────────────────────────────
 *
 * `apps/api/assets/fex/<FEX_BUNDLE_FILE>`, resolved the same way the agreement
 * assets are (`services/agreements/assets.ts`): beside dist/ in the runner
 * image, which copies `apps/api/assets` to `/app/assets`, and from the source
 * tree under tsx and vitest.
 *
 * ── A new data build ─────────────────────────────────────────────────────────
 *
 * Ships as a new file beside this one (`fex-bundle.v19.json`), with its own
 * golden file in packages/fex-engine. Bump the two constants below. A saved
 * quote records `engineVersion` and `bundleSha256`, so it always says which
 * data it was made with.
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { DrugIndex, type Condition, type FexBundle, type Product } from '@hopwhistle/fex-engine';

export const FEX_BUNDLE_FILE = 'fex-bundle.v18.json';
export const FEX_ENGINE_VERSION = 'v18';

export interface FexEngine {
  bundle: FexBundle;
  drugs: DrugIndex;
  version: string;
  /** sha256 of the file's bytes, hex. */
  bundleSha256: string;
  conditionsByCode: Map<string, Condition>;
  productsById: Map<string, Product>;
}

function assetDirs(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  return [
    // dist/index.js in the runner image: /app/dist -> /app/assets/fex
    resolve(here, '../assets/fex'),
    // src/services/fex/*.ts under tsx or vitest
    resolve(here, '../../../assets/fex'),
    join(process.cwd(), 'assets/fex'),
    join(process.cwd(), 'apps/api/assets/fex'),
  ];
}

function findBundle(name: string): string {
  for (const dir of assetDirs()) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`FEX data bundle ${name} not found (looked in ${assetDirs().join(', ')})`);
}

let cached: FexEngine | null = null;

/**
 * The engine's data, parsed and indexed. The first call reads ~2.8 MB and
 * builds the drug index; every later call returns the same object.
 */
export function getFexEngine(): FexEngine {
  if (cached) return cached;

  const path = findBundle(FEX_BUNDLE_FILE);
  const bytes = readFileSync(path);
  const bundle = JSON.parse(bytes.toString('utf8')) as FexBundle;
  if (!Array.isArray(bundle.products) || !Array.isArray(bundle.conditions) || !bundle.tables) {
    throw new Error(`FEX data bundle ${path} is not a bundle (products/conditions/tables missing)`);
  }

  cached = {
    bundle,
    drugs: new DrugIndex(bundle),
    version: FEX_ENGINE_VERSION,
    bundleSha256: createHash('sha256').update(bytes).digest('hex'),
    conditionsByCode: new Map(bundle.conditions.map(c => [c.code, c])),
    productsById: new Map(bundle.products.map(p => [p.id, p])),
  };
  return cached;
}

/** Read the bundle at startup so a missing or corrupt file fails the boot, not a quote. */
export function preloadFexEngine(): FexEngine {
  return getFexEngine();
}
