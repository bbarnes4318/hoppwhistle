import {
  type ExecutionPlan,
  type ExecutionContext,
  type TelephonyEvent,
  executeNode,
  type ExecutionResult,
} from '@hopwhistle/routing-dsl';

import { getPrismaClient } from '../lib/prisma.js';

import { callStateService } from './call-state.js';
import { carrierService } from './carrier-service.js';
import { cnamService } from './cnam-service.js';
import { compliancePolicyService } from './compliance-policy-service.js';
import { complianceService } from './compliance-service.js';
import { eventBus } from './event-bus.js';
import { stirShakenService } from './stir-shaken-service.js';

export interface FlowEngineOptions {
  callId: string;
  tenantId: string;
  plan: ExecutionPlan;
  initialVariables?: Record<string, unknown>;
}

export class FlowEngine {
  private callId: string;
  private tenantId: string;
  private plan: ExecutionPlan;
  private context: ExecutionContext;
  private isRunning = false;
  private prisma = getPrismaClient();

  constructor(options: FlowEngineOptions) {
    this.callId = options.callId;
    this.tenantId = options.tenantId;
    this.plan = options.plan;

    // Initialize execution context
    this.context = {
      callId: options.callId,
      tenantId: options.tenantId,
      currentNodeId: this.plan.entryNodeId,
      variables: options.initialVariables || {},
      history: [],
      tags: {},
    };
  }

