import { describe, expect, it } from 'vitest';

import { defaultCrmView } from '../crm-view';

describe('which CRM list opens first', () => {
  it('opens Submitted Apps when there are no prospects and some submitted apps', () => {
    expect(defaultCrmView(null, { prospects: 0, submittedApps: 94 })).toBe('submitted');
  });

  it('opens Prospects whenever there are prospects', () => {
    expect(defaultCrmView(null, { prospects: 3, submittedApps: 94 })).toBe('prospects');
  });

  it('opens Prospects on an empty book, and before the counts are in', () => {
    expect(defaultCrmView(null, { prospects: 0, submittedApps: 0 })).toBe('prospects');
    expect(defaultCrmView(null, null)).toBe('prospects');
  });

  it('keeps the tab the URL names, whatever the counts', () => {
    expect(defaultCrmView('prospects', { prospects: 0, submittedApps: 94 })).toBe('prospects');
    expect(defaultCrmView('submitted', { prospects: 12, submittedApps: 0 })).toBe('submitted');
  });

  it('ignores a tab it does not know', () => {
    expect(defaultCrmView('pipeline', { prospects: 0, submittedApps: 94 })).toBe('submitted');
  });
});
