/**
 * A campaign's "Your agents" tab, rendered against the roster as the API
 * actually sends it: wrapped in `{ data }`.
 *
 * The tab once read `response.data.agents` off that envelope, found nothing,
 * and showed an agency with agents an empty picker that said "Every agent is
 * on it".
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ apiClient: api }));

import { CampaignAgentsTab } from '@/components/campaigns/campaign-agents-tab';

const CAMPAIGN_ID = '11111111-1111-4111-8111-111111111111';

function agent(id: string, name: string, campaignIds: string[]) {
  return {
    id,
    email: `${id}@example.com`,
    name,
    status: 'ACTIVE',
    licensedStates: ['TX'],
    extension: '1001',
    hasSipCredential: true,
    cellForwardNumber: null,
    maxConcurrentCalls: 1,
    campaignIds,
    schedule: null,
    softphoneStatus: 'offline',
    availableForCalls: true,
    availabilityChangedAt: null,
    blockedReason: null,
    blockedBy: null,
  };
}

function roster(agents: ReturnType<typeof agent>[]) {
  return {
    data: {
      data: {
        agents,
        campaigns: [{ id: CAMPAIGN_ID, name: 'Final Expense' }],
        defaultMaxConcurrentCalls: 1,
        deliveryTimeZone: 'America/New_York',
      },
    },
  };
}

describe('CampaignAgentsTab', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.put.mockReset();
  });
  afterEach(cleanup);

  it("lists the agency's agents from the enveloped roster", async () => {
    api.get.mockResolvedValue(
      roster([agent('a1', 'Marcus Bell', [CAMPAIGN_ID]), agent('a2', 'Tanya Rodriguez', [])])
    );

    render(<CampaignAgentsTab campaignId={CAMPAIGN_ID} canManage />);

    expect(await screen.findByText('Marcus Bell')).toBeTruthy();
    expect(screen.getByText('Choose an agent')).toBeTruthy();
    expect(screen.queryByText('Every agent is on it')).toBeNull();
  });

  it('says there are no agents rather than that every agent is on it', async () => {
    api.get.mockResolvedValue(roster([]));

    render(<CampaignAgentsTab campaignId={CAMPAIGN_ID} canManage />);

    await waitFor(() => expect(screen.getByText('No agents yet')).toBeTruthy());
  });

  it('says every agent is on it only when they all are', async () => {
    api.get.mockResolvedValue(roster([agent('a1', 'Marcus Bell', [CAMPAIGN_ID])]));

    render(<CampaignAgentsTab campaignId={CAMPAIGN_ID} canManage />);

    await waitFor(() => expect(screen.getByText('Every agent is on it')).toBeTruthy());
  });
});
