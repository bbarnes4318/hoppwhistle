import { simpleDirectRouteFlow, ivrWithDTMFFlow } from '@hopwhistle/routing-dsl';
import { describe, it, expect, beforeEach } from 'vitest';

import { flowStore } from '../flow-store.js';

describe('FlowStore', () => {
  beforeEach(() => {
    // Clear store before each test (in production, use a test database)
    // For now, we'll just test with fresh flows
  });

  describe('storeFlow', () => {
    it('should store a flow version', async () => {
      const version = await flowStore.storeFlow(simpleDirectRouteFlow, 'test-user');
      expect(version.id).toBe('simple-direct-route-1.0.0');
      expect(version.flowId).toBe('simple-direct-route');
      expect(version.version).toBe('1.0.0');
      expect(version.published).toBe(false);
    });

    it('should create execution plan when storing', async () => {
      const version = await flowStore.storeFlow(simpleDirectRouteFlow);
      expect(version.plan).toBeDefined();
      expect(version.plan.flowId).toBe('simple-direct-route');
      expect(version.plan.nodes).toBeDefined();
    });
  });

  describe('getFlowVersion', () => {
    it('should retrieve a stored flow version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow);
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
      await flowStore.storeFlow(simpleDirectRouteFlow);
      await flowStore.storeFlow({
        ...simpleDirectRouteFlow,
        version: '2.0.0',
      });

      const versions = await flowStore.getFlowVersions('simple-direct-route');
      expect(versions.length).toBe(2);
      expect(versions[0].version).toBe('2.0.0'); // Should be sorted by date (newest first)
    });
  });

  describe('publishFlow', () => {
    it('should publish a flow version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow);
      const published = await flowStore.publishFlow('simple-direct-route', '1.0.0');

      expect(published.published).toBe(true);
      expect(published.publishedAt).toBeDefined();
    });

    it('should unpublish previous version when publishing new one', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow);
      await flowStore.storeFlow({
        ...simpleDirectRouteFlow,
        version: '2.0.0',
      });

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
      await flowStore.storeFlow(simpleDirectRouteFlow);
      await flowStore.publishFlow('simple-direct-route', '1.0.0');

      const published = await flowStore.getPublishedFlow('simple-direct-route');
      expect(published).toBeDefined();
      expect(published?.version).toBe('1.0.0');
    });

    it('should return null if no published version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow);
      const published = await flowStore.getPublishedFlow('simple-direct-route');
      expect(published).toBeNull();
    });
  });

  describe('rollbackFlow', () => {
    it('should rollback to a previous version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow);
      await flowStore.storeFlow({
        ...simpleDirectRouteFlow,
        version: '2.0.0',
      });

      await flowStore.publishFlow('simple-direct-route', '2.0.0');
      const rolledBack = await flowStore.rollbackFlow('simple-direct-route', '1.0.0');

      expect(rolledBack.version).toBe('1.0.0');
      expect(rolledBack.published).toBe(true);

      const published = await flowStore.getPublishedFlow('simple-direct-route');
      expect(published?.version).toBe('1.0.0');
    });
  });

  describe('parseAndStore', () => {
    it('should parse and store a flow from JSON', async () => {
      const json = JSON.stringify(simpleDirectRouteFlow);
      const version = await flowStore.parseAndStore(json);

      expect(version.flowId).toBe('simple-direct-route');
      expect(version.plan).toBeDefined();
    });

    it('should throw error for invalid flow', async () => {
      await expect(flowStore.parseAndStore({ invalid: 'data' })).rejects.toThrow();
    });
  });

  describe('listFlows', () => {
    it('should list all flow IDs', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow);
      await flowStore.storeFlow(ivrWithDTMFFlow);

      const flows = await flowStore.listFlows();
      expect(flows).toContain('simple-direct-route');
      expect(flows).toContain('ivr-dtmf');
    });
  });

  describe('deleteFlowVersion', () => {
    it('should delete a flow version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow);
      const deleted = await flowStore.deleteFlowVersion('simple-direct-route', '1.0.0');

      expect(deleted).toBe(true);

      const version = await flowStore.getFlowVersion('simple-direct-route', '1.0.0');
      expect(version).toBeNull();
    });

    it('should not allow deleting published version', async () => {
      await flowStore.storeFlow(simpleDirectRouteFlow);
      await flowStore.publishFlow('simple-direct-route', '1.0.0');

      await expect(flowStore.deleteFlowVersion('simple-direct-route', '1.0.0')).rejects.toThrow(
        'Cannot delete published'
      );
    });
  });
});
