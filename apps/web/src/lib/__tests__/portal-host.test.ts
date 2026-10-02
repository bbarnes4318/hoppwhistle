import { describe, expect, it } from 'vitest';

import { portalRedirectTarget } from '../portal-host';

const at = (hostname: string, pathname = '/login', search = '') => ({
  hostname,
  pathname,
  search,
  protocol: 'https:',
});

describe('portalRedirectTarget', () => {
  it('moves an agency with its own domain off the default portal, keeping path and query', () => {
    expect(
      portalRedirectTarget(
        'agents.lifeleadsplus.com',
        at('agents.netenroll.com', '/login', '?activation=abc&email=a%40b.co')
      )
    ).toBe('https://agents.lifeleadsplus.com/login?activation=abc&email=a%40b.co');
  });

  it('does nothing on the right host, in any case', () => {
    expect(
      portalRedirectTarget('agents.lifeleadsplus.com', at('AGENTS.LifeLeadsPlus.com'))
    ).toBeNull();
  });

  it('does nothing for an agency on the default portal', () => {
    expect(portalRedirectTarget(null, at('agents.netenroll.com'))).toBeNull();
    expect(portalRedirectTarget(undefined, at('agents.netenroll.com'))).toBeNull();
  });

  it('never redirects local development or a bare IP', () => {
    expect(portalRedirectTarget('agents.lifeleadsplus.com', at('localhost'))).toBeNull();
    expect(portalRedirectTarget('agents.lifeleadsplus.com', at('178.156.223.97'))).toBeNull();
  });
});
