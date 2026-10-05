/**
 * The port is held to the v18 build's answers.
 *
 * golden.v18.json was produced by the minified engine inside
 * FEX_Quote_Engine_v18.html, not by this code. Every one of its 4,000
 * applicants must produce a byte-identical canonical result here. If a case
 * fails, the port is wrong -- do not regenerate the file to make it pass. When
 * the carrier data itself changes (a v19 bundle), golden files for the new
 * bundle come from a reviewed run and are added beside this one.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DrugIndex,
  quoteAll,
  type Applicant,
  type FexBundle,
  type QuoteOptions,
} from '../src/index.js';

import { canonicalJson, sha256 } from './canonical.js';

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = resolve(here, '../../../apps/api/assets/fex/fex-bundle.v18.json');
const bundleText = readFileSync(bundlePath, 'utf8');
const bundle = JSON.parse(bundleText) as FexBundle;
const golden = JSON.parse(readFileSync(resolve(here, 'golden.v18.json'), 'utf8')) as {
  bundleSha256: string;
  cases: Array<{
    seed: number;
    applicant: Applicant;
    options: QuoteOptions;
    sha256: string;
    top: Array<[string, string | null, string | null, number | null, number | null]>;
  }>;
};

describe('fex-engine v18', () => {
  it('reads the bundle the golden file was made from', () => {
    expect(sha256(readFileSync(bundlePath) as unknown as string)).toBe(golden.bundleSha256);
  });

  it('reproduces all 4,000 golden answers exactly', () => {
    const drugs = new DrugIndex(bundle);
    const failures: number[] = [];
    for (const c of golden.cases) {
      const results = quoteAll(bundle, structuredClone(c.applicant), c.options, drugs);
      if (sha256(canonicalJson(results)) !== c.sha256) failures.push(c.seed);
    }
    expect(failures).toEqual([]);
  });

  it('ranks the same top three as v18', () => {
    const drugs = new DrugIndex(bundle);
    for (const c of golden.cases.slice(0, 200)) {
      const top = quoteAll(bundle, structuredClone(c.applicant), c.options, drugs)
        .slice(0, 3)
        .map(r => [
          r.productId,
          r.outcome,
          r.best?.classCode ?? null,
          r.best?.face ?? null,
          r.best?.premium ?? null,
        ]);
      expect(top).toEqual(c.top);
    }
  });

  it('prices the Sons of Norway LegacySure Standard check point from the v18 patch report', () => {
    const base = {
      state: 'TX',
      tobacco: false,
      age: 60,
      face: 10000,
      mode: 'monthly',
      conditions: [],
      meds: [],
    } as const;
    const sons = (sex: 'M' | 'F') =>
      quoteAll(bundle, { ...base, sex, conditions: [], meds: [] }).find(
        r => r.productId === 'sons_of_norway_legacysure'
      );
    expect(sons('F')?.best?.premium).toBe(49.01);
    expect(sons('M')?.best?.premium).toBe(58.55);
  });

  it('agentText moves Rx notes out of the reason text (and a decline reason quoting one) and changes nothing else', () => {
    const drugs = new DrugIndex(bundle);
    let moved = 0;
    for (const c of golden.cases.slice(0, 400)) {
      const plain = quoteAll(bundle, structuredClone(c.applicant), c.options, drugs);
      const agent = quoteAll(
        bundle,
        structuredClone(c.applicant),
        { ...c.options, agentText: true },
        drugs
      );
      const blankRx = (rs: typeof plain) =>
        rs.map(r => ({
          ...r,
          ineligibleReason: undefined,
          reasons: r.reasons.map(x => (x.kind === 'rx' ? { ...x, text: '', note: undefined } : x)),
        }));
      expect(canonicalJson(blankRx(agent))).toBe(canonicalJson(blankRx(plain)));
      plain.forEach((r, i) => {
        if (r.ineligibleReason)
          expect(r.ineligibleReason.startsWith(agent[i].ineligibleReason ?? '')).toBe(true);
        r.reasons.forEach((x, j) => {
          if (x.kind !== 'rx') return;
          const y = agent[i].reasons[j];
          if (y.note) {
            moved++;
            expect(x.text).toBe(`${y.text} (${y.note})`);
          } else {
            expect(x.text).toBe(y.text);
          }
        });
      });
    }
    expect(moved).toBeGreaterThan(0);
  });

  it('resolves brand names and misspellings', () => {
    const drugs = new DrugIndex(bundle);
    expect(drugs.resolve('Eliquis')).toBe('apixaban');
    expect(drugs.search('metf', 5)[0]?.id).toBe('metformin');
  });
});