  /**
   * Start flow execution
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Flow engine is already running');
    }

    this.isRunning = true;

    // Update call state
    await callStateService.setCallState({
      id: this.callId,
      tenantId: this.tenantId,
      status: 'initiated',
      current_node: this.context.currentNodeId,
      participants: [],
      timers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Execute initial node
    await this.executeNext();
  }

  /**
   * Process a telephony event and advance the flow
   */
  async processEvent(event: TelephonyEvent): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Flow engine is not running');
    }

    // Update context with event data
    if (event.type === 'dtmf.received') {
      this.context.ivrInput = event.digits;
    } else if (event.type === 'recording.completed') {
      this.context.recordingUrl = event.url;
    }

    // Execute current node with event
    await this.executeNext(event);
  }

  /**
   * Execute the next node in the flow
   */
  private async executeNext(event?: TelephonyEvent): Promise<void> {
    try {
      // Enrich context with lookup data before execution
      await this.enrichContextWithLookups();

      const result = executeNode(this.plan, this.context, event);

      // Update context
      this.context = result.context;

      // Update call state
      await callStateService.updateCallState(this.callId, {
        current_node: this.context.currentNodeId,
      });

      // Execute action
      await this.executeAction(result.action, result.nextNodeId);

      // If there's a next node, continue execution (unless it's a wait state)
      if (result.nextNodeId && this.shouldContinueImmediately(result.action)) {
        // Small delay to allow state updates
        await new Promise(resolve => setTimeout(resolve, 100));
        await this.executeNext();
      }
    } catch (error) {
      console.error('Error executing flow:', error);
      await this.handleError(error);
    }
  }

  /**
   * Enrich context with STIR/SHAKEN, CNAM, and carrier lookups
   */
  private async enrichContextWithLookups(): Promise<void> {
    try {
      // Get call details
      const call = await this.prisma.call.findUnique({
        where: { id: this.callId },
        select: {
          toNumber: true,
          fromNumberId: true,
        },
      });

      if (!call) {
        return;
      }

      // Get from number if available
      let fromNumber: string | null = null;
      if (call.fromNumberId) {
        const phoneNumber = await this.prisma.phoneNumber.findUnique({
          where: { id: call.fromNumberId },
          select: { number: true },
        });
        fromNumber = phoneNumber?.number || null;
      }

      // Perform lookups in parallel
      const [stirShaken, cnam, carrier] = await Promise.all([
        // STIR/SHAKEN lookup
        fromNumber
          ? stirShakenService
              .getAttestationByPhoneNumber(this.tenantId, fromNumber)
              .catch(() => null)
          : Promise.resolve(null),
        // CNAM lookup
        fromNumber
          ? cnamService.lookup(this.tenantId, fromNumber, { useCache: true }).catch(() => null)
          : Promise.resolve(null),
        // Carrier lookup
        call.toNumber
          ? carrierService
              .lookup(this.tenantId, call.toNumber, { useCache: true })
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      // Add to context variables for use in flow rules
      this.context.variables = {
        ...this.context.variables,
        stirShaken: stirShaken
          ? {
              attestation: stirShaken.attestation,
              identity: stirShaken.headers?.identity,
            }
          : null,
        cnam: cnam
          ? {
              callerName: cnam.callerName,
              provider: cnam.provider,
            }
          : null,
        carrier: carrier
          ? {
              name: carrier.carrier,
              lata: carrier.lata,
              ocn: carrier.ocn,
              provider: carrier.provider,
            }
          : null,
      };
    } catch (error) {
      console.error('Error enriching context with lookups:', error);
      // Don't throw - lookups are optional
    }
  }

  /**
   * Execute an action from a node execution
   */
  private async executeAction(
    action: ExecutionResult['action'],
    nextNodeId: string | null
  ): Promise<void> {
    switch (action.type) {
      case 'continue':
        // No action needed, just continue
        break;

      case 'play':
        // Publish event to trigger audio playback
        await eventBus.publish('call.*', {
          event: 'call.play',
          tenantId: this.tenantId,
          data: {
            callId: this.callId,
            action: 'play',
            params: action.params,
          },
        });
        break;

      case 'queue.join':
        await eventBus.publish('call.*', {
          event: 'call.queue.join',
          tenantId: this.tenantId,
          data: {
            callId: this.callId,
            action: 'queue.join',
            params: action.params,
          },
        });
        break;

      case 'queue.connect':
        await eventBus.publish('call.*', {
          event: 'call.queue.connected',
          tenantId: this.tenantId,
          data: {
            callId: this.callId,
            action: 'queue.connect',
            params: action.params,
          },
        });
        break;

      case 'buyer.route':
        // Check compliance before routing to buyer
        const complianceResult = await this.checkComplianceBeforeBuyerRoute(action.params);
        if (!complianceResult.allowed) {
          // Block call and log audit
          await this.handleComplianceBlock(complianceResult);
          return;
        }
        // Proceed with buyer route
        await eventBus.publish('call.*', {
          event: 'call.buyer.route',
          tenantId: this.tenantId,
          data: {
            callId: this.callId,
            action: 'buyer.route',
            params: action.params,
            complianceOverride: complianceResult.override,
          },
        });
        break;

      case 'record.start':
        await eventBus.publish('call.*', {
          event: 'call.record.start',
          tenantId: this.tenantId,
          data: {
            callId: this.callId,
            action: 'record.start',
            params: action.params,
          },
        });
        break;

      case 'whisper.start':
        await eventBus.publish('call.*', {
          event: 'call.whisper.start',
          tenantId: this.tenantId,
          data: {
            callId: this.callId,
            action: 'whisper.start',
            params: action.params,
          },
        });
        break;

      case 'tag':
        // Update context tags
        if (action.params) {
          this.context.tags = {
            ...this.context.tags,
            ...(action.params as Record<string, unknown>),
          };
        }
        break;

      case 'hangup':
        await this.hangup((action.params?.reason as string) || 'Flow completed');
        break;

      default:
        console.warn(`Unknown action type: ${(action as any).type}`);
    }
  }

  /**
   * Determine if execution should continue immediately
   */
  private shouldContinueImmediately(action: ExecutionResult['action']): boolean {
    // Don't continue immediately for actions that require external events
    const waitActions = ['queue.join', 'record.start', 'whisper.start', 'play'];
    return !waitActions.includes(action.type);
  }

  /**
   * Handle execution errors
   */
  private async handleError(error: unknown): Promise<void> {
    this.isRunning = false;

    await eventBus.publish('call.*', {
      event: 'call.failed',
      tenantId: this.tenantId,
      data: {
        callId: this.callId,
        error: error instanceof Error ? error.message : 'Unknown error',
        currentNodeId: this.context.currentNodeId,
      },
    });

    // Update call state
    await callStateService.updateCallState(this.callId, {
      status: 'failed',
    });
  }

  /**
   * Hangup the call
   */
  private async hangup(reason: string): Promise<void> {
    this.isRunning = false;

    await callStateService.updateCallState(this.callId, {
      status: 'completed',
    });

    await eventBus.publish('call.*', {
      event: 'call.ended',
      tenantId: this.tenantId,
      data: {
        callId: this.callId,
        reason,
        tags: this.context.tags,
      },
    });
  }

  /**
   * Get current execution context
   */
  getContext(): ExecutionContext {
    return { ...this.context };
  }

  /**
   * Stop the flow engine
   */
  stop(): void {
    this.isRunning = false;
  }

  /**
   * Check compliance before routing to buyer
   */
  private async checkComplianceBeforeBuyerRoute(buyerParams: {
    buyerId?: string;
    destination?: string;
  }): Promise<import('./compliance-service.js').ComplianceCheckResult> {
    try {
      // Get call details to extract phone number
      const call = await this.prisma.call.findUnique({
        where: { id: this.callId },
        select: {
          toNumber: true,
          campaignId: true,
          metadata: true,
        },
      });

      if (!call) {
        throw new Error(`Call ${this.callId} not found`);
      }

      // Get compliance policy
      const policy = await compliancePolicyService.getEffectivePolicy(this.tenantId);

      // Get consent token from call metadata if available
      const consentToken = (call.metadata as any)?.consentToken;

      // Perform compliance check
      const result = await complianceService.checkCompliance(this.tenantId, call.toNumber, {
        campaignId: call.campaignId || undefined,
        consentToken,
        callId: this.callId,
        enforceDnc: policy.enforceDnc,
        enforceConsent: policy.enforceConsent,
        allowOverride: policy.allowOverride,
      });

      return result;
    } catch (error) {
      // On error, default to blocking (fail-safe)
      this.logger.error(`Compliance check failed for call ${this.callId}:`, error);
      return {
        allowed: false,
        reason: 'Compliance check failed',
      };
    }
  }

  /**
   * Handle compliance block
   */
  private async handleComplianceBlock(
    result: import('./compliance-service.js').ComplianceCheckResult
  ): Promise<void> {
    // Log audit event
    await this.prisma.auditLog
      .create({
        data: {
          tenantId: this.tenantId,
          action: 'compliance.block',
          entityType: 'call',
          entityId: this.callId,
          changes: {
            reason: result.reason,
            dncMatch: result.dncMatch,
            consentStatus: result.consentStatus,
          },
        },
      })
      .catch(err => {
        this.logger.error('Failed to log compliance block:', err);
      });

    // Publish compliance blocked event
    await eventBus.publish('call.*', {
      event: 'call.compliance.blocked',
      tenantId: this.tenantId,
      data: {
        callId: this.callId,
        reason: result.reason,
        dncMatch: result.dncMatch,
        consentStatus: result.consentStatus,
      },
    });

    // Hangup call
    await this.hangup(`Compliance block: ${result.reason}`);
  }

  private get logger() {
    return {
      error: (msg: string, ...args: any[]) => console.error(`[FlowEngine] ${msg}`, ...args),
    };
  }
}
