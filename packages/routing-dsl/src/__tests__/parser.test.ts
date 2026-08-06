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
      // The plan starts AT the entry node, not at the node after it.
      //
      // This previously expected 'tag-1', the entry's target. That reading
      // makes `executor.ts`'s `case 'entry'` unreachable and `EntryNodeSchema`
      // pointless as a member of the `Node` union, and leaves a field called
      // `entryNodeId` holding the id of the node *following* the entry.
      // Executing the entry node yields 'tag-1', which is what
      // executor.test.ts asserts.
      const plan = createExecutionPlan(simpleDirectRouteFlow);
      expect(plan.flowId).toBe('simple-direct-route');
      expect(plan.entryNodeId).toBe('entry-1');
      expect(plan.nodes['entry-1']).toBeDefined();
      expect(plan.nodes['tag-1']).toBeDefined();
    });

    it('rejects an entry whose target does not exist', () => {
      // Without this the flow stops on its first step, at runtime.
      expect(() =>
        createExecutionPlan({
          ...simpleDirectRouteFlow,
          entry: { id: 'entry-1', type: 'entry', target: 'nowhere' },
        })
      ).toThrow('not found in nodes');
    });

    it('should throw error for duplicate node IDs', () => {
      const invalidFlow = {
        ...simpleDirectRouteFlow,
        nodes: [
          { id: 'tag-1', type: 'tag' as const, tags: {} },
          { id: 'tag-1', type: 'tag' as const, tags: {} }, // Duplicate
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
      expect(flow.nodes.find(n => n.type === 'ivr')).toBeDefined();
    });

    it('should parse buyer rotation flow', () => {
      const flow = parseFlow(buyerRotationFlow);
      const buyerNode = flow.nodes.find(n => n.type === 'buyer');
      expect(buyerNode).toBeDefined();
      if (buyerNode && buyerNode.type === 'buyer') {
        expect(buyerNode.buyers.length).toBeGreaterThan(0);
      }
    });
  });
});
