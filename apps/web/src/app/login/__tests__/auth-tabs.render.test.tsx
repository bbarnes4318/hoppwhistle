/**
 * The front door has TWO doors, and both of them carry the Google button.
 *
 * This is the second time the create-account half has gone missing. The first
 * time it was the Google button alone, lost to an effect that looked its
 * container up by id on a commit where the panel was not in the document yet.
 * The second time the whole half went with a redesign, leaving an invited
 * agent with an activation link and no form to put it in unless the link
 * happened to be the one they clicked.
 *
 * A source-level test cannot catch either of those: the code reads as though
 * the button is there in both cases. So this one MOUNTS the page, switches
 * tabs the way a person does, and asserts on what is actually in the document.
 *
 * `accounts.google.com` is not reachable from a test, and should not be. The
 * stub below is Google's own contract as this page uses it -- `initialize`,
 * then `renderButton` into whatever element it is handed -- which is enough to
 * prove the slot exists, is attached, and is measured. Whether Google's real
 * iframe then draws is `apps/web/e2e`'s problem, not this file's.
 */
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AuthPage from '../page';

/** Every renderButton call the page made, in order. */
let drawn: { text: string; width: number; slotId: string }[] = [];

/** Where `enter()` sent the browser, if it got that far. */
let pushed: string[] = [];

function installGoogle(): void {
  (window as unknown as { google: unknown }).google = {
    accounts: {
      id: {
        initialize: vi.fn(),
        renderButton: (el: HTMLElement, cfg: { text: string; width: number }) => {
          drawn.push({ text: cfg.text, width: cfg.width, slotId: el.id });
          const button = document.createElement('div');
          button.setAttribute('data-google-button', cfg.text);
          el.appendChild(button);
        },
      },
    },
  };
}

/**
 * `next/script` with `strategy="lazyOnload"` never runs in jsdom, so `onLoad`
 * has to be the mock's job. Firing it synchronously on mount is the case that
 * matters least -- it is the script arriving LATE, after a tab switch, that
 * broke before -- so the tab-switch test below drives that ordering directly.
 */
vi.mock('next/script', () => ({
  default: ({ onLoad }: { onLoad?: () => void }) => {
    onLoad?.();
    return null;
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: (to: string) => pushed.push(to), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/login',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: null, isLoading: false, refetch: () => Promise.resolve() }),
}));

/** jsdom has no ResizeObserver, and GoogleButton observes its slot. */
class StubResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

function goTo(search: string): void {
  window.history.replaceState({}, '', `/login${search}`);
}

/**
 * Switch tabs the way Radix listens for it.
 *
 * `TabsTrigger` activates on mousedown, not on click, and `fireEvent.click`
 * dispatches only the click -- so a plain click here leaves the panel inactive
 * while a real browser switches. (Verified against Chromium: the tabs work.)
 */
function selectTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
}

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  drawn = [];
  pushed = [];
  vi.stubGlobal('ResizeObserver', StubResizeObserver);
  installGoogle();
  goTo('');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as unknown as { google?: unknown }).google;
});

describe('the login page', () => {
  it('offers creating an account alongside signing in', () => {
    render(<AuthPage />);
    expect(screen.getByRole('tab', { name: 'Sign in' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Create account' })).toBeDefined();
  });

  it('draws the Google button on the sign-in half', async () => {
    render(<AuthPage />);
    await waitFor(() =>
      expect(document.querySelector('#google-signin-button [data-google-button]')).not.toBeNull()
    );
    expect(drawn.at(-1)).toMatchObject({ text: 'continue_with', slotId: 'google-signin-button' });
  });

  it('draws the Google button on the create-account half too', async () => {
    render(<AuthPage />);
    selectTab('Create account');

    await waitFor(() =>
      expect(document.querySelector('#google-signup-button [data-google-button]')).not.toBeNull()
    );
    expect(drawn.at(-1)).toMatchObject({ text: 'signup_with', slotId: 'google-signup-button' });
    // The regression that started all of this: one button, not zero, and not
    // two stacked from a redraw.
    expect(document.querySelectorAll('#google-signup-button [data-google-button]')).toHaveLength(1);
  });

  it('redraws the Google button when the tab is left and come back to', async () => {
    render(<AuthPage />);
    selectTab('Create account');
    await waitFor(() =>
      expect(document.querySelector('#google-signup-button [data-google-button]')).not.toBeNull()
    );

    // Radix unmounts the inactive panel, so the slot coming back is a NEW node
    // and the ref callback has to fire again for it.
    selectTab('Sign in');
    selectTab('Create account');

    await waitFor(() =>
      expect(document.querySelectorAll('#google-signup-button [data-google-button]')).toHaveLength(
        1
      )
    );
  });

  it('asks for the invitation code when there was no link to carry it', async () => {
    render(<AuthPage />);
    selectTab('Create account');
    expect(await screen.findByLabelText('Invitation code')).toBeDefined();
  });

  it('sends the typed invitation code with the registration', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : String(input);
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      return Promise.resolve(
        json({ token: 't', csrfToken: 'c', user: { id: 'u', email: 'a@b.com', roles: [] } }, 201)
      );
    });

    render(<AuthPage />);
    selectTab('Create account');

    fireEvent.change(await screen.findByLabelText('Email address'), {
      target: { value: 'agent@agency.com' },
    });
    fireEvent.change(screen.getByLabelText('Invitation code'), {
      target: { value: ' GRANT-123 ' },
    });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'Licensed Agent' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'Password1' } });
    fireEvent.click(screen.getByRole('button', { name: /Create my account/ }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toContain('/api/auth/register');
    // Trimmed: a code pasted out of an email arrives with whitespace attached,
    // and the server compares it exactly.
    expect(calls[0].body.activationToken).toBe('GRANT-123');
    expect(calls[0].body.email).toBe('agent@agency.com');
  });

  it('opens on the create half and skips the code field when a link carried one', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(json({ agencyName: 'Northwind' }, 200)));
    goTo('?activation=GRANT-123&email=agent%40agency.com');

    render(<AuthPage />);

    await waitFor(() =>
      expect(document.querySelector('#google-signup-button [data-google-button]')).not.toBeNull()
    );
    expect(screen.queryByLabelText('Invitation code')).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>('Email address').value).toBe('agent@agency.com');
    expect(await screen.findByText(/You have been invited to join Northwind\./)).toBeDefined();
  });
});
