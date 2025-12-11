import { CONFIG, Config } from './config';
import { RealTrader, TradeResult } from './trader';

export interface Position {
  tokenId: string;
  side: string;
  stake: number;
  entryPrice: number;
  orderId?: string;
  openedAt: Date;
}

export class TradeExecutor {
  private trader: RealTrader;
  private positions: Map<string, Position>;
  private config: Config;
  private initialized: boolean = false;

  constructor(config: Config = CONFIG) {
    this.trader = new RealTrader();
    this.positions = new Map();
    this.config = config;
  }

  /**
   * Initialize the executor (must be called before trading)
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    
    await this.trader.initialize();
    this.initialized = true;
  }

  /**
   * Get the trader instance (for take-profit manager)
   */
  getTrader(): RealTrader {
    return this.trader;
  }

  /**
   * Execute a trade (BUY or SELL)
   */
  async openPosition(
    tokenId: string,
    side: string,
    stake: number,
    price?: number  // Price from the original trade
  ): Promise<TradeResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tradeSide = side.toUpperCase() as 'BUY' | 'SELL';
    const existingPosition = this.positions.get(tokenId);

    // SELL logic: only sell if we have a position
    if (tradeSide === 'SELL') {
      if (!existingPosition) {
        return { success: false, error: 'No position' };
      }
      
      const result = await this.trader.executeTrade({
        tokenId,
        side: 'SELL',
        amount: existingPosition.stake,
        price,
      });

      if (result.success) {
        // Calculate P/L
        const entryPrice = existingPosition.entryPrice;
        const exitPrice = price || entryPrice;
        if (entryPrice > 0) {
          const pnl = ((exitPrice - entryPrice) / entryPrice) * existingPosition.stake;
          const pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
          const sign = pnl >= 0 ? '+' : '';
          console.log(`   P/L: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(1)}%)`);
        }
        this.positions.delete(tokenId);
      }
      return result;
    }

    // BUY logic: open new position or add to existing
    if (existingPosition) {
      const result = await this.trader.executeTrade({
        tokenId,
        side: 'BUY',
        amount: stake,
        price,
      });

      if (result.success) {
        existingPosition.stake += stake;
        existingPosition.entryPrice = price || existingPosition.entryPrice;
      }
      return result;
    }

    // Open new position
    const result = await this.trader.executeTrade({
      tokenId,
      side: 'BUY',
      amount: stake,
      price,
    });

    if (result.success) {
      this.positions.set(tokenId, {
        tokenId,
        side: 'BUY',
        stake,
        entryPrice: price || 0,
        orderId: result.orderId,
        openedAt: new Date(),
      });
    }

    return result;
  }

  /**
   * Close a position
   */
  async closePosition(tokenId: string): Promise<TradeResult> {
    const position = this.positions.get(tokenId);
    if (!position) {
      return { success: false, error: 'No position found' };
    }

    const closeSide = position.side === 'BUY' ? 'SELL' : 'BUY';
    
    const result = await this.trader.executeTrade({
      tokenId,
      side: closeSide as 'BUY' | 'SELL',
      amount: position.stake,
    });

    if (result.success) {
      this.positions.delete(tokenId);
      console.log(`✅ Position closed on ${tokenId.substring(0, 12)}...`);
    }

    return result;
  }

  /**
   * Close position if profit target reached
   */
  async closeOnProfit(tokenId: string, currentPrice: number): Promise<void> {
    const position = this.positions.get(tokenId);
    if (!position || position.entryPrice === 0) {
      return;
    }

    const pct = ((currentPrice - position.entryPrice) / position.entryPrice) * 100;

    if (pct >= (this.config.profit_take_percent || 15)) {
      console.log(`🎯 Profit target reached: +${pct.toFixed(2)}%`);
      await this.closePosition(tokenId);
    }
  }

  /**
   * Get all open positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Display positions
   */
  displayPositions(): void {
    const positions = this.getPositions();
    
    console.log('\n' + '═'.repeat(50));
    console.log('📋 OPEN POSITIONS');
    console.log('═'.repeat(50));
    
    if (positions.length === 0) {
      console.log('No open positions');
    } else {
      positions.forEach((pos, index) => {
        console.log(`${index + 1}. ${pos.side} $${pos.stake.toFixed(2)}`);
        console.log(`   Token: ${pos.tokenId.substring(0, 20)}...`);
        console.log(`   Opened: ${pos.openedAt.toLocaleString()}`);
      });
    }
    
    console.log('═'.repeat(50));
  }

}
