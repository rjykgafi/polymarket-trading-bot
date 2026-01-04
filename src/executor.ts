import { CONFIG, Config } from './config';
import { RealTrader, TradeResult } from './trader';

export interface PositionPart {
  wallet: string;  // Source wallet that made this buy
  stake: number;
  entryPrice: number;
  timestamp: Date;
}

export interface Position {
  tokenId: string;
  side: string;
  totalStake: number;  // Sum of all parts
  parts: PositionPart[];  // Track each buy separately
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
   * @param sourceWallet - wallet that initiated this trade (for tracking)
   */
  async openPosition(
    tokenId: string,
    side: string,
    stake: number,
    price?: number,
    sourceWallet?: string
  ): Promise<TradeResult> {
    if (!this.initialized) {
      await this.initialize();
    }

    const tradeSide = side.toUpperCase() as 'BUY' | 'SELL';
    const existingPosition = this.positions.get(tokenId);

    // SELL logic: sell the part that matches this wallet
    if (tradeSide === 'SELL') {
      if (!existingPosition) {
        return { success: false, error: 'No position' };
      }
      
      // Find which part to sell based on source wallet
      let sellAmount = stake;
      
      if (sourceWallet) {
        // Sell only the part from this specific wallet
        const part = existingPosition.parts.find(p => 
          p.wallet.toLowerCase() === sourceWallet.toLowerCase()
        );
        
        if (!part) {
          // This wallet didn't buy, ignore the sell
          return { success: false, error: 'No position from this wallet' };
        }
        
        sellAmount = part.stake;
      } else {
        // No wallet specified - sell entire position
        sellAmount = existingPosition.totalStake;
      }
      
      const result = await this.trader.executeTrade({
        tokenId,
        side: 'SELL',
        amount: sellAmount,
        price,
      });

      if (result.success) {
        if (sourceWallet) {
          // Remove only this part
          existingPosition.parts = existingPosition.parts.filter(p => 
            p.wallet.toLowerCase() !== sourceWallet.toLowerCase()
          );
          existingPosition.totalStake -= sellAmount;
          
          // If no parts left, delete position
          if (existingPosition.parts.length === 0) {
            this.positions.delete(tokenId);
          }
        } else {
          // Sold entire position
          this.positions.delete(tokenId);
        }
      }
      return result;
    }

    // BUY logic: add to existing or create new position
    const part: PositionPart = {
      wallet: sourceWallet || 'unknown',
      stake,
      entryPrice: price || 0,
      timestamp: new Date(),
    };

    if (existingPosition) {
      const result = await this.trader.executeTrade({
        tokenId,
        side: 'BUY',
        amount: stake,
        price,
      });

      if (result.success) {
        existingPosition.parts.push(part);
        existingPosition.totalStake += stake;
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
        totalStake: stake,
        parts: [part],
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
      amount: position.totalStake,
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
    if (!position || position.parts.length === 0) {
      return;
    }

    // Calculate weighted average entry price
    const totalCost = position.parts.reduce((sum, p) => sum + (p.stake * p.entryPrice), 0);
    const avgEntryPrice = totalCost / position.totalStake;
    
    if (avgEntryPrice === 0) return;

    const pct = ((currentPrice - avgEntryPrice) / avgEntryPrice) * 100;

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
   * Get position by tokenId
   */
  getPosition(tokenId: string): Position | undefined {
    return this.positions.get(tokenId);
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
        console.log(`${index + 1}. ${pos.side} $${pos.totalStake.toFixed(2)} (${pos.parts.length} part(s))`);
        console.log(`   Token: ${pos.tokenId.substring(0, 20)}...`);
        pos.parts.forEach((part, i) => {
          console.log(`   [${i+1}] ${part.wallet.substring(0, 10)}... $${part.stake.toFixed(2)} @ $${part.entryPrice.toFixed(3)}`);
        });
        console.log(`   Opened: ${pos.openedAt.toLocaleString()}`);
      });
    }
    
    console.log('═'.repeat(50));
  }

}
