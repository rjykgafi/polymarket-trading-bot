/**
 * Auto Take-Profit Manager
 * 
 * When position reaches target profit:
 * 1. Places GTC limit order at guaranteed profit price
 * 2. Order stays until filled (won't cancel)
 * 3. Guarantees closing in profit
 */

import { PolymarketAPI } from './api';
import { RealTrader } from './trader';

interface Position {
  tokenId: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  profitPercent: number;
  marketSlug: string;
  outcome: string;
}

export class TakeProfitManager {
  private api: PolymarketAPI;
  private trader: RealTrader;
  private walletAddress: string;
  private profitTarget: number;          // Trigger at +X%
  private sellProfitPercent: number;     // Sell at +Y% (slightly below trigger)
  private checkIntervalMs: number;
  private isRunning: boolean = false;
  private pendingOrders: Set<string> = new Set();  // Tokens with active sell orders

  constructor(
    trader: RealTrader,
    walletAddress: string,
    profitTargetPercent: number = 20,
    checkIntervalMs: number = 30000
  ) {
    this.api = new PolymarketAPI();
    this.trader = trader;
    this.walletAddress = walletAddress;
    this.profitTarget = profitTargetPercent;
    this.sellProfitPercent = Math.max(5, profitTargetPercent - 5);  // Sell 5% below trigger
    this.checkIntervalMs = checkIntervalMs;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log(`  📈 Take-Profit: trigger +${this.profitTarget}% → sell +${this.sellProfitPercent}%`);
    
    while (this.isRunning) {
      await this.checkPositions();
      await this.cleanupFilledOrders();
      await new Promise(resolve => setTimeout(resolve, this.checkIntervalMs));
    }
  }

  stop(): void {
    this.isRunning = false;
  }

  private async checkPositions(): Promise<void> {
    try {
      const positions = await this.getPositionsWithProfit();
      
      for (const pos of positions) {
        // Skip if already have pending sell order
        if (this.pendingOrders.has(pos.tokenId)) continue;
        
        // Skip resolved markets
        if (pos.currentPrice >= 0.99 || pos.currentPrice <= 0.01) continue;
        
        // Check if profit target reached
        if (pos.profitPercent >= this.profitTarget) {
          await this.placeTakeProfitOrder(pos);
        }
      }
    } catch {
      // Silently retry
    }
  }

  /**
   * Remove tokens from pending if position closed
   */
  private async cleanupFilledOrders(): Promise<void> {
    if (this.pendingOrders.size === 0) return;
    
    try {
      const positions = await this.getPositionsWithProfit();
      const activeTokens = new Set(positions.map(p => p.tokenId));
      
      for (const tokenId of this.pendingOrders) {
        if (!activeTokens.has(tokenId)) {
          console.log(`  ✅ Take-profit filled`);
          this.pendingOrders.delete(tokenId);
        }
      }
    } catch {
      // Ignore
    }
  }

  private async getPositionsWithProfit(): Promise<Position[]> {
    const rawPositions = await this.api.getWalletPositions(this.walletAddress);
    
    return rawPositions
      .filter(p => p.size > 0.01)
      .map(p => {
        const avgPrice = p.avgPrice || 0;
        const currentPrice = p.currentPrice || avgPrice;
        const profitPercent = avgPrice > 0 
          ? ((currentPrice - avgPrice) / avgPrice) * 100 
          : 0;
        
        return {
          tokenId: p.tokenId,
          size: p.size,
          avgPrice,
          currentPrice,
          profitPercent,
          marketSlug: p.marketSlug || '',
          outcome: p.outcome || '',
        };
      });
  }

  /**
   * Place GTC limit order at guaranteed profit price
   */
  private async placeTakeProfitOrder(pos: Position): Promise<void> {
    // Calculate sell price = entry + guaranteed profit
    const sellPrice = pos.avgPrice * (1 + this.sellProfitPercent / 100);
    
    // Don't sell above 0.99
    const finalPrice = Math.min(sellPrice, 0.99);
    
    const value = pos.size * finalPrice;
    const expectedPnl = (finalPrice - pos.avgPrice) * pos.size;

    console.log(`\n  💰 TAKE PROFIT: ${pos.marketSlug.substring(0, 25)}`);
    console.log(`     ${pos.size.toFixed(1)} shares @ $${finalPrice.toFixed(3)} (+${this.sellProfitPercent}% = +$${expectedPnl.toFixed(2)})`);

    try {
      const result = await this.trader.executeTrade({
        tokenId: pos.tokenId,
        side: 'SELL',
        amount: value,
        price: finalPrice,
      }, 'GTC');  // GTC = stays until filled

      if (result.success) {
        console.log(`     📤 Order placed`);
        this.pendingOrders.add(pos.tokenId);
      } else {
        console.log(`     ❌ ${result.error}`);
      }
    } catch (error: any) {
      console.log(`     ❌ ${error.message?.substring(0, 30)}`);
    }
  }

  async displayPositions(): Promise<void> {
    const positions = await this.getPositionsWithProfit();
    
    if (positions.length === 0) {
      console.log('No open positions');
      return;
    }
    
    console.log('\n📊 Positions:');
    
    let totalValue = 0;
    let totalPL = 0;
    
    for (const pos of positions) {
      const value = pos.size * pos.currentPrice;
      const cost = pos.size * pos.avgPrice;
      const pl = value - cost;
      totalValue += value;
      totalPL += pl;
      
      const emoji = pos.profitPercent >= 0 ? '🟢' : '🔴';
      const sign = pos.profitPercent >= 0 ? '+' : '';
      
      console.log(`${emoji} ${pos.marketSlug.substring(0, 25)} | ${sign}${pos.profitPercent.toFixed(0)}% | $${value.toFixed(2)}`);
    }
    
    const totalSign = totalPL >= 0 ? '+' : '';
    console.log(`Total: $${totalValue.toFixed(2)} (${totalSign}$${totalPL.toFixed(2)})`);
  }
}
