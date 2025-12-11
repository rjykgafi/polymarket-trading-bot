/**
 * Trade Interpreter
 * 
 * Normalizes trade events from different sources
 */

import { TradeEvent } from './watcher';

export interface NormalizedTrade {
  wallet: string;
  tokenId: string;
  conditionId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;          // shares
  usdcAmount: number;    // USDC amount
  outcome?: string;
  marketSlug?: string;
  traderBalance?: number;
  timestamp: string;
}

export class TradeInterpreter {
  /**
   * Normalize a trade event
   */
  normalize(event: TradeEvent): NormalizedTrade {
    return {
      wallet: event.wallet,
      tokenId: event.tokenId,
      conditionId: event.conditionId,
      side: event.side,
      price: event.price,
      size: event.size,
      usdcAmount: event.usdcAmount,
      outcome: event.outcome,
      marketSlug: event.marketSlug,
      traderBalance: event.traderBalance,
      timestamp: event.timestamp,
    };
  }

  /**
   * Format trade for display
   */
  formatTrade(trade: NormalizedTrade): string {
    const side = trade.side === 'BUY' ? '🟢 BUY' : '🔴 SELL';
    const amount = `$${trade.usdcAmount.toFixed(2)}`;
    const shares = `${trade.size.toFixed(2)} shares`;
    const price = `@ $${trade.price.toFixed(4)}`;
    
    let market = '';
    if (trade.marketSlug) {
      market = ` on ${trade.marketSlug}`;
    }
    if (trade.outcome) {
      market += ` (${trade.outcome})`;
    }
    
    return `${side} ${amount} (${shares} ${price})${market}`;
  }

  /**
   * Check if trade is a buy
   */
  isBuy(trade: NormalizedTrade): boolean {
    return trade.side === 'BUY';
  }

  /**
   * Check if trade is a sell
   */
  isSell(trade: NormalizedTrade): boolean {
    return trade.side === 'SELL';
  }

  /**
   * Get the opposite side
   */
  getOppositeSide(side: 'BUY' | 'SELL'): 'BUY' | 'SELL' {
    return side === 'BUY' ? 'SELL' : 'BUY';
  }
}
