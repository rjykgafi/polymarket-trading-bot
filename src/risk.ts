/**
 * Risk Manager
 * 
 * Simple checks to prevent obviously bad trades.
 * Main limits are in config (min_stake, max_stake).
 */
export class RiskManager {
  private maxPositionPercent: number;

  constructor(maxPositionPercent: number = 50) {
    // Max % of balance for single trade (default 50%)
    this.maxPositionPercent = maxPositionPercent;
  }

  /**
   * Check if trade is allowed
   * 
   * @param stake - Amount to stake in USDC
   * @param myBalance - Your total balance (optional)
   */
  allow(stake: number, myBalance: number = 0): boolean {
    // Don't allow negative stakes
    if (stake <= 0) {
      console.log('   ⚠️  Risk: Invalid stake amount');
      return false;
    }

    // If we know balance, check we're not betting too much
    if (myBalance > 0) {
      const percent = (stake / myBalance) * 100;
      if (percent > this.maxPositionPercent) {
        console.log(`   ⚠️  Risk: Trade is ${percent.toFixed(1)}% of balance (max ${this.maxPositionPercent}%)`);
        return false;
      }
    }

    return true;
  }
}
