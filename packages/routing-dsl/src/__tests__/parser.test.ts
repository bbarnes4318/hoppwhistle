import { describe, it, expect } from 'vitest';

import { simpleDirectRouteFlow, ivrWithDTMFFlow, buyerRotationFlow } from '../examples.js';
import { parseFlow, createExecutionPlan, parseAndPlan } from '../parser.js';

describe('Flow Parser', () => {
  describe('parseFlow', () => {
    it('should parse a valid flow', () => {
      const flow = parseFlow(simpleDirectRouteFlow);
      expect(flow.id).toBe('simple-direct-route');
      expect(flow.nodes.length).toBe(2);
    });

    it('should parse flow from JSON string', () => {
      const json = JSON.stringify(simpleDirectRouteFlow);
      const flow = parseFlow(json);
      expect(flow.id).toBe('simple-direct-route');
    });

    it('should throw error for invalid flow', () => {
      expect(() => {
        parseFlow({ invalid: 'data' });
      }).toThrow();
    });

    it('should throw error if entry target does not exist', () => {
      const invalidFlow = {
        ...simpleDirectRouteFlow,
        entry: {
          ...simpleDirectRouteFlow.entry,
          target: 'non-existent-node',
        },
      };

      expect(() => {
        parseFlow(invalidFlow);
      }).toThrow('not found in nodes');
    });

    it('should throw error if node references non-existent node', () => {
      const invalidFlow = {
        ...simpleDirectRouteFlow,
        nodes: [
          {
            id: 'tag-1',
            type: 'tag',
            tags: {},
            next: 'non-existent-node',
          },
        ],
      };

      expect(() => {
        parseFlow(invalidFlow);
      }).toThrow('references non-existent node');
    });
  });

  describe('createExecutionPlan', () => {
    it('should create execution plan from flow', () => {
      const plan = createExecutionPlan(simpleDirectRouteFlow);
      expect(plan.flowId).toBe('simple-direct-route');
      expect(plan.entryNodeId).toBe('tag-1');
      expect(plan.nodes['tag-1']).toBeDefined();
    });

    it('should throw error for duplicate node IDs', () => {
      const invalidFlow = {
        ...simpleDirectRouteFlow,
        nodes: [
          { id: 'tag-1', type: 'tag', tags: {} },
          { id: 'tag-1', type: 'tag', tags: {} }, // Duplicate
        ],
      };

      expect(() => {
        createExecutionPlan(invalidFlow);
      }).toThrow('Duplicate node ID');
    });
  });

  describe('parseAndPlan', () => {
    it('should parse and create plan in one step', () => {
      const plan = parseAndPlan(simpleDirectRouteFlow);
      expect(plan.flowId).toBe('simple-direct-route');
      expect(plan.nodes).toBeDefined();
    });
  });

  describe('complex flows', () => {
    it('should parse IVR flow', () => {
      const flow = parseFlow(ivrWithDTMFFlow);
      expect(flow.nodes.find((n) => n.type === 'ivr')).toBeDefined();
    });

    it('should parse buyer rotation flow', () => {
      const flow = parseFlow(buyerRotationFlow);
      const buyerNode = flow.nodes.find((n) => n.type === 'buyer');
      expect(buyerNode).toBeDefined();
      if (buyerNode && buyerNode.type === 'buyer') {
        expect(buyerNode.buyers.length).toBeGreaterThan(0);
      }
    });
  });
});

