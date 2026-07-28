import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const campaignPagePath = resolve(
  process.argv[2] || 'apps/web/src/app/(dashboard)/campaigns/[id]/page.tsx'
);

let source = readFileSync(campaignPagePath, 'utf8');

const replacements = [
  [
    '<TableHead>Destination DID</TableHead>',
    '<TableHead>Cell / Hopwhistle Extension</TableHead>',
  ],
  [
    'Configure buyer target numbers and destination routing rules. Priority controls routing order (lower = higher priority).',
    'Route one campaign DID to external buyer cell phones and internal Hopwhistle extensions. At each priority, all eligible internal extensions ring together with one external buyer selected by weight; lower priorities are sequential failover steps.',
  ],
  [
    '<Label htmlFor="buyer-dest">Destination Phone Number (E.164 Format) *</Label>',
    '<Label htmlFor="buyer-dest">Cell Number or Hopwhistle Extension *</Label>',
  ],
  [
    'placeholder="e.g., +18652637582"',
    'placeholder="e.g., +18652637582 or 1008"',
  ],
  [
    'Must be formatted as a valid E.164 number starting with + and country code.',
    'Enter an external cell number in E.164 format (for example +18652637582) or a four-digit registered Hopwhistle extension (for example 1008).',
  ],
  [
    "? 'Modify destination phone number and routing rules for this buyer.' \n                   : 'Configure a destination phone number and routing rules for a buyer.'",
    "? 'Modify the external cell number or internal Hopwhistle extension and its routing rules.' \n                   : 'Configure an external buyer cell number or internal Hopwhistle extension.'",
  ],
];

for (const [before, after] of replacements) {
  if (source.includes(after)) continue;
  if (!source.includes(before)) {
    throw new Error(`Unable to patch campaign routing UI; expected text not found: ${before}`);
  }
  source = source.replace(before, after);
}

for (const marker of [
  'Cell / Hopwhistle Extension',
  'one external buyer selected by weight',
  '+18652637582 or 1008',
]) {
  if (!source.includes(marker)) {
    throw new Error(`Campaign routing UI verification failed: ${marker}`);
  }
}

writeFileSync(campaignPagePath, source);
console.log(`Campaign cell/extension routing UI applied: ${campaignPagePath}`);
