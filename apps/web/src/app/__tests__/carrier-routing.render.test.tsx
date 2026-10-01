/**
 * Settings → Carrier Routing, rendered with Vonage in the catalog.
 *
 * Pins what an operator needs to make Vonage usable without touching the
 * database: it is listed on every waterfall, can be switched on and moved,
 * its health is readable without hovering, a missing caller ID is called out
 * before it is enabled, and its attestation behaviour is a setting.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}));

vi.mock('@/lib/api', () => ({ apiClient: api }));
vi.mock('@/components/layout/page-header', () => ({
  PageHeader: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div>,
}));
vi.mock('@/components/ui/use-toast', () => ({ toast: vi.fn() }));

import CarrierRoutingPage from '../(dashboard)/settings/carriers/page';

const CALL_TYPES = [
  ['INBOUND', 'Inbound Calls (All)'],
  ['CC_MANUAL', 'Call Center — Manual Outbound'],
  ['CC_POWER_DIALER', 'Call Center — Power Dialer'],
  ['SOFTPHONE_MANUAL', 'Agent Softphone — Manual Outbound'],
  ['PREDICTIVE_DIALER', 'Predictive Dialer'],
  ['DOGRAH_AI', 'Dograh AI Auto Dialer'],
] as const;

const gateway = (name: string, over: Record<string, unknown> = {}) => ({
  id: `gw-${name}`,
  name,
  priority: 0,
  enabled: true,
  numberFormat: 'NANP11',
  circuitOpen: false,
  circuitOpenUntil: null,
  consecutiveFailures: 0,
  lastFailureAt: null,
  lastFailureCause: null,
  lastSuccessAt: null,
  totalAttempts: 0,
  totalFailures: 0,
  ...over,
});

function overview(vonageEligible: number) {
  const vonageGateway = gateway('vonage', {
    circuitOpen: true,
    circuitOpenUntil: '2026-10-01T12:05:00.000Z',
    consecutiveFailures: 5,
    lastFailureAt: '2026-10-01T12:03:00.000Z',
    lastFailureCause: 'CALL_REJECTED',
    lastSuccessAt: '2026-10-01T11:00:00.000Z',
    totalAttempts: 40,
    totalFailures: 6,
  });
  return {
    routes: CALL_TYPES.map(([callType, label]) => ({
      callType,
      label,
      enabled: true,
      legTimeoutSeconds: 20,
      effectiveChain: ['fractel1'],
      effectiveSource: 'db',
      steps: [
        {
          stepId: `${callType}-f`,
          carrierId: 'c-fractel',
          carrierCode: 'FRACTEL',
          carrierName: 'FracTEL',
          carrierStatus: 'ACTIVE',
          position: 0,
          enabled: true,
          callerIdStrategy: 'PRESERVE',
          callerIdCount: 3,
          callerIdUnattestable: false,
          gateways: [gateway('fractel1')],
        },
        {
          stepId: `${callType}-v`,
          carrierId: 'c-vonage',
          carrierCode: 'VONAGE',
          carrierName: 'Vonage',
          carrierStatus: 'ACTIVE',
          position: 1,
          enabled: false,
          callerIdStrategy: 'POOL',
          callerIdCount: vonageEligible,
          callerIdUnattestable: vonageEligible === 0,
          gateways: [vonageGateway],
        },
      ],
    })),
    carriers: [
      {
        id: 'c-fractel',
        code: 'FRACTEL',
        name: 'FracTEL',
        status: 'ACTIVE',
        callerIdStrategy: 'PRESERVE',
        callerIdNumber: null,
        numberProvider: 'fractel',
        attestation: null,
        eligibleCallerIdCount: 3,
      },
      {
        id: 'c-vonage',
        code: 'VONAGE',
        name: 'Vonage',
        status: 'ACTIVE',
        callerIdStrategy: 'POOL',
        callerIdNumber: null,
        numberProvider: 'vonage',
        attestation: null,
        eligibleCallerIdCount: vonageEligible,
      },
    ],
    callTypes: CALL_TYPES.map(([value, label]) => ({ value, label })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.put.mockResolvedValue({ data: { effectiveChain: ['vonage'], carrierOrder: ['VONAGE'] } });
  api.patch.mockResolvedValue({ data: {} });
});

afterEach(cleanup);

describe('Carrier Routing with Vonage', () => {
  it('lists Vonage on every waterfall', async () => {
    api.get.mockResolvedValue({ data: overview(2) });
    render(<CarrierRoutingPage />);

    for (const [, label] of CALL_TYPES) {
      await screen.findByText(label);
    }
    expect(screen.getAllByLabelText('Enable Vonage')).toHaveLength(CALL_TYPES.length);
    expect(screen.getAllByLabelText('Move Vonage up')).toHaveLength(CALL_TYPES.length);
  });

  it('switches Vonage on for one waterfall only, and can make it primary', async () => {
    api.get.mockResolvedValue({ data: overview(2) });
    render(<CarrierRoutingPage />);
    await screen.findByText('Call Center — Power Dialer');

    const switches = screen.getAllByLabelText('Enable Vonage');
    fireEvent.click(switches[2]); // CC_POWER_DIALER (third card)
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/api/v1/carrier-routing/routes/CC_POWER_DIALER', {
      carriers: [
        { carrierId: 'c-fractel', enabled: true },
        { carrierId: 'c-vonage', enabled: true },
      ],
    });

    fireEvent.click(screen.getAllByLabelText('Move Vonage up')[3]); // SOFTPHONE_MANUAL
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(api.put.mock.calls[1][0]).toBe('/api/v1/carrier-routing/routes/SOFTPHONE_MANUAL');
    expect(api.put.mock.calls[1][1]).toEqual({
      carriers: [
        { carrierId: 'c-vonage', enabled: false },
        { carrierId: 'c-fractel', enabled: true },
      ],
    });
  });

  it('shows gateway health without hovering: attempts, faults, circuit, last fault, last success', async () => {
    api.get.mockResolvedValue({ data: overview(2) });
    render(<CarrierRoutingPage />);
    await screen.findByText('Inbound Calls (All)');

    const lines = screen.getAllByText(/^vonage: 40 attempts/);
    expect(lines).toHaveLength(CALL_TYPES.length);
    expect(lines[0].textContent).toContain('6 carrier faults');
    expect(lines[0].textContent).toContain('5 in a row');
    expect(lines[0].textContent).toContain('circuit open until');
    expect(lines[0].textContent).toContain('last fault CALL_REJECTED');
    expect(lines[0].textContent).toContain('last connected');
  });

  it('warns when Vonage has no eligible caller-ID number', async () => {
    api.get.mockResolvedValue({ data: overview(0) });
    render(<CarrierRoutingPage />);
    await screen.findByText('Carriers');

    expect(screen.getAllByText('no caller ID of its own').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/0 eligible caller-ID numbers — buy or port numbers here/)
    ).toBeTruthy();
  });

  it('makes the attestation claim and the carrier itself settings, not database edits', async () => {
    api.get.mockResolvedValue({ data: overview(2) });
    render(<CarrierRoutingPage />);
    await screen.findByText('Carriers');

    expect(screen.getByLabelText('Vonage attestation')).toBeTruthy();
    expect(screen.getByLabelText('Vonage caller ID')).toBeTruthy();
    const activeSwitch = screen.getByLabelText('Vonage active');
    fireEvent.click(activeSwitch);
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/api/v1/carrier-routing/carriers/c-vonage', {
        status: 'INACTIVE',
      })
    );
    expect(within(document.body).getByText('2 eligible caller-ID numbers')).toBeTruthy();
  });
});
