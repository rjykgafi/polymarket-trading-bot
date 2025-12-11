/**
 * Real trading execution using Polymarket CLOB API
 */

import { ClobClient, Side, OrderType } from '@polymarket/clob-client';
import { WalletManager, initializeWallet } from './wallet';
import logger from './logger';

export interface TradeParams {
  tokenId: string;
  side: 'BUY' | 'SELL';
  amount: number; // USDC amount
  price?: number; // Price from original trade (optional)
}

export interface TradeResult {
  success: boolean;
  orderId?: string;
  error?: string;
  details?: any;
}

export class RealTrader {
  private wallet: WalletManager | null = null;
  private client: ClobClient | null = null;

  constructor() {}

  /**
   * Initialize the trader with wallet
   */
  async initialize(): Promise<void> {
    try {
      this.wallet = await initializeWallet();
      this.client = this.wallet.getClobClient();
      
      const balance = await this.wallet.getBalance();
      const totalUsdc = balance.polymarketBalance;
      if (totalUsdc < 1) {
        // Low balance warning handled by bot.ts
      }
    } catch (error: any) {
      logger.errorDetail('Failed to initialize trader', error);
      throw error;
    }
  }

  /**
   * Get current market price for a token
   */
  async getMarketPrice(tokenId: string, side: 'BUY' | 'SELL'): Promise<number | null> {
    if (!this.client) {
      logger.error('Trader not initialized');
      return null;
    }

    try {
      const price = await this.client.getPrice(tokenId, side);
      return price ? parseFloat(price) : null;
    } catch (error: any) {
      logger.errorDetail('Error getting price', error);
      return null;
    }
  }

  /**
   * Execute a market order
   * @param orderType - 'GTC' (default), 'FOK' (Fill Or Kill), 'GTD' (Good Till Date)
   */
  async executeTrade(params: TradeParams, orderType: 'GTC' | 'FOK' | 'GTD' = 'GTC'): Promise<TradeResult> {

    if (!this.client || !this.wallet) {
      return { success: false, error: 'Not initialized' };
    }

    try {
      // Check balance only for BUY (SELL doesn't need USDC)
      if (params.side === 'BUY') {
        const hasFunds = await this.wallet.checkSufficientBalance(params.amount);
        if (!hasFunds) {
          return { success: false, error: 'Low balance' };
        }
      }

      // Get market price - use provided price or fetch from API
      let marketPrice: number | null = params.price || null;
      if (!marketPrice) {
        marketPrice = await this.getMarketPrice(params.tokenId, params.side);
      }
      
      if (!marketPrice || marketPrice <= 0) {
        return { success: false, error: 'No price' };
      }

      // Calculate size (shares)
      const size = params.amount / marketPrice;

      // Get tick size and neg risk for this market
      type TickSize = "0.1" | "0.01" | "0.001" | "0.0001";
      let tickSize: TickSize = '0.01';  // Default to larger tick size
      let negRisk = false;
      
      try {
        tickSize = await this.client.getTickSize(params.tokenId) as TickSize;
        negRisk = await this.client.getNegRisk(params.tokenId);
      } catch (e) {
        // Use default tick size
      }

      // Round price to tick size
      const tickNum = parseFloat(tickSize);
      const orderPrice = Math.round(marketPrice / tickNum) * tickNum;

      // Minimum order size is 5 shares on Polymarket
      const MIN_SHARES = 5;
      if (size < MIN_SHARES) {
        const minAmount = MIN_SHARES * marketPrice;
        return { success: false, error: `Min $${minAmount.toFixed(0)}` };
      }

      // Suppress CLOB client console output
      const originalLog = console.log;
      const originalError = console.error;
      const isDebug = process.env.DEBUG === 'true';
      if (!isDebug) {
        console.log = () => {};
        console.error = () => {};
      }

      let order: any;
      try {
        // Map string to OrderType enum
        const orderTypeMap: Record<string, any> = {
          'GTC': OrderType.GTC,
          'FOK': OrderType.FOK,
          'GTD': OrderType.GTD,
        };
        const selectedOrderType = orderTypeMap[orderType] || OrderType.GTC;
        
        order = await this.client.createAndPostOrder(
          {
            tokenID: params.tokenId,
            price: orderPrice,
            size: size,
            side: params.side === 'BUY' ? Side.BUY : Side.SELL,
          },
          { tickSize, negRisk },
          selectedOrderType
        );
      } finally {
        // Restore console
        console.log = originalLog;
        console.error = originalError;
      }

      // Check if order was actually placed
      if (!order || !order.orderID || order.error) {
        return { success: false, error: order?.error || 'Rejected' };
      }

      return {
        success: true,
        orderId: order.orderID,
        details: { ...order, size, price: orderPrice },
      };
    } catch (error: any) {
      return { success: false, error: error.message?.substring(0, 30) || 'Failed' };
    }
  }

  /**
   * Get open orders
   */
  async getOpenOrders(): Promise<any[]> {
    if (!this.client) return [];
    
    try {
      const orders = await this.client.getOpenOrders();
      return orders || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Cancel an order
   */
  async cancelOrder(orderId: string): Promise<boolean> {
    if (!this.client) return false;

    try {
      await this.client.cancelOrder({ orderID: orderId });
      console.log(`✅ Order ${orderId} cancelled`);
      return true;
    } catch (error: any) {
      logger.errorDetail('Cancel failed', error);
      return false;
    }
  }

}

