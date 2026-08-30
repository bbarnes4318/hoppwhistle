/**
 * Fails if any enum value in apps/api/prisma/schema.prisma has no tone in
 * src/components/domain/status-tones.ts.
 *
 * StatusChip falls back to `neutral` for unknown values so it never throws in
 * production. That fallback is also how a new enum value would silently render
 * as grey forever. This check is what makes the fallback safe: add a value to
 * the schema without a tone and this goes red.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(here, '../../api/prisma/schema.prisma');
const tonesPath = resolve(here, '../src/components/domain/status-tones.ts');

const schema = readFileSync(schemaPath, 'utf8');
const tones = readFileSync(tonesPath, 'utf8');

// Parse enums out of the schema.
const enums = [];
for (const m of schema.matchAll(/^enum (\w+) \{([\s\S]*?)^\}/gm)) {
  const values = m[2]
    .split('\n')
    .map(l => l.split('//')[0].trim())
    .filter(l => l && !l.startsWith('@'));
  enums.push({ name: m[1], values });
}

// Parse the two tone layers out of the TS source. Deliberately textual: this
// runs without a build step, and the shapes it reads are plain object literals.
const defaultBlock = tones.match(/DEFAULT_TONE: Record<string, StatusTone> = \{([\s\S]*?)\n\};/);
if (!defaultBlock) {
  console.error('check-status-tones: could not find DEFAULT_TONE in status-tones.ts');
  process.exit(1);
}
const defaultNames = new Set(
  [...defaultBlock[1].matchAll(/^\s*([A-Z][A-Z0-9_]*):/gm)].map(m => m[1])
);

const enumBlock = tones.match(
  /ENUM_TONE: Record<string, Record<string, StatusTone>> = \{([\s\S]*?)\n\};/
);
const perEnum = new Map();
if (enumBlock) {
  for (const m of enumBlock[1].matchAll(/(\w+): \{([^}]*)\}/g)) {
    perEnum.set(m[1], new Set([...m[2].matchAll(/([A-Z][A-Z0-9_]*):/g)].map(x => x[1])));
  }
}

const missing = [];
let pairs = 0;
for (const e of enums) {
  for (const v of e.values) {
    pairs++;
    if (perEnum.get(e.name)?.has(v)) continue;
    if (defaultNames.has(v)) continue;
    missing.push(`${e.name}.${v}`);
  }
}

if (missing.length) {
  console.error(
    `check-status-tones: ${missing.length} enum value(s) have no tone.\n` +
      `Add them to DEFAULT_TONE (by value name) or ENUM_TONE (per enum) in\n` +
      `src/components/domain/status-tones.ts:\n\n  ${missing.join('\n  ')}\n`
  );
  process.exit(1);
}

console.log(
  `check-status-tones: ok — ${pairs} values across ${enums.length} enums all mapped ` +
    `(${defaultNames.size} by name, ${perEnum.size} enums with overrides).`
);
