/**
 * The Statements panel, RENDERED against a stubbed API.
 *
 *   the months       "Month to date" first and marked still open, then each
 *                    closed month, newest first
 *   the files        Download PDF / Download CSV ask for exactly that month's
 *                    file, for exactly the party the panel was given
 *   a refusal        the API's reason is shown, not a generic failure
 *   the owner view   the agency's own statements, and a buyer's once picked
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fileNameFrom,
  statementFilePath,
  statementQuery,
} from '@/components/statements/statements-panel';
import { partyFromPick } from '@/components/statements/statements-view';

let requested: string[] = [];
let fileStatus = 200;

function urlOf(input: RequestInfo | URL): URL {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, 'http://localhost');
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const MONTHS = [
  { month: 'current', label: 'Month to date (September 2026)', live: true, createdAt: null },
  { month: '2026-08', label: 'August 2026', live: false, createdAt: '2026-09-01T05:00:00.000Z' },
  { month: '2026-07', label: 'July 2026', live: false, createdAt: '2026-08-01T05:00:00.000Z' },
];

beforeEach(() => {
  requested = [];
  fileStatus = 200;
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = urlOf(input);
      requested.push(`${url.pathname}${url.search}`);
      if (url.pathname === '/api/v1/statements') {
        const partyType = url.searchParams.get('partyType') ?? 'AGENCY';
        return Promise.resolve(
          json({ data: { party: { partyType, partyId: 'p', tenantId: 't' }, months: MONTHS } })
        );
      }
      if (url.pathname.startsWith('/api/v1/statements/')) {
        if (fileStatus !== 200) {
          return Promise.resolve(
            json(
              {
                error: {
                  code: 'STATEMENT_DOES_NOT_RECONCILE',
                  message: 'Wallet does not reconcile for buyer b-1',
                },
              },
              fileStatus
            )
          );
        }
        return Promise.resolve(
          new Response('%PDF-1.4', {
            status: 200,
            headers: {
              'content-type': 'application/pdf',
              'content-disposition': 'attachment; filename="statement-acme-2026-08.pdf"',
            },
          })
        );
      }
      if (url.pathname === '/api/v1/buyers') {
        return Promise.resolve(json({ data: [{ id: 'b-1', name: 'Acme Senior' }] }));
      }
      if (url.pathname === '/api/v1/publishers') {
        return Promise.resolve(json({ data: [{ id: 'p-1', name: 'Alpha Media' }] }));
      }
      return Promise.resolve(json({ error: { code: 'NOT_FOUND', message: 'nope' } }, 404));
    })
  );
  // jsdom cannot follow a download link; the request is what is under test.
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  URL.createObjectURL = vi.fn(() => 'blob:statement');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('statement paths', () => {
  it('names the party and the month, and nothing else', () => {
    expect(statementQuery()).toBe('');
    expect(statementQuery('BUYER', 'b-1')).toBe('?partyType=BUYER&partyId=b-1');
    expect(statementFilePath('2026-08', 'csv', 'PUBLISHER', 'p-1')).toBe(
      '/api/v1/statements/2026-08.csv?partyType=PUBLISHER&partyId=p-1'
    );
    expect(statementFilePath('current', 'pdf')).toBe('/api/v1/statements/current.pdf');
  });

  it("takes the API's file name, or a plain one", () => {
    expect(fileNameFrom('attachment; filename="statement-acme-2026-08.pdf"', 'x.pdf')).toBe(
      'statement-acme-2026-08.pdf'
    );
    expect(fileNameFrom(null, 'statement-2026-08.pdf')).toBe('statement-2026-08.pdf');
  });

  it("reads the owner's picker value as a party", () => {
    expect(partyFromPick('BUYER:b-1')).toEqual({ partyType: 'BUYER', partyId: 'b-1' });
    expect(partyFromPick('PUBLISHER:p-1')).toEqual({ partyType: 'PUBLISHER', partyId: 'p-1' });
    expect(partyFromPick('AGENCY:t')).toBeNull();
    expect(partyFromPick('')).toBeNull();
  });
});

describe('StatementsPanel', () => {
  it('lists Month to date first, then the closed months newest first', async () => {
    const { StatementsPanel } = await import('@/components/statements/statements-panel');
    render(<StatementsPanel partyType="BUYER" partyId="b-1" />);

    const list = await screen.findByRole('list', { name: 'Statement months' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map(item => item.textContent)).toEqual([
      expect.stringContaining('Month to date (September 2026)'),
      expect.stringContaining('August 2026'),
      expect.stringContaining('July 2026'),
    ]);
    expect(items[0].textContent).toContain('Still open');
    expect(items[1].textContent).not.toContain('Still open');
    expect(requested).toContain('/api/v1/statements?partyType=BUYER&partyId=b-1');
  });

  it("downloads exactly that month's PDF and CSV for the party it was given", async () => {
    const { StatementsPanel } = await import('@/components/statements/statements-panel');
    render(<StatementsPanel partyType="BUYER" partyId="b-1" />);

    fireEvent.click(await screen.findByRole('button', { name: 'Download August 2026 PDF' }));
    await waitFor(() =>
      expect(requested).toContain('/api/v1/statements/2026-08.pdf?partyType=BUYER&partyId=b-1')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Download July 2026 CSV' }));
    await waitFor(() =>
      expect(requested).toContain('/api/v1/statements/2026-07.csv?partyType=BUYER&partyId=b-1')
    );
  });

  it('shows the reason a statement could not be produced', async () => {
    fileStatus = 409;
    const { StatementsPanel } = await import('@/components/statements/statements-panel');
    render(<StatementsPanel partyType="BUYER" partyId="b-1" />);

    fireEvent.click(
      await screen.findByRole('button', { name: 'Download Month to date (September 2026) PDF' })
    );
    expect(await screen.findByText('Wallet does not reconcile for buyer b-1')).toBeTruthy();
  });
});

describe('StatementsView (Revenue → Statements)', () => {
  it("shows the agency's statements, and a buyer's once picked", async () => {
    class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverStub);
    const { StatementsView } = await import('@/components/statements/statements-view');
    render(<StatementsView />);

    expect(await screen.findByText("Your agency's statements")).toBeTruthy();
    await waitFor(() => expect(requested).toContain('/api/v1/statements?partyType=AGENCY'));
    await waitFor(() => expect(requested).toContain('/api/v1/buyers?limit=500'));
    expect(screen.getByRole('combobox', { name: 'Buyer or publisher' })).toBeTruthy();
  });
});
