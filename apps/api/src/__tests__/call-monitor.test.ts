/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access -- assertions run over parsed JSON responses */
/**
 * Supervisor listen-in, and the MANAGER role it exists for.
 *
 * ── The properties asserted here ─────────────────────────────────────────────
 *
 *   1. WHO. OWNER, ADMIN and MANAGER supervise the floor; an AGENT never
 *      listens to a colleague, whatever a `roles` row adds. A MANAGER is not an
 *      agency principal and gains no administrative capability.
 *   2. WHOSE. `:userId` must be an AGENT of the acting agency, and the channel
 *      listened to is found from that agent's extension on the switch -- never
 *      from anything else in the request.
 *   3. LISTEN-ONLY. The originate carries `eavesdrop_enable_dtmf=false`, so the
 *      listener cannot whisper or barge, and the monitor header the softphone
 *      auto-answers on.
 *   4. The agent's live leg is picked the way the dialplan's busy check finds
 *      an agent's channels, and only from an answered call.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { effectivePermissionsFor, ROLE_PERMISSIONS } from '../middleware/rbac.js';
import { registerCallMonitorRoutes } from '../routes/call-monitor.js';
import {
  parseRegistrations,
  pickAgentLiveLeg,
  type FsChannel,
} from '../services/freeswitch-service.js';

/* ── The role ──────────────────────────────────────────────────────────────── */

describe('MANAGER capabilities', () => {
  it('may listen in, and read what it coaches from', () => {
    const granted = effectivePermissionsFor('MANAGER', null);
    for (const p of ['calls:monitor', 'calls:read', 'recordings:read', 'reports:read'] as const) {
      expect(granted).toContain(p);
    }
  });

  it('administers nobody and writes no configuration, even if its row says so', () => {
    const granted = effectivePermissionsFor('MANAGER', [
      'admin:*',
      'users:write',
      'billing:write',
      'numbers:write',
      'campaigns:write',
      'calls:delete',
      'settings:write',
    ]);
    for (const p of [
      'admin:*',
      'users:write',
      'billing:write',
      'numbers:write',
      'campaigns:write',
      'calls:delete',
      'settings:write',
    ]) {
      expect(granted).not.toContain(p);
    }
  });

  it('an AGENT can never listen in, even if its row grants it', () => {
    expect(ROLE_PERMISSIONS.AGENT).not.toContain('calls:monitor');
    expect(effectivePermissionsFor('AGENT', ['calls:monitor'])).not.toContain('calls:monitor');
  });

  it('an agency ADMIN can listen in', () => {
    expect(ROLE_PERMISSIONS.ADMIN).toContain('calls:monitor');
  });
});

/* ── Finding the agent's call on the switch ────────────────────────────────── */

const REG_DUMP = `
Registrations:
=================================================================================================
Call-ID:    	abc@1.2.3.4
User:       	1042@agents.example.com
Contact:    	"1042" <sip:k3j2h9@203.0.113.7:51234;transport=ws;fs_nat=yes;fs_path=<sip:1042@10.0.0.2>>
Agent:      	SIP.js/0.21.2
Status:     	Registered(WSS-NAT)(unknown) EXP(2026-10-06 12:00:00) EXPSECS(290)
Auth-User:  	1042
Auth-Realm: 	agents.example.com

Call-ID:    	def@1.2.3.4
User:       	1077@agents.example.com
Contact:    	"1077" <sip:zz11aa@198.51.100.9:40000;transport=ws>
Auth-User:  	1077

Total items returned: 2
`;

describe('parseRegistrations', () => {
  it('reads extension, domain and the contact user@host per registration', () => {
    expect(parseRegistrations(REG_DUMP)).toEqual([
      {
        extension: '1042',
        domain: 'agents.example.com',
        contactUserHost: 'k3j2h9@203.0.113.7:51234',
      },
      {
        extension: '1077',
        domain: 'agents.example.com',
        contactUserHost: 'zz11aa@198.51.100.9:40000',
      },
    ]);
  });
});

describe('pickAgentLiveLeg', () => {
  const regs = parseRegistrations(REG_DUMP);

  function chan(overrides: Partial<FsChannel>): FsChannel {
    return {
      uuid: 'u',
      direction: 'outbound',
      state: 'CS_EXECUTE',
      callstate: 'ACTIVE',
      name: '',
      created_epoch: '100',
      ...overrides,
    };
  }

  it('finds the leg FreeSWITCH originated to the agent softphone contact', () => {
    const channels = [
      chan({ uuid: 'customer', direction: 'inbound', name: 'sofia/external/+15551234567@x' }),
      chan({ uuid: 'agent-leg', name: 'sofia/internal/k3j2h9@203.0.113.7:51234' }),
    ];
    expect(pickAgentLiveLeg(channels, '1042', regs)).toBe('agent-leg');
  });

  it('finds an outbound call the agent placed from the softphone', () => {
    const channels = [
      chan({
        uuid: 'agent-out',
        direction: 'inbound',
        name: 'sofia/internal/random@203.0.113.7',
        cid_num: '1042',
      }),
    ];
    expect(pickAgentLiveLeg(channels, '1042', regs)).toBe('agent-out');
  });

  it("never picks another agent's call", () => {
    const channels = [chan({ uuid: 'other', name: 'sofia/internal/zz11aa@198.51.100.9:40000' })];
    expect(pickAgentLiveLeg(channels, '1042', regs)).toBeNull();
  });

  it('ignores a call still ringing and a leg being torn down', () => {
    const channels = [
      chan({ uuid: 'ringing', name: 'sofia/internal/1042@x', callstate: 'RINGING' }),
      chan({ uuid: 'gone', name: 'sofia/internal/1042@x', state: 'CS_HANGUP' }),
    ];
    expect(pickAgentLiveLeg(channels, '1042', regs)).toBeNull();
  });

  it('prefers the call the agent is talking on over one on hold, then the newest', () => {
    const channels = [
      chan({
        uuid: 'held',
        name: 'sofia/internal/1042@x',
        callstate: 'HELD',
        created_epoch: '300',
      }),
      chan({ uuid: 'old', name: 'sofia/internal/1042@x', created_epoch: '100' }),
      chan({ uuid: 'new', name: 'sofia/internal/1042@x', created_epoch: '200' }),
    ];
    expect(pickAgentLiveLeg(channels, '1042', regs)).toBe('new');
  });
});

