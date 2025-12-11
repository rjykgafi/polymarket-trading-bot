/**
 * Position Sizer
 * 
 * Calculates the appropriate stake size when copying trades.
 * COPIES ALL TRADES - uses min_stake if proportional is too small.
 * 
 * Formula:
 *   yourStake = max(min_stake, traderStake × (yourBalance / traderBalance))
 * 
 * Example:
 *   - Whale has $3,500,000 and bets $1,700 (0.05%)
 *   - You have $10
 *   - Proportional: $1,700 × ($10 / $3,500,000) = $0.005
 *   - Too small → use min_stake = $5
 *   - Your bet: $5
 */

import { Config, SizingMode } from './config';
import { TradeEvent } from './watcher';

export interface SizingResult {
  originalAmount: number;     // What trader bet
  scaledAmount: number;       // What you should bet
  scalingFactor: number;      // yourBalance / traderBalance
  mode: SizingMode;
  capped: boolean;            // Was it capped by min/max
  reason?: string;
}

export class PositionSizer {
  private config: Config;
  private myBalance: number;

  constructor(config: Config, myBalance: number = 0) {
    this.config = config;
    this.myBalance = myBalance;
  }

  /**
   * Update your current balance
   */
  setMyBalance(balance: number): void {
    this.myBalance = balance;
  }

  /**
   * Calculate stake size based on mode
   */
  calculate(event: TradeEvent): SizingResult {
    const originalAmount = event.usdcAmount;
    const traderBalance = event.traderBalance || 0;
    const mode = this.config.mode;

    let scaledAmount: number;
    let scalingFactor: number = 1;
    let reason: string | undefined;

    const fixedAmount = this.config.fixed_stake ?? this.config.min_stake;

    switch (mode) {
      case 'fixed':
        // Fixed stake - always bet the same amount
        scaledAmount = fixedAmount;
        reason = `Fixed stake: $${fixedAmount}`;
        break;

      case 'proportional':
        // Proportional to your balance vs trader's balance
        if (traderBalance > 0 && this.myBalance > 0) {
          scalingFactor = this.myBalance / traderBalance;
          scaledAmount = originalAmount * scalingFactor;
          reason = `Proportional: $${originalAmount.toFixed(2)} × (${this.myBalance.toFixed(0)} / ${traderBalance.toFixed(0)}) = $${scaledAmount.toFixed(2)}`;
        } else {
          // Fallback to min_stake if we don't have balance info
          scaledAmount = this.config.min_stake;
          reason = `Fallback to min_stake (missing balance info)`;
        }
        break;

      default:
        scaledAmount = this.config.min_stake;
        reason = `Default min_stake`;
    }

    // Apply min/max limits
    const { capped, amount: finalAmount } = this.applyLimits(scaledAmount);

    return {
      originalAmount,
      scaledAmount: finalAmount,
      scalingFactor,
      mode,
      capped,
      reason: capped 
        ? `${reason} → Capped to $${finalAmount.toFixed(2)}`
        : reason,
    };
  }

  /**
   * Simple scale function (backwards compatibility)
   */
  scale(traderStake: number, traderBalance?: number): number {
    const mode = this.config.mode;
    const fixedAmount = this.config.fixed_stake ?? this.config.min_stake;

    if (mode === 'fixed') {
      return fixedAmount;
    }

    if (mode === 'proportional' && traderBalance && traderBalance > 0 && this.myBalance > 0) {
      const scalingFactor = this.myBalance / traderBalance;
      return traderStake * scalingFactor;
    }

    return fixedAmount;
  }

  /**
   * Apply min/max limits
   */
  applyLimits(stake: number): { capped: boolean; amount: number } {
    const min = this.config.min_stake;
    const max = this.config.max_stake;

    if (stake < min) {
      return { capped: true, amount: min };
    }
    if (stake > max) {
      return { capped: true, amount: max };
    }
    return { capped: false, amount: stake };
  }

  /**
   * Check if a trade is worth copying
   * 
   * COPY ALL TRADES - just use min_stake if proportional is too small
   */
  isWorthCopying(event: TradeEvent): { worth: boolean; reason: string } {
    // Always copy! The calculate() method will apply min_stake automatically
    return { worth: true, reason: 'Copying trade' };
  }

  /**
   * Display sizing calculation
   */
  displayCalculation(event: TradeEvent): void {
    const result = this.calculate(event);
    
    console.log('📊 Position Sizing:');
    console.log(`   Mode: ${result.mode}`);
    console.log(`   Trader bet: $${result.originalAmount.toFixed(2)}`);
    if (event.traderBalance) {
      console.log(`   Trader balance: $${event.traderBalance.toFixed(2)}`);
    }
    console.log(`   Your balance: $${this.myBalance.toFixed(2)}`);
    console.log(`   Scaling factor: ${result.scalingFactor.toFixed(6)}`);
    console.log(`   Your stake: $${result.scaledAmount.toFixed(2)}${result.capped ? ' (capped)' : ''}`);
    if (result.reason) {
      console.log(`   Reason: ${result.reason}`);
    }
  }
}
