/**
 * The import dialog's send button must never be able to post more leads than
 * the import created.
 *
 * It has now been wrong twice, both times by widening the scope rather than
 * narrowing it: first by scoping to the list (17 imported, 74 offered), then by
 * falling back to the list whenever the API returned no submission ids (170
 * imported, 12,000 offered). A post is spent whether or not the lead sells, so
 * the second one would have burned 12,000 leads through their 90-day duplicate
 * window on one click.
 *
 * These read the component source. That is blunt, but the failure is a
 * one-word selector change that typechecks, passes review, and costs the
 * business real money — so it is worth catching mechanically.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '..', 'csv-import-dialog.tsx'), 'utf8');

/** The BuyerDeliveryPanel function body. */
const panel = source.slice(source.indexOf('function BuyerDeliveryPanel'));

describe('delivery scope', () => {
  it('sends only the submissions the import created', () => {
    // One selector object feeds both preflight and send, so the number shown
    // and the number posted cannot drift apart.
    expect(panel).toMatch(/const selector = useMemo\(\(\) => \(\{ submissionIds, vertical \}\)/);
  });

  it('never falls back to a list-wide scope', () => {
    // `listId` anywhere in this panel means some path can post the whole list.
    expect(panel).not.toMatch(/\blistId\b/);
  });

  it('refuses to preflight or send when it has no ids', () => {
    expect(panel).toMatch(/if \(!submissionIds\.length\) \{/);
  });

  it('passes no list id into the panel', () => {
    const callSite = source.slice(source.indexOf('<BuyerDeliveryPanel'));
    expect(callSite.slice(0, 200)).not.toMatch(/listId=/);
  });
});
