import * as fs from 'fs';
import * as path from 'path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { validateAndResolveCallerId } from '../caller-id-service.js';

describe('Secure SIP & FracTEL Hardening Enforcement', () => {
  const rootDir = path.resolve(__dirname, '../../../../../');

  // ────────────────────────────────────────────────────────────────────────────
  // 1. Dialplan Hardcoded Production DID Audit
  // ────────────────────────────────────────────────────────────────────────────
  describe('Dialplan Static Inspection', () => {
    it('must not contain hardcoded production DID 19138999080 in any FreeSWITCH dialplan', () => {
      const dialplanDir = path.join(rootDir, 'apps/freeswitch/conf/dialplan');
      const files = fs.readdirSync(dialplanDir);

      for (const file of files) {
        if (file.endsWith('.xml')) {
          const content = fs.readFileSync(path.join(dialplanDir, file), 'utf8');
          expect(content, `Hardcoded DID 19138999080 found in ${file}`).not.toContain('19138999080');
        }
      }
    });

    it('must not contain hardcoded production DID fallbacks (12816991120) in dialplans', () => {
      const dialplanDir = path.join(rootDir, 'apps/freeswitch/conf/dialplan');
      const files = fs.readdirSync(dialplanDir);

      for (const file of files) {
        if (file.endsWith('.xml')) {
          const content = fs.readFileSync(path.join(dialplanDir, file), 'utf8');
          expect(content, `Hardcoded fallback 12816991120 found in ${file}`).not.toContain(
            '12816991120'
          );
        }
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 2. FracTEL Gateway Definitions & References Audit
  // ────────────────────────────────────────────────────────────────────────────
  describe('FracTEL Gateway Infrastructure', () => {
    it('must define all six FracTEL gateways (fractel1 through fractel6) in external profile', () => {
      const fractelXmlPath = path.join(
        rootDir,
        'apps/freeswitch/conf/sip_profiles/external/fractel.xml'
      );
      expect(fs.existsSync(fractelXmlPath)).toBe(true);

      const content = fs.readFileSync(fractelXmlPath, 'utf8');
      for (let i = 1; i <= 6; i++) {
        expect(content, `Missing gateway definition for fractel${i}`).toContain(
          `<gateway name="fractel${i}">`
        );
      }
    });

    it('must reference all six FracTEL gateways in bridge strings in default.xml and vapi_outbound.xml', () => {
      const defaultXml = fs.readFileSync(
        path.join(rootDir, 'apps/freeswitch/conf/dialplan/default.xml'),
        'utf8'
      );
      const vapiOutboundXml = fs.readFileSync(
        path.join(rootDir, 'apps/freeswitch/conf/dialplan/vapi_outbound.xml'),
        'utf8'
      );

      for (let i = 1; i <= 6; i++) {
        const gwRef = `sofia/gateway/fractel${i}/`;
        expect(defaultXml, `default.xml missing reference to fractel${i}`).toContain(gwRef);
        expect(vapiOutboundXml, `vapi_outbound.xml missing reference to fractel${i}`).toContain(
          gwRef
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 3. Docker & Entrypoint Substitution Audit
  // ────────────────────────────────────────────────────────────────────────────
  describe('Environment Variable Substitution & Compose', () => {
    it('must substitute FRACTEL_DEFAULT_CALLER_ID in docker-entrypoint.sh', () => {
      const entrypointPath = path.join(rootDir, 'apps/freeswitch/docker-entrypoint.sh');
      const content = fs.readFileSync(entrypointPath, 'utf8');
      expect(content).toContain('FRACTEL_DEFAULT_CALLER_ID');
      expect(content).toContain('vars.xml');
    });

    it('must not contain hardcoded production DID fallbacks (12816991120) in Docker Compose files', () => {
      const composeFile = path.join(rootDir, 'infra/docker/docker-compose.yml');
      const composeDevFile = path.join(rootDir, 'infra/docker/docker-compose.dev.yml');

      const composeContent = fs.readFileSync(composeFile, 'utf8');
      const composeDevContent = fs.readFileSync(composeDevFile, 'utf8');

      expect(composeContent).not.toContain('12816991120');
      expect(composeDevContent).not.toContain('12816991120');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  // 4. Server-Side Caller ID Validation & Resolution Hierarchy
  // ────────────────────────────────────────────────────────────────────────────
  describe('Caller ID Resolution & Fail-Closed Behavior', () => {
    const originalEnv = process.env.FRACTEL_DEFAULT_CALLER_ID;

    beforeEach(() => {
      process.env.FRACTEL_DEFAULT_CALLER_ID = '12058869796';
    });

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.FRACTEL_DEFAULT_CALLER_ID = originalEnv;
      } else {
        delete process.env.FRACTEL_DEFAULT_CALLER_ID;
      }
    });

    it('falls back to valid FRACTEL_DEFAULT_CALLER_ID when requested caller ID is invalid or missing', async () => {
      const result = await validateAndResolveCallerId({
        requestedCallerId: 'invalid-number',
        tenantId: 'tenant-abc',
      });

      expect(result.valid).toBe(true);
      expect(result.callerId).toBe('12058869796');
      expect(result.source).toBe('fractel_default');
    });

    it('fails closed when requested caller ID is invalid/missing AND FRACTEL_DEFAULT_CALLER_ID is empty', async () => {
      delete process.env.FRACTEL_DEFAULT_CALLER_ID;

      const result = await validateAndResolveCallerId({
        requestedCallerId: '',
        tenantId: 'tenant-abc',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NO_VALID_TENANT_CALLER_ID');
      expect(result.callerId).toBeUndefined();
    });

    it('rejects fake or 555 demo numbers as requested caller IDs', async () => {
      delete process.env.FRACTEL_DEFAULT_CALLER_ID;

      const result = await validateAndResolveCallerId({
        requestedCallerId: '15551234567',
        tenantId: 'tenant-abc',
      });

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NO_VALID_TENANT_CALLER_ID');
    });
  });
});
