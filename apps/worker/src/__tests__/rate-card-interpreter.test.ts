import { Decimal } from 'decimal.js';
import { describe, it, expect } from 'vitest';

import { RateCardInterpreter } from '../services/rate-card-interpreter.js';

describe('RateCardInterpreter', () => {
  const interpreter = new RateCardInterpreter();

  describe('calculateCallCharges', () => {
    it('should calculate inbound call charges correctly', () => {
      const rateCard = {
        inbound: {
          perMinute: 0.05,
          connectionFee: 0.10,
        },
      };

      const context = {
        direction: 'INBOUND' as const,
        duration: 125, // 2 minutes 5 seconds -> 3 minutes (rounded up)
        answered: true,
        hasRecording: false,
      };

      const result = interpreter.calculateCallCharges(rateCard, context);

      expect(result.callMinutes.toNumber()).toBe(3);
      expect(result.callAmount.toNumber()).toBe(0.15); // 3 * 0.05
      expect(result.connectionFee.toNumber()).toBe(0.10);
      expect(result.total.toNumber()).toBe(0.25);
    });

    it('should calculate outbound call charges correctly', () => {
      const rateCard = {
        outbound: {
          perMinute: 0.10,
          connectionFee: 0.15,
        },
      };

      const context = {
        direction: 'OUTBOUND' as const,
        duration: 60, // Exactly 1 minute -> 1 minute
        answered: true,
        hasRecording: false,
      };

      const result = interpreter.calculateCallCharges(rateCard, context);

      expect(result.callMinutes.toNumber()).toBe(1);
      expect(result.callAmount.toNumber()).toBe(0.10);
      expect(result.connectionFee.toNumber()).toBe(0.15);
      expect(result.total.toNumber()).toBe(0.25);
    });

    it('should not charge for unanswered calls', () => {
      const rateCard = {
        inbound: {
          perMinute: 0.05,
          connectionFee: 0.10,
        },
      };

      const context = {
        direction: 'INBOUND' as const,
        duration: 30,
        answered: false,
        hasRecording: false,
      };

      const result = interpreter.calculateCallCharges(rateCard, context);

      expect(result.callAmount.toNumber()).toBe(0);
      expect(result.connectionFee.toNumber()).toBe(0);
      expect(result.total.toNumber()).toBe(0);
    });

    it('should calculate recording fee per call', () => {
      const rateCard = {
        inbound: {
          perMinute: 0.05,
        },
        recording: {
          perCall: 0.25,
        },
      };

      const context = {
        direction: 'INBOUND' as const,
        duration: 60,
        answered: true,
        hasRecording: true,
      };

      const result = interpreter.calculateCallCharges(rateCard, context);

      expect(result.recordingFee.toNumber()).toBe(0.25);
      expect(result.total.toNumber()).toBe(0.30); // 0.05 + 0.25
    });

    it('should calculate recording fee per minute', () => {
      const rateCard = {
        inbound: {
          perMinute: 0.05,
        },
        recording: {
          perMinute: 0.02,
        },
      };

      const context = {
        direction: 'INBOUND' as const,
        duration: 60,
        answered: true,
        hasRecording: true,
        recordingDuration: 125, // 3 minutes rounded up
      };

      const result = interpreter.calculateCallCharges(rateCard, context);

      expect(result.recordingFee.toNumber()).toBe(0.06); // 3 * 0.02
      expect(result.total.toNumber()).toBe(0.11); // 0.05 + 0.06
    });

    it('should round up minutes correctly', () => {
      const rateCard = {
        inbound: {
          perMinute: 0.10,
        },
      };

      // 1 second -> 1 minute
      const result1 = interpreter.calculateCallCharges(rateCard, {
        direction: 'INBOUND',
        duration: 1,
        answered: true,
        hasRecording: false,
      });
      expect(result1.callMinutes.toNumber()).toBe(1);

      // 60 seconds -> 1 minute
      const result2 = interpreter.calculateCallCharges(rateCard, {
        direction: 'INBOUND',
        duration: 60,
        answered: true,
        hasRecording: false,
      });
      expect(result2.callMinutes.toNumber()).toBe(1);

      // 61 seconds -> 2 minutes
      const result3 = interpreter.calculateCallCharges(rateCard, {
        direction: 'INBOUND',
        duration: 61,
        answered: true,
        hasRecording: false,
      });
      expect(result3.callMinutes.toNumber()).toBe(2);
    });
  });

  describe('calculateCPACharge', () => {
    it('should return CPA amount from rate card', () => {
      const rateCard = {
        cpa: {
          amount: 25.00,
        },
      };

      const amount = interpreter.calculateCPACharge(rateCard);
      expect(amount.toNumber()).toBe(25.00);
    });

    it('should return zero if no CPA rate', () => {
      const rateCard = {};
      const amount = interpreter.calculateCPACharge(rateCard);
      expect(amount.toNumber()).toBe(0);
    });
  });

  describe('rounding', () => {
    it('should round amounts to 4 decimal places', () => {
      const amount = new Decimal('0.123456789');
      const rounded = interpreter.roundAmount(amount);
      expect(rounded.toFixed(4)).toBe('0.1235');
    });

    it('should round amounts to 2 decimal places for display', () => {
      const amount = new Decimal('0.123456789');
      const rounded = interpreter.roundForDisplay(amount);
      expect(rounded.toFixed(2)).toBe('0.12');
    });

    it('should handle rounding edge cases', () => {
      // Test half-up rounding
      const amount1 = new Decimal('0.125');
      expect(interpreter.roundForDisplay(amount1).toFixed(2)).toBe('0.13');

      const amount2 = new Decimal('0.124');
      expect(interpreter.roundForDisplay(amount2).toFixed(2)).toBe('0.12');
    });
  });
});

