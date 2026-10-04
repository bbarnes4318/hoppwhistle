/**
 * The manual lead form, RENDERED: an agent is not offered "Save & Send to
 * Buyer".
 *
 * Sending a lead to a buyer is the agency owner's or an administrator's action.
 * The API refuses it for an agent on every route that posts to the buyer; this
 * is the screen half, so an agent never sees a choice the server will refuse.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let agentView = false;
vi.mock('@/hooks/use-agent-view', () => ({ useAgentView: () => agentView }));
const post = vi.fn();
vi.mock('@/lib/api', () => ({ apiClient: { post: (...args: unknown[]) => post(...args) } }));

afterEach(() => {
  cleanup();
  post.mockReset();
});

function fillBasics(): void {
  fireEvent.change(screen.getByLabelText(/First name/), { target: { value: 'Carol' } });
  fireEvent.change(screen.getByLabelText(/Last name/), { target: { value: 'Smith' } });
  fireEvent.change(screen.getByLabelText(/Phone/), { target: { value: '8655551234' } });
  fireEvent.change(screen.getByLabelText(/State/), { target: { value: 'TN' } });
}

describe('manual lead form', () => {
  it('does not offer an agent "Save & Send to Buyer"', async () => {
    agentView = true;
    const { ManualLeadEntryFormV2 } = await import('@/components/leads/manual-lead-entry-form-v2');
    render(<ManualLeadEntryFormV2 />);
    expect(screen.getByRole('button', { name: 'Save lead' })).toBeTruthy();
    expect(screen.queryByText(/send to buyer/i)).toBeNull();
  });

  it('still offers it to the agency owner', async () => {
    agentView = false;
    const { ManualLeadEntryFormV2 } = await import('@/components/leads/manual-lead-entry-form-v2');
    render(<ManualLeadEntryFormV2 />);
    expect(screen.getByRole('button', { name: 'Save lead' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save & send to buyer' })).toBeTruthy();
  });

  it('saves to the CRM with only the basics, and sends nothing to a buyer', async () => {
    agentView = false;
    post.mockResolvedValue({ data: { total: 1, successCount: 1, failCount: 0, details: [] } });
    const { ManualLeadEntryFormV2 } = await import('@/components/leads/manual-lead-entry-form-v2');
    render(<ManualLeadEntryFormV2 />);
    fillBasics();
    fireEvent.click(screen.getByRole('button', { name: 'Save lead' }));
    await waitFor(() => expect(screen.getByText('Lead saved to the CRM.')).toBeTruthy());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe('/api/v1/insurance-leads/import');
  });

  it('outlines what a buyer still needs and opens the opt-in record, without posting', async () => {
    agentView = false;
    const { ManualLeadEntryFormV2 } = await import('@/components/leads/manual-lead-entry-form-v2');
    render(<ManualLeadEntryFormV2 />);
    fillBasics();
    expect(screen.queryByLabelText('TrustedForm certificate URL')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Save & send to buyer' }));

    expect(screen.getByText(/To send to the buyer, complete: email/)).toBeTruthy();
    expect(screen.getByLabelText('Email').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByLabelText('TrustedForm certificate URL').getAttribute('aria-invalid')).toBe(
      'true'
    );
    expect(screen.getByLabelText(/First name/).getAttribute('aria-invalid')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });
});
