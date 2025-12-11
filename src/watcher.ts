/**
 * Wallet Watcher
 * 
 * Monitors tracked wallets for new trades and emits events
 * when they buy or sell positions
 */

import { PolymarketAPI, UserTrade } from './api';

export interface TradeEvent {
  // Wallet info
  wallet: string;
  
  // Trade details
  tokenId: string;
  conditionId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;          // shares
  usdcAmount: number;    // USDC spent/received
  
  // Market info
  marketSlug?: string;
  outcome?: string;
  
  // Metadata
  timestamp: string;
  transactionHash: string;
  
  // For proportional sizing
  traderBalance?: number;
}

export class WalletWatcher {
  private api: PolymarketAPI;
  private wallets: string[];
  private seenTrades: Set<string>;
  private pollIntervalMs: number;
  private lastTradeTimestamps: Map<string, number>;  // Unix timestamp as number
  private verbose: boolean;

  constructor(
    wallets: string[], 
    pollIntervalMs: number = 5000,
    verbose: boolean = false
  ) {
    this.api = new PolymarketAPI();
    this.wallets = wallets.map(w => w.toLowerCase());
    this.seenTrades = new Set();
    this.pollIntervalMs = pollIntervalMs;
    this.lastTradeTimestamps = new Map();
    this.verbose = verbose;
  }

  /**
   * Add a wallet to track
   */
  addWallet(wallet: string): void {
    const addr = wallet.toLowerCase();
    if (!this.wallets.includes(addr)) {
      this.wallets.push(addr);
      console.log(`➕ Added wallet to track: ${wallet}`);
    }
  }

  /**
   * Remove a wallet from tracking
   */
  removeWallet(wallet: string): void {
    const addr = wallet.toLowerCase();
    const index = this.wallets.indexOf(addr);
    if (index > -1) {
      this.wallets.splice(index, 1);
      this.lastTradeTimestamps.delete(addr);
      console.log(`➖ Removed wallet from tracking: ${wallet}`);
    }
  }

  /**
   * Get list of tracked wallets
   */
  getTrackedWallets(): string[] {
    return [...this.wallets];
  }

  /**
   * Check for new trades from a wallet
   */
  private async checkWalletTrades(wallet: string): Promise<TradeEvent[]> {
    const events: TradeEvent[] = [];
    
    try {
      // Get recent trades
      const trades = await this.api.getWalletTrades(wallet, 20);
      
      // Get trader's balance for proportional sizing
      const balance = await this.api.getWalletBalance(wallet);
      
      for (const trade of trades) {
        // Create unique ID for this trade using transaction hash
        const tradeId = trade.transactionHash || `${wallet}-${trade.timestamp}-${trade.tokenId}`;
        
        // Skip if we've already seen this trade
        if (this.seenTrades.has(tradeId)) {
          continue;
        }
        
        // Mark as seen IMMEDIATELY
        this.seenTrades.add(tradeId);
        
        // Parse timestamps as numbers for comparison
        const tradeTime = typeof trade.timestamp === 'string' 
          ? parseInt(trade.timestamp) 
          : trade.timestamp;
        const lastTime = this.lastTradeTimestamps.get(wallet) || 0;
        
        // Update last timestamp if this trade is newer
        if (tradeTime > lastTime) {
          this.lastTradeTimestamps.set(wallet, tradeTime);
        }
        
        // Create trade event
        // Trade detected - will be logged by bot.ts
        
        events.push({
          wallet,
          tokenId: trade.tokenId,
          conditionId: trade.conditionId,
          side: trade.side,
          price: trade.price,
          size: trade.size,
          usdcAmount: trade.usdcSize || (trade.size * trade.price),
          marketSlug: trade.marketSlug,
          outcome: trade.outcome,
          timestamp: trade.timestamp,
          transactionHash: trade.transactionHash,
          traderBalance: balance.totalValue,
        });
      }
    } catch (error: any) {
      if (this.verbose) {
        console.error(`⚠️  Error fetching trades for ${wallet}:`, error.message);
      }
    }
    
    return events;
  }

  /**
   * Initialize by fetching current trades (marks them as seen)
   */
  async initialize(): Promise<void> {
    for (const wallet of this.wallets) {
      try {
        const trades = await this.api.getWalletTrades(wallet, 50);
        
        // Mark all existing trades as seen
        for (const trade of trades) {
          const tradeId = trade.transactionHash || `${wallet}-${trade.timestamp}-${trade.tokenId}`;
          this.seenTrades.add(tradeId);
          
          // Update last timestamp (as number)
          const tradeTime = typeof trade.timestamp === 'string' 
            ? parseInt(trade.timestamp) 
            : trade.timestamp;
          const lastTime = this.lastTradeTimestamps.get(wallet) || 0;
          
          if (tradeTime > lastTime) {
            this.lastTradeTimestamps.set(wallet, tradeTime);
          }
        }
      } catch (error: any) {
        // Ignore initialization errors
      }
    }
  }

  /**
   * Stream new trade events
   */
  async *stream(): AsyncGenerator<TradeEvent, void, unknown> {
    // Initialize first
    await this.initialize();
    
    console.log('  📡 Listening for new trades...\n');
    
    while (true) {
      for (const wallet of this.wallets) {
        const events = await this.checkWalletTrades(wallet);
        
        for (const event of events) {
          yield event;
        }
      }
      
      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, this.pollIntervalMs));
    }
  }

  /**
   * One-time check for new trades (non-blocking)
   */
  async checkOnce(): Promise<TradeEvent[]> {
    const allEvents: TradeEvent[] = [];
    
    for (const wallet of this.wallets) {
      const events = await this.checkWalletTrades(wallet);
      allEvents.push(...events);
    }
    
    return allEvents;
  }

  /**
   * Get current positions of all tracked wallets
   */
  async getTrackedPositions(): Promise<Map<string, any[]>> {
    const positions = new Map<string, any[]>();
    
    for (const wallet of this.wallets) {
      try {
        const walletPositions = await this.api.getWalletPositions(wallet);
        positions.set(wallet, walletPositions);
      } catch (error) {
        positions.set(wallet, []);
      }
    }
    
    return positions;
  }
}
