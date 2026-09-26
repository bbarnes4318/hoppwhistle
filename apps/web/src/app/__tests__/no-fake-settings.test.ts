import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Settings used to show a made-up API key ("Production Key", `cf_live_****1234`,
 * with a Generate Key button that did nothing) and a made-up DNC list ("Global
 * DNC", 1,234 entries). An agency read both as its own. They are gone; this
 * keeps them from coming back anywhere in the web app.
 */
const SRC = join(__dirname, '..', '..');
const FAKES = ['Production Key', 'Global DNC', 'cf_live_'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === '__tests__' || name === 'node_modules' ? [] : sourceFiles(path);
    }
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

describe('the web app shows no fake settings data', () => {
  const files = sourceFiles(SRC);

  it('reads the source tree', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(FAKES)('never says "%s"', fake => {
    const hits = files.filter(file => readFileSync(file, 'utf8').includes(fake));
    expect(hits).toEqual([]);
  });
});
