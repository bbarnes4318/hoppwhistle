import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const campaignPagePath = resolve(
  process.argv[2] || 'apps/web/src/app/(dashboard)/campaigns/[id]/page.tsx'
);

let source = readFileSync(campaignPagePath, 'utf8');

const replacements = [
  {
    label: 'destination table heading',
    marker: '<TableHead>Cell / Hopwhistle Extension</TableHead>',
    pattern: /<TableHead>Destination DID<\/TableHead>/,
    replacement: '<TableHead>Cell / Hopwhistle Extension</TableHead>',
  },
  {
    label: 'campaign routing description',
    marker: 'one external buyer selected by weight',
    pattern:
      /Configure buyer target numbers and destination routing rules\.\s*Priority controls routing order \(lower = higher priority\)\./,
    replacement:
      'Route one campaign DID to external buyer cell phones and internal Hopwhistle extensions. At each priority, all eligible internal extensions ring together with one external buyer selected by weight; lower priorities are sequential failover steps.',
  },
  {
    label: 'destination field label',
    marker: '<Label htmlFor="buyer-dest">Cell Number or Hopwhistle Extension *</Label>',
    pattern:
      /<Label htmlFor="buyer-dest">Destination Phone Number \(E\.164 Format\) \*<\/Label>/,
    replacement: '<Label htmlFor="buyer-dest">Cell Number or Hopwhistle Extension *</Label>',
  },
  {
    label: 'destination placeholder',
    marker: 'placeholder="e.g., +18652637582 or 1008"',
    pattern: /placeholder="e\.g\., \+18652637582"/,
    replacement: 'placeholder="e.g., +18652637582 or 1008"',
  },
  {
    label: 'destination help text',
    marker: 'four-digit registered Hopwhistle extension',
    pattern: /Must be formatted as a valid E\.164 number starting with \+ and country code\./,
    replacement:
      'Enter an external cell number in E.164 format (for example +18652637582) or a four-digit registered Hopwhistle extension (for example 1008).',
  },
  {
    label: 'buyer dialog description',
    marker: 'Modify the external cell number or internal Hopwhistle extension',
    pattern:
      /\?\s*'Modify destination phone number and routing rules for this buyer\.'\s*:\s*'Configure a destination phone number and routing rules for a buyer\.'/,
    replacement:
      "? 'Modify the external cell number or internal Hopwhistle extension and its routing rules.'\n                  : 'Configure an external buyer cell number or internal Hopwhistle extension.'",
  },
];

for (const { label, marker, pattern, replacement } of replacements) {
  if (source.includes(marker)) continue;
  if (!pattern.test(source)) {
    throw new Error(`Unable to patch campaign routing UI: ${label} source was not found`);
  }
  source = source.replace(pattern, replacement);
}

const requiredChecks = [
  ['cell/extension heading', source.includes('Cell / Hopwhistle Extension')],
  ['mixed routing explanation', source.includes('one external buyer selected by weight')],
  ['cell/extension placeholder', source.includes('+18652637582 or 1008')],
  ['four-digit extension help', source.includes('four-digit registered Hopwhistle extension')],
];

for (const [label, present] of requiredChecks) {
  if (!present) {
    throw new Error(`Campaign routing UI verification failed: ${label}`);
  }
}

writeFileSync(campaignPagePath, source);
console.log(`Campaign cell/extension routing UI applied: ${campaignPagePath}`);
