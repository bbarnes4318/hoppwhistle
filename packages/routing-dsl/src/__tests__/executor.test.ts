import { describe, it, expect } from 'vitest';

import { simpleDirectRouteFlow, ivrWithDTMFFlow } from '../examples.js';
import { executeNode, type ExecutionPlan, type ExecutionContext } from '../executor.js';
import { parseAndPlan } from '../parser.js';

describe('Flow Executor', () => {
  describe('executeNode', () => {
    it('should execute entry node', () => {
      const plan = parseAndPlan(simpleDirectRouteFlow);
      const context: ExecutionContext = {
        callId: 'test-call',
        tenantId: 'test-tenant',
        currentNodeId: plan.entryNodeId,
        variables: {},
        history: [],
        tags: {},
      };

      const result = executeNode(plan, context);
      expect(result.nextNodeId).toBe('tag-1');
      expect(result.action.type).toBe('continue');
    });

    it('should execute tag node', () => {
      const plan = parseAndPlan(simpleDirectRouteFlow);
      const context: ExecutionContext = {
        callId: 'test-call',
        tenantId: 'test-tenant',
        currentNodeId: 'tag-1',
        variables: {},
        history: [],
        tags: {},
      };

      const result = executeNode(plan, context);
      expect(result.context.tags).toHaveProperty('route');
      expect(result.nextNodeId).toBe('hangup-1');
    });

    it('should execute hangup node', () => {
      const plan = parseAndPlan(simpleDirectRouteFlow);
      const context: ExecutionContext = {
        callId: 'test-call',
        tenantId: 'test-tenant',
        currentNodeId: 'hangup-1',
        variables: {},
        history: [],
        tags: {},
      };

      const result = executeNode(plan, context);
      expect(result.action.type).toBe('hangup');
      expect(result.nextNodeId).toBeNull();
    });

    it('should execute IVR node and wait for DTMF', () => {
      const plan = parseAndPlan(ivrWithDTMFFlow);
      const context: ExecutionContext = {
        callId: 'test-call',
        tenantId: 'test-tenant',
        currentNodeId: 'ivr-1',
        variables: {},
        history: [],
        tags: {},
      };

      const result = executeNode(plan, context);
      expect(result.action.type).toBe('play');
      expect(result.nextNodeId).toBeNull(); // Waiting for DTMF
    });

    it('should execute IVR node with DTMF input', () => {
      const plan = parseAndPlan(ivrWithDTMFFlow);
      const context: ExecutionContext = {
        callId: 'test-call',
        tenantId: 'test-tenant',
        currentNodeId: 'ivr-1',
        variables: {},
        history: [],
        tags: {},
        ivrInput: '1',
      };

      const result = executeNode(plan, context, {
        type: 'dtmf.received',
        callId: 'test-call',
        digits: '1',
      });

      expect(result.nextNodeId).toBe('queue-sales');
    });

    it('should execute if node with true condition', () => {
      const plan = parseAndPlan({
        id: 'test-if',
        name: 'Test If',
        version: '1.0.0',
        entry: {
          id: 'entry-1',
          type: 'entry',
          target: 'if-1',
        },
        nodes: [
          {
            id: 'if-1',
            type: 'if',
            condition: 'true',
            then: 'tag-true',
            else: 'tag-false',
          },
          {
            id: 'tag-true',
            type: 'tag',
            tags: { result: 'true' },
          },
          {
            id: 'tag-false',
            type: 'tag',
            tags: { result: 'false' },
          },
        ],
      });

      const context: ExecutionContext = {
        callId: 'test-call',
        tenantId: 'test-tenant',
        currentNodeId: 'if-1',
        variables: {},
        history: [],
        tags: {},
      };

      const result = executeNode(plan, context);
      expect(result.nextNodeId).toBe('tag-true');
    });

    it('should throw error for unknown node', () => {
      const plan: ExecutionPlan = {
        flowId: 'test',
        flowVersion: '1.0.0',
        entryNodeId: 'node-1',
        nodes: {},
      };

      const context: ExecutionContext = {
        callId: 'test-call',
        tenantId: 'test-tenant',
        currentNodeId: 'node-1',
        variables: {},
        history: [],
        tags: {},
      };

      expect(() => {
        executeNode(plan, context);
      }).toThrow('not found in plan');
    });
  });
});

