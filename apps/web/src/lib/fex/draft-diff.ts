/**
 * What the agent changed between two drafts, said the way they would say it:
 * "Added Diabetes", "Metformin: for Diabetes", "Age 70 → 71".
 *
 * Paired with `diffOutcomes`, so a carrier's changed answer is shown beside
 * the edit that came before it ("After adding Diabetes: 3 outcomes changed").
 * It names the edit; it never claims the edit caused a given carrier's
 * change -- the engine does not say which answer a rule matched.
 *
 * Pure, so it is tested without a browser.
 */

import type { QuoteDraft } from './draft';
import { conditionFacts, medShortName } from './intake-status';

const money = (raw: string) => {
  const n = Number(raw);
  return Number.isFinite(n) && raw ? `$${n.toLocaleString('en-US')}` : '—';
};

function ageText(d: QuoteDraft): string {
  return d.ageOrDob.mode === 'age' ? d.ageOrDob.age || '—' : d.ageOrDob.dob || '—';
}

function coverageText(d: QuoteDraft): string {
  return d.coverage.mode === 'face'
    ? `${money(d.coverage.face)} face`
    : `${money(d.coverage.budget)}/mo budget`;
}

/**
 * The edits from `prev` to `next`, most telling first: health before
 * demographics, because a health answer is what moves a class.
 */
export function describeDraftChange(
  prev: QuoteDraft,
  next: QuoteDraft,
  conditionLabel: (code: string) => string
): string[] {
  const health: string[] = [];
  const other: string[] = [];

  const before = new Map(prev.conditions.map(c => [c.code, c]));
  const after = new Map(next.conditions.map(c => [c.code, c]));
  for (const [code, c] of after) {
    const was = before.get(code);
    if (!was) health.push(`Added ${conditionLabel(code)}`);
    else if (conditionFacts(was).join() !== conditionFacts(c).join())
      health.push(`${conditionLabel(code)} answers changed`);
  }
  for (const code of before.keys())
    if (!after.has(code)) health.push(`Removed ${conditionLabel(code)}`);

  const medsBefore = new Map(prev.meds.map(m => [m.drugId, m]));
  const medsAfter = new Map(next.meds.map(m => [m.drugId, m]));
  for (const [id, m] of medsAfter) {
    const was = medsBefore.get(id);
    const name = medShortName(m.name);
    if (!was) health.push(`Added ${name}`);
    else if (was.indication !== m.indication && m.indication)
      health.push(`${name}: for ${conditionLabel(m.indication)}`);
    else if (was.lastTakenMonthsAgo !== m.lastTakenMonthsAgo)
      health.push(`${name}: last taken changed`);
  }
  for (const [id, m] of medsBefore)
    if (!medsAfter.has(id)) health.push(`Removed ${medShortName(m.name)}`);

  if (prev.state !== next.state) other.push(`State ${prev.state || '—'} → ${next.state || '—'}`);
  if (prev.sex !== next.sex) other.push(`Sex ${next.sex === 'M' ? 'male' : 'female'}`);
  if (ageText(prev) !== ageText(next)) {
    other.push(
      next.ageOrDob.mode === 'age'
        ? `Age ${ageText(prev)} → ${ageText(next)}`
        : `Date of birth ${ageText(next)}`
    );
  }
  if (prev.tobacco !== next.tobacco)
    other.push(next.tobacco ? 'Tobacco: yes' : next.tobacco === false ? 'Tobacco: no' : 'Tobacco');
  if (
    prev.heightFt !== next.heightFt ||
    prev.heightIn !== next.heightIn ||
    prev.weightLb !== next.weightLb
  )
    other.push('Height / weight');
  if (coverageText(prev) !== coverageText(next))
    other.push(`${coverageText(prev)} → ${coverageText(next)}`);
  if (prev.paymentMode !== next.paymentMode) other.push('Payment mode');

  return [...health, ...other];
}
