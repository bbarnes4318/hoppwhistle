import { Decimal } from 'decimal.js';

export interface RateCardStructure {
  inbound?: {
    perMinute?: number;
    connectionFee?: number;
  };
  outbound?: {
    perMinute?: number;
    connectionFee?: number;
  };
  recording?: {
    perMinute?: number;
    perCall?: number;
  };
  cpa?: {
    amount?: number;
    triggerEvent?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface CallRatingContext {
  direction: 'INBOUND' | 'OUTBOUND';
  duration: number; // seconds
  answered: boolean;
  hasRecording: boolean;
  recordingDuration?: number; // seconds
  publisherId?: string;
  buyerId?: string;
  metadata?: Record<string, unknown>;
}

export interface RatingResult {
  callMinutes: Decimal;
  callAmount: Decimal;
  connectionFee: Decimal;
  recordingFee: Decimal;
  cpaAmount: Decimal;
  total: Decimal;
  breakdown: Array<{
    type: string;
    description: string;
    quantity: Decimal;
    unitPrice: Decimal;
    amount: Decimal;
  }>;
}

export class RateCardInterpreter {
  /**
   * Calculate call charges based on rate card and call context
   */
  calculateCallCharges(
    rateCard: RateCardStructure,
    context: CallRatingContext
  ): RatingResult {
    const breakdown: RatingResult['breakdown'] = [];
    let callAmount = new Decimal(0);
    let connectionFee = new Decimal(0);
    let recordingFee = new Decimal(0);
    const cpaAmount = new Decimal(0);

    // Calculate billable minutes (round up to nearest minute)
    const callMinutes = this.roundUpMinutes(context.duration);
    
    // Get rates based on direction
    const rates = context.direction === 'INBOUND' 
      ? rateCard.inbound 
      : rateCard.outbound;

    // Connection fee (one-time, if call was answered)
    if (rates?.connectionFee && context.answered) {
      connectionFee = new Decimal(rates.connectionFee);
      breakdown.push({
        type: 'CONNECTION_FEE',
        description: `${context.direction} connection fee`,
        quantity: new Decimal(1),
        unitPrice: connectionFee,
        amount: connectionFee,
      });
    }

    // Per-minute charges (only if answered)
    if (rates?.perMinute && context.answered && callMinutes.gt(0)) {
      const perMinuteRate = new Decimal(rates.perMinute);
      callAmount = callMinutes.mul(perMinuteRate);
      breakdown.push({
        type: 'CALL_MINUTE',
        description: `${context.direction} call minutes`,
        quantity: callMinutes,
        unitPrice: perMinuteRate,
        amount: callAmount,
      });
    }

    // Recording fees
    if (rateCard.recording && context.hasRecording) {
      if (rateCard.recording.perCall) {
        recordingFee = new Decimal(rateCard.recording.perCall);
        breakdown.push({
          type: 'RECORDING_FEE',
          description: 'Recording fee (per call)',
          quantity: new Decimal(1),
          unitPrice: recordingFee,
          amount: recordingFee,
        });
      } else if (rateCard.recording.perMinute && context.recordingDuration) {
        const recordingMinutes = this.roundUpMinutes(context.recordingDuration);
        const perMinuteRate = new Decimal(rateCard.recording.perMinute);
        recordingFee = recordingMinutes.mul(perMinuteRate);
        breakdown.push({
          type: 'RECORDING_FEE',
          description: 'Recording fee (per minute)',
          quantity: recordingMinutes,
          unitPrice: perMinuteRate,
          amount: recordingFee,
        });
      }
    }

    // CPA is handled separately via conversion.confirmed event
    // This method doesn't calculate CPA

    const total = callAmount
      .plus(connectionFee)
      .plus(recordingFee)
      .plus(cpaAmount);

    return {
      callMinutes,
      callAmount,
      connectionFee,
      recordingFee,
      cpaAmount,
      total,
      breakdown,
    };
  }

  /**
   * Calculate CPA charge (triggered by conversion.confirmed event)
   */
  calculateCPACharge(rateCard: RateCardStructure): Decimal {
    if (rateCard.cpa?.amount) {
      return new Decimal(rateCard.cpa.amount);
    }
    return new Decimal(0);
  }

  /**
   * Round up seconds to nearest minute
   */
  private roundUpMinutes(seconds: number): Decimal {
    if (seconds <= 0) {
      return new Decimal(0);
    }
    // Round up: Math.ceil(seconds / 60)
    const minutes = Math.ceil(seconds / 60);
    return new Decimal(minutes);
  }

  /**
   * Round amount to 4 decimal places (for storage)
   */
  roundAmount(amount: Decimal): Decimal {
    return amount.toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
  }

  /**
   * Round amount to 2 decimal places (for display/invoicing)
   */
  roundForDisplay(amount: Decimal): Decimal {
    return amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
}