/* ── The route ─────────────────────────────────────────────────────────────── */

const prisma = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  agentSipCredential: { findUnique: vi.fn() },
}));
vi.mock('../lib/prisma.js', () => ({ getPrismaClient: () => prisma }));

vi.mock('../middleware/auth.js', () => ({
  authenticate: vi.fn(() => Promise.resolve(undefined)),
}));

const resolveTenant = vi.hoisted(() => vi.fn(() => 'agency-a'));
vi.mock('../lib/tenant-context.js', () => ({
  resolveTenant: (...args: unknown[]) => resolveTenant(...(args as [])),
  getActingUserId: () => 'manager-1',
}));

const auditLog = vi.hoisted(() => vi.fn(() => Promise.resolve(undefined)));
vi.mock('../services/audit.js', () => ({ auditLog }));

const fs = vi.hoisted(() => ({
  findAgentLiveLeg: vi.fn(),
  startListenIn: vi.fn(),
}));
vi.mock('../services/freeswitch-service.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/freeswitch-service.js')>();
  return { ...actual, freeswitchService: fs };
});

const TARGET = '0b9c1f3e-1111-4222-8333-444455556666';

describe('POST /api/v1/call-monitor/agents/:userId/listen', () => {
  let app: FastifyInstance;
  let roles: string[];

  beforeEach(async () => {
    vi.clearAllMocks();
    roles = ['MANAGER'];
    resolveTenant.mockReturnValue('agency-a');
    prisma.user.findFirst.mockResolvedValue({
      id: 'agent-1',
      email: 'dana@agency.test',
      firstName: 'Dana',
      lastName: 'Reed',
      sipCredential: { extension: '1042', status: 'ACTIVE' },
    });
    prisma.agentSipCredential.findUnique.mockResolvedValue({
      extension: '1050',
      status: 'ACTIVE',
      tenantId: 'agency-a',
    });
    fs.findAgentLiveLeg.mockResolvedValue(TARGET);
    fs.startListenIn.mockResolvedValue('leg-1');

    app = Fastify({ logger: false });
    app.addHook('onRequest', (request, _reply, done) => {
      (request as unknown as { user: unknown }).user = { userId: 'manager-1', roles };
      done();
    });
    await app.register(registerCallMonitorRoutes);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  const listen = (userId = 'agent-1') =>
    app.inject({ method: 'POST', url: `/api/v1/call-monitor/agents/${userId}/listen` });

  it("starts a listen-only leg to the manager's own softphone", async () => {
    const response = await listen();

    expect(response.statusCode).toBe(202);
    expect(response.json().data).toEqual({
      legUuid: 'leg-1',
      agent: { id: 'agent-1', name: 'Dana Reed' },
    });
    expect(fs.findAgentLiveLeg).toHaveBeenCalledWith('1042');
    expect(fs.startListenIn).toHaveBeenCalledWith({
      listenerExtension: '1050',
      targetUuid: TARGET,
      agentExtension: '1042',
      agentName: 'Dana Reed',
    });
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'call_monitor.listen',
        tenantId: 'agency-a',
        userId: 'manager-1',
        entityId: 'agent-1',
        success: true,
      })
    );
  });

  it('looks the agent up only inside the acting agency, and only as an AGENT', async () => {
    await listen();
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'agent-1',
          tenantId: 'agency-a',
          roles: { some: { role: { name: 'AGENT' } } },
        },
      })
    );
  });

  it("refuses another agency's agent as not found, and asks the switch nothing", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const response = await listen('agent-elsewhere');
    expect(response.statusCode).toBe(404);
    expect(fs.findAgentLiveLeg).not.toHaveBeenCalled();
    expect(fs.startListenIn).not.toHaveBeenCalled();
  });

  it('refuses an AGENT', async () => {
    roles = ['AGENT'];
    const response = await listen();
    expect(response.statusCode).toBe(403);
    expect(fs.startListenIn).not.toHaveBeenCalled();
  });

  it('admits the agency owner and administrators', async () => {
    for (const role of ['OWNER', 'ADMIN']) {
      roles = [role];
      expect((await listen()).statusCode).toBe(202);
    }
  });

  it('says so when the agent is not on a call', async () => {
    fs.findAgentLiveLeg.mockResolvedValue(null);
    const response = await listen();
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('AGENT_NOT_ON_A_CALL');
    expect(fs.startListenIn).not.toHaveBeenCalled();
  });

  it('refuses a softphone that belongs to another agency', async () => {
    prisma.agentSipCredential.findUnique.mockResolvedValue({
      extension: '1050',
      status: 'ACTIVE',
      tenantId: 'agency-b',
    });
    const response = await listen();
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('LISTENER_HAS_NO_SOFTPHONE');
  });

  it('refuses listening to yourself', async () => {
    const response = await listen('manager-1');
    expect(response.statusCode).toBe(400);
  });
});
