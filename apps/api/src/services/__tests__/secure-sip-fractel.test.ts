import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';

const mockCalls = new Map<string, any>();
const mockPhoneNumbers = new Map<string, any>();

const prismaMock = {
  call: {
    findFirst: vi.fn(async ({ where }: { where: any }) => {
      const orConditions = where?.OR || [];
      for (const cond of orConditions) {
        const val = Object.values(cond)[0] as string;
        if (val && mockCalls.has(val)) {
          return mockCalls.get(val);
        }
      }
      return null;
    }),
  },
  phoneNumber: {
    findFirst: vi.fn(async ({ where }: { where: any }) => {
      const endNum = where?.number?.endsWith;
      for (const record of mockPhoneNumbers.values()) {
        if (endNum && record.number.endsWith(endNum)) {
          if (where.tenantId && record.tenantId !== where.tenantId) continue;
          if (where.status && record.status !== where.status) continue;
          return record;
        }
      }
      return null;
    }),
  },
};

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

import {
  validateAndResolveCallerId,
  verifyInternalApiKey,
} from '../caller-id-service.js';

describe('Secure SIP, Kamailio & FracTEL Hardening Test Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.INTERNAL_API_SECRET = 'test-internal-secret-key-12345';
    process.env.SIP_AGENT_PASSWORD = 'super-secret-agent-password-99';
    process.env.FRACTEL_DEFAULT_CALLER_ID = '12814009999';
    mockCalls.clear();
    mockPhoneNumbers.clear();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 1. Static Configuration & XML Validation
  // ════════════════════════════════════════════════════════════════════════════
  describe('FreeSWITCH & Kamailio XML/CFG Static Validation', () => {
    it('internal.xml must enforce mandatory SIP authentication and strict registration', () => {
      const xmlPath = resolve(process.cwd(), 'apps/freeswitch/conf/sip_profiles/internal.xml');
      expect(existsSync(xmlPath)).toBe(true);
      const content = readFileSync(xmlPath, 'utf8');

      const parser = new XMLParser();
      expect(() => parser.parse(content)).not.toThrow();

      expect(content).toContain('<param name="auth-calls" value="true"/>');
      expect(content).toContain('<param name="accept-blind-reg" value="false"/>');
      expect(content).toContain('<param name="accept-blind-auth" value="false"/>');
      expect(content).toContain('<param name="inbound-reg-force-matching-username" value="true"/>');
      expect(content).toContain('<param name="auth-require-user" value="true"/>');
      expect(content).not.toContain('/etc/freeswitch/letsencrypt');
    });

    it('default.xml and vapi_outbound.xml must parse as valid XML without raw unescaped ampersands', () => {
      const defaultPath = resolve(process.cwd(), 'apps/freeswitch/conf/dialplan/default.xml');
      const vapiPath = resolve(process.cwd(), 'apps/freeswitch/conf/dialplan/vapi_outbound.xml');
      const parser = new XMLParser();

      const defaultContent = readFileSync(defaultPath, 'utf8');
      const vapiContent = readFileSync(vapiPath, 'utf8');

      expect(() => parser.parse(defaultContent)).not.toThrow();
      expect(() => parser.parse(vapiContent)).not.toThrow();

      expect(defaultContent).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
      expect(vapiContent).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    });

    it('all six FracTEL gateways (fractel1..fractel6) must be defined and referenced', () => {
      const gwPath = resolve(process.cwd(), 'apps/freeswitch/conf/sip_profiles/external/fractel.xml');
      const defaultPath = resolve(process.cwd(), 'apps/freeswitch/conf/dialplan/default.xml');
      const vapiPath = resolve(process.cwd(), 'apps/freeswitch/conf/dialplan/vapi_outbound.xml');

      const gwContent = readFileSync(gwPath, 'utf8');
      const defaultContent = readFileSync(defaultPath, 'utf8');
      const vapiContent = readFileSync(vapiPath, 'utf8');

      for (let i = 1; i <= 6; i++) {
        const gwName = `fractel${i}`;
        expect(gwContent, `Gateway ${gwName} missing in fractel.xml`).toContain(`name="${gwName}"`);
        expect(defaultContent, `Gateway ${gwName} missing in default.xml`).toContain(`sofia/gateway/${gwName}/`);
        expect(vapiContent, `Gateway ${gwName} missing in vapi_outbound.xml`).toContain(`sofia/gateway/${gwName}/`);
      }
    });

    it('kamailio.cfg must reject public unauthenticated REGISTER and eliminate From header trust', () => {
      const cfgPath = resolve(process.cwd(), 'apps/kamailio/kamailio.cfg');
      expect(existsSync(cfgPath)).toBe(true);
      const content = readFileSync(cfgPath, 'utf8');

      expect(content).toContain('Forbidden - Public Registration Disabled');
      expect(content).not.toContain('demo-agent');
      expect(content).not.toContain('10[0-9][0-9]');
      expect(content).toContain('sip:freeswitch:5080');
    });

    it('docker-entrypoint.sh must fail startup if SIP_AGENT_PASSWORD is missing or 1234', () => {
      const entrypointPath = resolve(process.cwd(), 'apps/freeswitch/docker-entrypoint.sh');
      const content = readFileSync(entrypointPath, 'utf8');

      expect(content).toContain('SIP_AGENT_PASSWORD');
      expect(content).toContain('1234');
      expect(content).toContain('FATAL ERROR');
    });

    it('Compose files must not contain password 1234 or production DID fallbacks', () => {
      const composePath = resolve(process.cwd(), 'infra/docker/docker-compose.yml');
      const composeDevPath = resolve(process.cwd(), 'infra/docker/docker-compose.dev.yml');

      const c1 = readFileSync(composePath, 'utf8');
      const c2 = readFileSync(composeDevPath, 'utf8');

      expect(c1).not.toContain('12816991120');
      expect(c2).not.toContain('12816991120');
      expect(c1).not.toContain('1234');
      expect(c2).not.toContain('1234');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 2. Internal API Key & Authentication Security Tests
  // ════════════════════════════════════════════════════════════════════════════
  describe('Internal API Authentication Security', () => {
    it('verifyInternalApiKey timing-safe comparison accepts valid key and rejects missing/incorrect keys', () => {
      expect(verifyInternalApiKey('test-internal-secret-key-12345')).toBe(true);
      expect(verifyInternalApiKey('wrong-key')).toBe(false);
      expect(verifyInternalApiKey(null)).toBe(false);
      expect(verifyInternalApiKey(undefined)).toBe(false);
    });

    it('validateAndResolveCallerId returns 401/UNAUTHORIZED_INTERNAL_REQUEST when API key is missing or invalid', async () => {
      const resMissing = await validateAndResolveCallerId({ callId: 'call-100' });
      expect(resMissing.valid).toBe(false);
      expect(resMissing.reason).toBe('UNAUTHORIZED_INTERNAL_REQUEST');

      const resWrong = await validateAndResolveCallerId({
        callId: 'call-100',
        internalApiKey: 'invalid-key',
      });
      expect(resWrong.valid).toBe(false);
      expect(resWrong.reason).toBe('UNAUTHORIZED_INTERNAL_REQUEST');
    });

    it('validateAndResolveCallerId returns 403 when call ID is unknown and default CID is unvalidated', async () => {
      const res = await validateAndResolveCallerId({
        callId: 'unknown-call-999',
        internalApiKey: 'test-internal-secret-key-12345',
      });
      expect(res.valid).toBe(false);
      expect(res.reason).toBe('NO_VALID_TENANT_CALLER_ID');
    });
  });

  // ════════════════════════════════════════════════════════════════════════════
  // 3. Database Scoping & Multi-Tenant Isolation Tests
  // ════════════════════════════════════════════════════════════════════════════
  describe('Caller ID Tenant, User, Campaign & FracTEL Provider Authorization', () => {
    it('rejects cross-tenant caller ID requests when DID belongs to a different tenant', async () => {
      // Tenant A Call
      const call = {
        id: 'call-tenant-a',
        callSid: 'call-tenant-a',
        tenantId: 'tenant-A',
        callerId: '12814001111',
        createdById: 'user-a',
      };
      mockCalls.set(call.id, call);
      mockCalls.set(call.callSid, call);

      // Tenant B Phone Number
      const pn = {
        id: 'pn-tenant-b',
        number: '12814001111',
        tenantId: 'tenant-B', // Different tenant!
        status: 'ACTIVE',
        provider: 'fractel',
      };
      mockPhoneNumbers.set(pn.id, pn);

      const res = await validateAndResolveCallerId({
        callId: 'call-tenant-a',
        internalApiKey: 'test-internal-secret-key-12345',
      });

      expect(res.valid).toBe(false);
    });

    it('rejects caller ID when user is not authorized for assigned number', async () => {
      const call = {
        id: 'call-user-a',
        callSid: 'call-user-a',
        tenantId: 'tenant-A',
        callerId: '12814002222',
        createdById: 'user-A',
      };
      mockCalls.set(call.id, call);
      mockCalls.set(call.callSid, call);

      const pn = {
        id: 'pn-user-b',
        number: '12814002222',
        tenantId: 'tenant-A',
        userId: 'user-B', // Assigned to User B!
        status: 'ACTIVE',
        provider: 'fractel',
      };
      mockPhoneNumbers.set(pn.id, pn);

      const res = await validateAndResolveCallerId({
        callId: 'call-user-a',
        internalApiKey: 'test-internal-secret-key-12345',
      });

      expect(res.valid).toBe(false);
    });

    it('rejects non-FracTEL caller ID (e.g. telnyx, bandwidth, local)', async () => {
      const call = {
        id: 'call-telnyx',
        callSid: 'call-telnyx',
        tenantId: 'tenant-A',
        callerId: '12814003333',
      };
      mockCalls.set(call.id, call);
      mockCalls.set(call.callSid, call);

      const pn = {
        id: 'pn-telnyx',
        number: '12814003333',
        tenantId: 'tenant-A',
        status: 'ACTIVE',
        provider: 'telnyx', // Non-FracTEL provider!
      };
      mockPhoneNumbers.set(pn.id, pn);

      const res = await validateAndResolveCallerId({
        callId: 'call-telnyx',
        internalApiKey: 'test-internal-secret-key-12345',
      });

      expect(res.valid).toBe(false);
    });

    it('accepts valid, tenant-authorized FracTEL caller ID', async () => {
      const call = {
        id: 'call-valid',
        callSid: 'call-valid',
        tenantId: 'tenant-A',
        callerId: '12814004444',
        createdById: 'user-A',
      };
      mockCalls.set(call.id, call);
      mockCalls.set(call.callSid, call);

      const pn = {
        id: 'pn-valid',
        number: '12814004444',
        tenantId: 'tenant-A',
        userId: 'user-A',
        status: 'ACTIVE',
        provider: 'fractel',
      };
      mockPhoneNumbers.set(pn.id, pn);

      const res = await validateAndResolveCallerId({
        callId: 'call-valid',
        internalApiKey: 'test-internal-secret-key-12345',
      });

      expect(res.valid).toBe(true);
      expect(res.callerId).toBe('12814004444');
      expect(res.source).toBe('call_record');
    });
  });
});
