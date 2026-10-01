/**
 * The Buy numbers dialog, after carriers became the platform's choice.
 *
 * An agency owner searches one carrier-neutral endpoint and buys from whichever
 * carrier the chosen number came from; the platform decides which carriers
 * that can be (Settings -> Number carriers). What these pin: the dialog never
 * asks for a carrier, never names one to an owner, sends the carrier the
 * search answered with, and drops the Toll-free tab when no enabled carrier
 * sells toll-free.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const requested: Array<{ method: string; path: string; body: unknown }> = [];
let tollFreeAvailable: boolean | undefined = true;

const PRICING = () => ({
  data: {
    setup: 2.49,
    monthly: 1.49,
    firstMonth: 0.5,
    currency: 'USD',
    numbersUsed: 3,
    numbersLimit: 10,
    ...(tollFreeAvailable === undefined ? {} : { tollFreeAvailable }),
  },
});

beforeEach(() => {
  requested.length = 0;
  tollFreeAvailable = true;
  localStorage.setItem('token', 'an-agency-owner');
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(raw, 'http://localhost');
      const method = (init?.method ?? 'GET').toUpperCase();
      requested.push({
        method,
        path: `${url.pathname}${url.search}`,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      });
      if (url.pathname === '/api/v1/numbers/pricing') return json(PRICING());
      if (url.pathname === '/api/v1/campaigns') return json({ data: [] });
      if (url.pathname === '/api/v1/numbers/available') {
        return json({
          data: [
            {
              id: 'vonage:16155550101',
              carrierId: '16155550101',
              number: '+16155550101',
              provider: 'vonage',
            },
          ],
        });
      }
      if (url.pathname === '/api/v1/numbers/buy') {
        return json(
          {
            success: true,
            data: { phoneNumber: { id: 'n1', number: '+16155550101', status: 'ACTIVE' } },
          },
          201
        );
      }
      return json({ data: [] });
    })
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function open(isStaff = false): Promise<void> {
  const { BuyNumbersDialog } = await import('@/components/numbers/buy-numbers-dialog');
  render(<BuyNumbersDialog open onOpenChange={() => undefined} isStaff={isStaff} />);
  await waitFor(() => expect(screen.getByText('3 of 10 numbers used')).toBeTruthy());
}

async function searchAndPick(): Promise<void> {
  fireEvent.change(screen.getByLabelText('Area code'), { target: { value: '615' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  await waitFor(() => expect(screen.getByText('(615) 555-0101')).toBeTruthy());
}

describe('Buy numbers', () => {
  it('searches every enabled carrier through one endpoint, and names none to an owner', async () => {
    await open();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Local', 'Toll-free']);
    await searchAndPick();

    expect(
      requested.some(r => r.path === '/api/v1/numbers/available?type=local&areaCode=615')
    ).toBe(true);
    expect(requested.some(r => /fractel|bulkvs|vonage/.test(r.path))).toBe(false);
    expect(document.body.textContent).not.toMatch(/Vonage|FracTEL|BulkVS/);
  });

  it('buys from the carrier the number came from', async () => {
    await open();
    await searchAndPick();
    fireEvent.click(screen.getByText('(615) 555-0101'));
    fireEvent.click(await screen.findByRole('button', { name: /Buy for/ }));

    await waitFor(() => expect(screen.getByText('Number bought')).toBeTruthy());
    const buy = requested.find(r => r.path === '/api/v1/numbers/buy');
    expect(buy?.method).toBe('POST');
    expect(buy?.body).toMatchObject({ provider: 'vonage', number: '16155550101' });
  });

  it('tells NetEnroll staff which carrier each number is for sale at', async () => {
    await open(true);
    await searchAndPick();
    expect(document.querySelector('[data-carrier="vonage"]')?.textContent).toBe('Vonage');
  });

  it('offers no Toll-free tab when no enabled carrier sells toll-free', async () => {
    tollFreeAvailable = false;
    await open();
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Local']);
  });
});
