import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { XMLParser } from 'fast-xml-parser';

const mockCalls = new Map<string, any>();
const mockPhoneNumbers = new Map<string, any>();
const mockIdentities = new Map<string, any>();

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
    update: vi.fn(async ({ where, data }: { where: any; data: any }) => {
      const call = mockCalls.get(where.id);
      if (call) {
        Object.assign(call, data);
      }
      return call;
    }),
  },
  phoneNumber: {
    findFirst: vi.fn(async ({ where }: { where: any }) => {
      if (where?.id && mockPhoneNumbers.has(where.id)) {
        return mockPhoneNumbers.get(where.id);
      }
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
  sipIdentity: {
    findUnique: vi.fn(async ({ where }: { where: any }) => {
      if (where?.userId) {
        for (const iden of mockIdentities.values()) {
          if (iden.userId === where.userId) return iden;
        }
      }
      if (where?.domain_extension) {
        const key = `${where.domain_extension.domain}:${where.domain_extension.extension}`;
        return mockIdentities.get(key) || null;
      }
      return null;
    }),
    findMany: vi.fn(async () => Array.from(mockIdentities.values())),
    create: vi.fn(async ({ data }: { data: any }) => {
      const key = `${data.domain}:${data.extension}`;
      const rec = { id: `id-${data.extension}`, ...data };
      mockIdentities.set(key, rec);
      return rec;
    }),
    update: vi.fn(async ({ where, data }: { where: any; data: any }) => {
      for (const [k, v] of mockIdentities.entries()) {
        if (v.id === where.id) {
          Object.assign(v, data);
          return v;
        }
      }
      return null;
    }),
  },
  $transaction: vi.fn(async (cb: any) => cb(prismaMock)),
};

vi.mock('../../lib/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

import {
  deriveSipPassword,
  verifyInternalApiKey,
  verifyDirectoryInternalApiKey,
  provisionExtensionForUser,
  renderDirectoryXmlForExtension,
  createSignedContextToken,
  verifySignedContextToken,
  resolveCallerIdForInternalCall,
  resolveCallerIdForAuthenticatedOriginate,
} from '../caller-id-service.js';

describe('Secure SIP, Dynamic Directory & FracTEL Hardening Suite', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.SIP_CREDENTIAL_MASTER_SECRET = '0123456789abcdef0123456789abcdef';
    process.env.CALL_CONTEXT_SIGNING_SECRET = '9876543210fedcba9876543210fedcba';
    process.env.INTERNAL_API_SECRET = 'test-internal-secret-key-12345';
    process.env.DIRECTORY_INTERNAL_API_SECRET = 'test-dir-secret-key-12345';
    process.env.FRACTEL_DEFAULT_CALLER_ID = '12814009999';
    mockCalls.clear();
    mockPhoneNumbers.clear();
    mockIdentities.clear();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('HMAC Password Derivation & Domain Separation', () => {
    it('produces unique HMAC credentials across tenant, user, domain, extension, version, and master secret', () => {
      const p1 = deriveSipPassword({ tenantId: 't1', userId: 'u1', extension: '1000', credentialVersion: 1 });
      const p2 = deriveSipPassword({ tenantId: 't2', userId: 'u1', extension: '1000', credentialVersion: 1 });
      const p3 = deriveSipPassword({ tenantId: 't1', userId: 'u2', extension: '1000', credentialVersion: 1 });
      const p4 = deriveSipPassword({ tenantId: 't1', userId: 'u1', extension: '1001', credentialVersion: 1 });
      const p5 = deriveSipPassword({ tenantId: 't1', userId: 'u1', extension: '1000', credentialVersion: 2 });

      expect(p1.length).toBeGreaterThanOrEqual(32);
      expect(p1).not.toEqual(p2);
      expect(p1).not.toEqual(p3);
      expect(p1).not.toEqual(p4);
      expect(p1).not.toEqual(p5);
    });

    it('fails if master secret is missing or insecure', () => {
      expect(() =>
        deriveSipPassword({ tenantId: 't1', userId: 'u1', extension: '1000', masterSecret: '1234' })
      ).toThrow();
    });
  });

  describe('Dynamic FreeSWITCH XML Directory Rendering', () => {
    it('returns valid FreeSWITCH XML directory for active SipIdentity', async () => {
      mockIdentities.set('freeswitch:1000', {
        id: 'id-1000',
        tenantId: 'tenant-1',
        userId: 'user-1',
        domain: 'freeswitch',
        extension: '1000',
        credentialVersion: 1,
        status: 'ACTIVE',
      });

      const xml = await renderDirectoryXmlForExtension({
        user: '1000',
        domain: 'freeswitch',
        apiKey: 'test-dir-secret-key-12345',
      });

      const parser = new XMLParser();
      expect(() => parser.parse(xml)).not.toThrow();
      expect(xml).toContain('<user id="1000">');
      expect(xml).toContain('<param name="password" value=');
    });

    it('returns not found XML for missing or invalid API key', async () => {
      const xml = await renderDirectoryXmlForExtension({
        user: '1000',
        apiKey: 'wrong-key',
      });
      expect(xml).toContain('<result status="not found"/>');
    });
  });

  describe('Transactional SipIdentity Extension Provisioning', () => {
    it('provisions extension in 1000-1099 range', async () => {
      const res = await provisionExtensionForUser({ tenantId: 't1', userId: 'u1' });
      expect(res.extension).toBe('1000');
      expect(res.credentialVersion).toBe(1);
    });
  });

  describe('Signed Context Security & Token Verification', () => {
    it('creates and verifies signed context token', () => {
      const token = createSignedContextToken({
        tenantId: 't1',
        fromNumberId: 'pn1',
        callerId: '12814001111',
        destination: '12815551234',
        sourceType: 'vapi',
      });

      const verified = verifySignedContextToken(token);
      expect(verified).not.toBeNull();
      expect(verified?.tenantId).toBe('t1');
      expect(verified?.callerId).toBe('12814001111');
    });

    it('rejects tampered or expired signed context token', () => {
      const token = createSignedContextToken({
        tenantId: 't1',
        fromNumberId: 'pn1',
        callerId: '12814001111',
        destination: '12815551234',
        sourceType: 'vapi',
      }, -10);

      expect(verifySignedContextToken(token)).toBeNull();
    });
  });

  describe('Internal Call Validation & Channel Replay Controls', () => {
    it('validates call record and binds channel UUID', async () => {
      const call = {
        id: 'call-1',
        status: 'INITIATED',
        startedAt: new Date(),
        toNumber: '12815551234',
        createdById: 'u1',
        fromNumberId: 'pn1',
        tenantId: 't1',
        callerId: '12814001111',
        metadata: {},
      };
      mockCalls.set(call.id, call);

      const pn = {
        id: 'pn1',
        tenantId: 't1',
        number: '12814001111',
        status: 'ACTIVE',
        provider: 'fractel',
      };
      mockPhoneNumbers.set(pn.id, pn);

      mockIdentities.set('freeswitch:1000', {
        id: 'id-1000',
        tenantId: 't1',
        userId: 'u1',
        domain: 'freeswitch',
        extension: '1000',
        status: 'ACTIVE',
      });

      const res = await resolveCallerIdForInternalCall({
        callId: 'call-1',
        destination: '12815551234',
        sipUser: '1000',
        channelUuid: 'chan-uuid-1',
        internalApiKey: 'test-internal-secret-key-12345',
      });

      expect(res.valid).toBe(true);
      expect(res.callerId).toBe('12814001111');

      // Attempt replay with different channel UUID
      const replayRes = await resolveCallerIdForInternalCall({
        callId: 'call-1',
        destination: '12815551234',
        sipUser: '1000',
        channelUuid: 'chan-uuid-2',
        internalApiKey: 'test-internal-secret-key-12345',
      });
      expect(replayRes.valid).toBe(false);
      expect(replayRes.reason).toBe('REPLAY_CHANNEL_REUSED');
    });
  });
});
