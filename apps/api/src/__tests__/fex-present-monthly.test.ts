/**
 * The quoter never states an annual premium. A carrier with no published
 * monthly factor is priced monthly on an estimated one, and its bundle alert,
 * which still says "annual premium shown", is restated to match.
 */
import { describe, expect, it } from 'vitest';

import { agentAlert } from '../services/fex/present.js';

describe('agentAlert', () => {
  it('restates the bundle`s "annual premium shown" alerts as an estimated monthly premium', () => {
    for (const alert of [
      'Monthly factor not published in the producer guide - annual premium shown.',
      'CICA does not publish a monthly modal factor - annual premium shown; confirm monthly with CICA.',
    ]) {
      expect(agentAlert(alert)).toMatch(/^Monthly premium is estimated/);
      expect(agentAlert(alert)).not.toMatch(/annual premium/i);
    }
  });

  it('leaves every other alert as it is', () => {
    const alert = "CICA's 2023 state map shows 13 approved states only.";
    expect(agentAlert(alert)).toBe(alert);
  });
});
