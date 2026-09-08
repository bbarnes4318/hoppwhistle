import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Wordmark } from '@/components/brand/wordmark';
import { ThemeScope } from '@/components/domain/theme-scope';

/**
 * The wordmark is two colours, literally, and the dark scope is an attribute.
 *
 * Both are the kind of thing a token rename or a "helpful" refactor breaks
 * silently: "netEnroll" set in one colour is still a word, and a ThemeScope
 * that forgot its attribute still renders. These pin the contract the
 * stylesheet and the smoke test rely on.
 */
describe('the wordmark', () => {
  it('reads netEnroll, with "net" in black and "Enroll" in the brand green', () => {
    const { container } = render(<Wordmark />);
    const mark = container.querySelector('[data-testid="wordmark"]');
    expect(mark?.textContent).toBe('netEnroll');
    const [net, enroll] = Array.from(mark?.querySelectorAll('span') ?? []);
    expect(net.textContent).toBe('net');
    expect(net.style.color).toBe('rgb(0, 0, 0)');
    expect(enroll.textContent).toBe('Enroll');
    expect(enroll.style.color).toBe('rgb(16, 185, 129)');
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
