/**
 * The manual lead form, RENDERED: an agent is not offered "Save & Send to
 * Buyer".
 *
 * Sending a lead to a buyer is the agency owner's or an administrator's action.
 * The API refuses it for an agent on every route that posts to the buyer; this
 * is the screen half, so an agent never sees a choice the server will refuse.
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let agentView = false;
vi.mock('@/hooks/use-agent-view', () => ({ useAgentView: () => agentView }));
vi.mock('@/hooks/use-brand', () => ({ useBrand: () => ({ productName: 'Life Leads Plus' }) }));
vi.mock('@/lib/api', () => ({ apiClient: { post: vi.fn() } }));

afterEach(() => {
  cleanup();
});

describe('manual lead form', () => {
  it('does not offer an agent "Save & Send to Buyer"', async () => {
    agentView = true;
    const { ManualLeadEntryFormV2 } = await import('@/components/leads/manual-lead-entry-form-v2');
    render(<ManualLeadEntryFormV2 />);
    expect(screen.getByText('Save to CRM Only')).toBeTruthy();
    expect(screen.queryByText(/Send to Buyer/)).toBeNull();
  });

  it('still offers it to the agency owner', async () => {
    agentView = false;
    const { ManualLeadEntryFormV2 } = await import('@/components/leads/manual-lead-entry-form-v2');
    render(<ManualLeadEntryFormV2 />);
    expect(screen.getByText('Save to CRM Only')).toBeTruthy();
    expect(screen.getAllByText(/Send to Buyer/).length).toBeGreaterThan(0);
  });
});
