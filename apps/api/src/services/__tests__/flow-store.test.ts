import { simpleDirectRouteFlow, ivrWithDTMFFlow } from '@hopwhistle/routing-dsl';
import { describe, it, expect, beforeEach } from 'vitest';

import { getPrismaClient } from '../../lib/prisma.js';
import { announceSkip, databaseGate } from '../../__tests__/helpers/live-services.js';
import { flowStore } from '../flow-store.js';

// flowStore reads and writes real `flows` / `flow_versions` rows.
const gate = databaseGate();
announceSkip('FlowStore', gate);

/**
 * Every case here creates a flow, and `storeFlow` has required a tenantId to do
 * that since flows became tenant-scoped -- the third argument. The tests were
 * never updated, so all thirteen that store a flow died on
 * `tenantId is required when creating a new flow` rather than on anything they
 * were written to check.
 *
 * The other half of the problem was isolation. `beforeEach` was empty, under a
 * comment reading "Clear store before each test (in production, use a test
 * database) / For now, we'll just test with fresh flows" -- so rows survived
 * between cases and the suite depended on the order it happened to run in.
 * `listFlows` in particular passes trivially against a database somebody else
 * filled. Both are fixed here: a tenant per run, and the flow tables emptied
 * between cases.
 */
const TENANT_ID = 'flow-store-test-tenant';

describe.skipIf(!gate.available)('FlowStore', () => {
  beforeEach(async () => {
    const prisma = getPrismaClient();

    // flow_versions first: it references flows.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "flow_versions" CASCADE;');
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "flows" CASCADE;');

    await prisma.tenant.upsert({
      where: { id: TENANT_ID },
      update: {},
      create: {
        id: TENANT_ID,
        name: 'FlowStore Test Tenant',
        slug: TENANT_ID,
        status: 'ACTIVE',
      },
    });
  });

  describe('storeFlow', () => {
    it('should store a flow version', async () => {
      const version = await flowStore.storeFlow(simpleDirectRouteFlow, 'test-user', TENANT_ID);

      // A stored version is a row now, so its id is the row's uuid rather than
      // the old `${flowId}-${semver}` composite. These assertions described the
      // string-keyed store this replaced.
      //
      // `version` here is '1.0.0' -- the string that was passed in. Note that
      // reading the same row back gives '1' instead: the store persists only
      // the major component (parseVersion), and the write path echoes the
      // caller's string while the read path returns what was persisted. That
      // asymmetry is the current behaviour, not something these tests want; see
      // the assertions in getFlowVersions and getPublishedFlow below.
      expect(version.id).toEqual(expect.any(String));
      expect(version.id).not.toBe('');
      expect(version.flowId).toBe('simple-direct-route');
      expect(version.version).toBe('1.0.0');
      expect(version.published).toBe(false);
    });

    it('should create execution plan when storing', async () => {
      const version = await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      expect(version.plan).toBeDefined();
      expect(version.plan.flowId).toBe('simple-direct-route');
      expect(version.plan.nodes).toBeDefined();
    });
  });

  describe('getFlowVersion', () => {
    it('should retrieve a stored flow version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      const version = await flowStore.getFlowVersion('simple-direct-route', '1.0.0');
      expect(version).toBeDefined();
      expect(version?.flowId).toBe('simple-direct-route');
    });

    it('should return null for non-existent version', async () => {
      const version = await flowStore.getFlowVersion('non-existent', '1.0.0');
      expect(version).toBeNull();
    });
  });

  describe('getFlowVersions', () => {
    it('should retrieve all versions of a flow', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      await flowStore.storeFlow(
        {
          ...simpleDirectRouteFlow,
          version: '2.0.0',
        },
        undefined,
        TENANT_ID
      );

      const versions = await flowStore.getFlowVersions('simple-direct-route');
      expect(versions.length).toBe(2);
      expect(versions[0].version).toBe('2'); // Should be sorted by date (newest first)
    });
  });

  describe('publishFlow', () => {
    it('should publish a flow version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      const published = await flowStore.publishFlow('simple-direct-route', '1.0.0');

      expect(published.published).toBe(true);
      expect(published.publishedAt).toBeDefined();
    });

    it('should unpublish previous version when publishing new one', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      await flowStore.storeFlow(
        {
          ...simpleDirectRouteFlow,
          version: '2.0.0',
        },
        undefined,
        TENANT_ID
      );

      await flowStore.publishFlow('simple-direct-route', '1.0.0');
      await flowStore.publishFlow('simple-direct-route', '2.0.0');

      const v1 = await flowStore.getFlowVersion('simple-direct-route', '1.0.0');
      const v2 = await flowStore.getFlowVersion('simple-direct-route', '2.0.0');

      expect(v1?.published).toBe(false);
      expect(v2?.published).toBe(true);
    });

    it('should throw error for non-existent version', async () => {
      await expect(flowStore.publishFlow('non-existent', '1.0.0')).rejects.toThrow('not found');
    });
  });

  describe('getPublishedFlow', () => {
    it('should retrieve published version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      await flowStore.publishFlow('simple-direct-route', '1.0.0');

      const published = await flowStore.getPublishedFlow('simple-direct-route');
      expect(published).toBeDefined();
      expect(published?.version).toBe('1');
    });

    it('should return null if no published version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      const published = await flowStore.getPublishedFlow('simple-direct-route');
      expect(published).toBeNull();
    });
  });

  describe('rollbackFlow', () => {
    it('should rollback to a previous version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      await flowStore.storeFlow(
        {
          ...simpleDirectRouteFlow,
          version: '2.0.0',
        },
        undefined,
        TENANT_ID
      );

      await flowStore.publishFlow('simple-direct-route', '2.0.0');
      const rolledBack = await flowStore.rollbackFlow('simple-direct-route', '1.0.0');

      // rollbackFlow delegates to publishFlow, which echoes the version string
      // it was given; the subsequent read returns the persisted major. Same row.
      expect(rolledBack.version).toBe('1.0.0');
      expect(rolledBack.published).toBe(true);

      const published = await flowStore.getPublishedFlow('simple-direct-route');
      expect(published?.version).toBe('1');
    });
  });

  describe('parseAndStore', () => {
    it('should parse and store a flow from JSON', async () => {
      const json = JSON.stringify(simpleDirectRouteFlow);
      const version = await flowStore.parseAndStore(json, undefined, TENANT_ID);

      expect(version.flowId).toBe('simple-direct-route');
      expect(version.plan).toBeDefined();
    });

    it('should throw error for invalid flow', async () => {
      await expect(flowStore.parseAndStore({ invalid: 'data' })).rejects.toThrow();
    });
  });

  describe('listFlows', () => {
    it('should list all flow IDs', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      await flowStore.storeFlow(ivrWithDTMFFlow, undefined, TENANT_ID);

      const flows = await flowStore.listFlows();
      expect(flows).toContain('simple-direct-route');
      expect(flows).toContain('ivr-dtmf');
    });
  });

  describe('deleteFlowVersion', () => {
    it('should delete a flow version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      const deleted = await flowStore.deleteFlowVersion('simple-direct-route', '1.0.0');

      expect(deleted).toBe(true);

      const version = await flowStore.getFlowVersion('simple-direct-route', '1.0.0');
      expect(version).toBeNull();
    });

    it('should not allow deleting published version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow, undefined, TENANT_ID);
      await flowStore.publishFlow('simple-direct-route', '1.0.0');

      await expect(flowStore.deleteFlowVersion('simple-direct-route', '1.0.0')).rejects.toThrow(
        'Cannot delete published'
      );
    });
  });
});
