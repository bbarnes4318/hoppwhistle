/**
 * The buyer portal's account notices, top-up request and decided returns,
 * RENDERED.
 *
 *   - A paused account says why, in the words for its reason: "Paused: balance
 *     too low" when the wallet ran out, "Paused by <agency>" when the agency
 *     paused it by hand -- the one a top-up does not lift.
 *   - "Request a top-up" posts the request and then reads "Request sent". It
 *     used to copy a sentence to the clipboard and send nothing.
 *   - A decided return shows what the call was billed, not the $0.00 an
 *     acceptance leaves on it, and the note the agency decided it with.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const requestTopUp = vi.fn<[string, string, number], Promise<{ ok: boolean; error?: string }>>();

vi.mock('@/app/(dashboard)/buyer/actions', () => ({
  requestTopUp: (token: string, buyerId: string, amount: number) =>
    requestTopUp(token, buyerId, amount),
}));

vi.mock('@/lib/session-token', () => ({
  readSessionToken: () => 'buyer-token',
}));

// The banner's loader reads the session on the server; only the presentational
// half is rendered here.
vi.mock('@/lib/server/session', () => ({ getSession: vi.fn() }));

import { AccountNotice } from '@/app/(dashboard)/buyer/_components/account-banner';
import { TopUpPlanner } from '@/app/(dashboard)/buyer/billing/top-up-planner';
import {
  FiledDisputesTable,
  type FiledDisputeRow,
} from '@/app/(dashboard)/buyer/disputes/filed-table';

afterEach(() => {
  cleanup();
  requestTopUp.mockReset();
});

const base = {
  billingType: 'UPFRONT' as const,
  walletBalance: 0,
  lowBalance: null,
};

describe('The paused banner', () => {
  it('says the balance is too low for a wallet pause', () => {
    render(
      <AccountNotice
        profile={{ ...base, status: 'PAUSED', pauseReason: 'WALLET_EMPTY', pausedBy: null }}
      />
    );
    expect(screen.getByText('Paused: balance too low')).toBeTruthy();
    expect(screen.queryByText(/Paused by/)).toBeNull();
  });

  it('names the agency for a manual pause, and says a top-up will not lift it', () => {
    render(
      <AccountNotice
        profile={{ ...base, status: 'PAUSED', pauseReason: 'MANUAL', pausedBy: 'Sunrise Leads' }}
      />
    );
    expect(screen.getByText('Paused by Sunrise Leads')).toBeTruthy();
    expect(screen.getByText(/Adding funds will not resume your account/)).toBeTruthy();
    expect(screen.queryByText('Paused: balance too low')).toBeNull();
  });

  it('warns a prepaid account running low, and says nothing to a healthy one', () => {
    const { rerender } = render(
      <AccountNotice
        profile={{
          ...base,
          status: 'ACTIVE',
          walletBalance: 60,
          lowBalance: { isLow: true, threshold: 125, averageCallPrice: 25, basis: 'RECENT_CALLS' },
        }}
      />
    );
    expect(screen.getByText('Balance running low')).toBeTruthy();
    expect(
      screen.getByText(/\$60\.00 covers fewer than five calls at about \$25\.00/)
    ).toBeTruthy();

    rerender(
      <AccountNotice
        profile={{
          ...base,
          status: 'ACTIVE',
          walletBalance: 600,
          lowBalance: { isLow: false, threshold: 125, averageCallPrice: 25, basis: 'RECENT_CALLS' },
        }}
      />
    );
    expect(screen.queryByText('Balance running low')).toBeNull();
    expect(screen.queryByText(/Paused/)).toBeNull();
  });
});

describe('Request a top-up', () => {
  it('posts the request for the chosen amount, then reads "Request sent"', async () => {
    requestTopUp.mockResolvedValue({ ok: true });
    render(<TopUpPlanner buyerId="buyer-1" balance={40} burnPerDay={10} />);

    fireEvent.click(screen.getByRole('button', { name: '$1,000' }));
    fireEvent.click(screen.getByRole('button', { name: 'Request a top-up' }));

    await waitFor(() => expect(screen.getByRole('button', { name: 'Request sent' })).toBeTruthy());
    expect(requestTopUp).toHaveBeenCalledWith('buyer-token', 'buyer-1', 1000);
    expect(screen.getByText(/has been asked for \$1,000\.00/)).toBeTruthy();
  });

  it('says what went wrong when the request is refused', async () => {
    requestTopUp.mockResolvedValue({ ok: false, error: 'Your request could not be sent.' });
    render(<TopUpPlanner buyerId="buyer-1" balance={40} burnPerDay={10} />);

    fireEvent.click(screen.getByRole('button', { name: 'Request a top-up' }));

    await waitFor(() => expect(screen.getByText('Your request could not be sent.')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Request sent' })).toBeNull();
  });
});

describe('A decided return', () => {
  const row: FiledDisputeRow = {
    id: 'call-1',
    callerId: '+15125550101',
    campaignName: 'Final Expense',
    createdAt: '2026-09-10T15:00:00.000Z',
    filedAt: '2026-09-12T14:00:00.000Z',
    status: 'ACCEPTED',
    reason: '[UNDER_THRESHOLD] Did not reach the billable threshold',
    amount: 40,
    decisionNote: 'Agreed, the caller was out of state',
    connectedSeconds: 42,
    thresholdSeconds: 60,
    scaleSeconds: 180,
  };

  it('shows the original amount, not $0.00, and the agency note', async () => {
    render(<FiledDisputesTable rows={[row]} />);

    expect(screen.getByText('Return accepted')).toBeTruthy();
    expect(screen.getAllByText('$40.00').length).toBeGreaterThan(0);
    expect(screen.queryByText('$0.00')).toBeNull();

    fireEvent.click(screen.getByText('Did not reach the billable threshold'));
    await waitFor(() =>
      expect(screen.getByText('Agreed, the caller was out of state')).toBeTruthy()
    );
  });
});
