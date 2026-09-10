import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Logo } from '@/components/brand/logo';
import { Wordmark } from '@/components/brand/wordmark';
import { ThemeScope } from '@/components/domain/theme-scope';

/**
 * The brand marks are the supplied artwork, and the dark scope is an attribute.
 *
 * Both are the kind of thing a "helpful" refactor breaks silently: a mark set
 * in live text is a near-miss of the logo rather than the logo, and a
 * ThemeScope that forgot its attribute still renders. These pin the contract
 * the stylesheet and the smoke test rely on.
 */
describe('the wordmark', () => {
  it('renders the netEnroll artwork, not text set in a font', () => {
    const { container } = render(<Wordmark />);
    const mark = container.querySelector('[data-testid="wordmark"]');
    const img = mark?.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/netenroll-wordmark.svg');
    expect(img?.getAttribute('alt')).toBe('netEnroll');
  });
});

describe('the full lockup', () => {
  it('renders the wordmark-over-tagline artwork', () => {
    const { container } = render(<Logo />);
    const img = container.querySelector('[data-testid="logo"] img');
    expect(img?.getAttribute('src')).toBe('/netenroll-logo.svg');
    expect(img?.getAttribute('alt')).toBe('netEnroll \u2014 Pay-Per-Application');
  });
});

describe('the dark scope', () => {
  it('is an opt-in attribute on a subtree, not the document', () => {
    const { container } = render(
      <ThemeScope theme="dark">
        <span>live board</span>
      </ThemeScope>
    );
    expect(container.querySelector('[data-theme="dark"]')?.textContent).toBe('live board');
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
