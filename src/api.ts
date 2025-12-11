/**
 * Polymarket API Client
 * 
 * Uses multiple APIs:
 * - data-api.polymarket.com - for user positions and trades
 * - gamma-api.polymarket.com - for market data
 * - clob.polymarket.com - for order book and trading
 */

import axios, { AxiosInstance } from 'axios';

// Trade from data-api
export interface UserTrade {
  id: string;
  proxyWallet: string;
  conditionId: string;
  tokenId: string;
  side: 'BUY' | 'SELL';
  price: number;
  size: number;        // shares
  usdcSize: number;    // USDC amount
  timestamp: string;
  transactionHash: string;
  marketSlug?: string;
  outcome?: string;
}

// Position from data-api
export interface UserPosition {
  proxyWallet: string;
  conditionId: string;
  tokenId: string;
  size: number;
  avgPrice: number;
  currentPrice?: number;
  outcome?: string;
  marketSlug?: string;
}

// Market from gamma-api
export interface Market {
  id: string;
  conditionId: string;
  question: string;
  slug: string;
  outcomes: string[];
  tokens: Array<{
    token_id: string;
    outcome: string;
    price?: number;
  }>;
  volume?: number;
  liquidity?: number;
  endDate?: string;
}

export class PolymarketAPI {
  private dataApi: AxiosInstance;
  private gammaApi: AxiosInstance;

  constructor() {
    this.dataApi = axios.create({
      baseURL: 'https://data-api.polymarket.com',
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
        'Origin': 'https://polymarket.com',
        'Referer': 'https://polymarket.com/',
      },
    });

    this.gammaApi = axios.create({
      baseURL: 'https://gamma-api.polymarket.com',
      timeout: 15000,
      headers: {
        'Accept': 'application/json',
      },
    });
  }

  /**
   * Get recent trades for a wallet
   */
  async getWalletTrades(walletAddress: string, limit: number = 50): Promise<UserTrade[]> {
    try {
      const response = await this.dataApi.get('/trades', {
        params: {
          user: walletAddress.toLowerCase(),
          limit,
        },
      });
      
      return (response.data || []).map((t: any) => ({
        id: t.id || t.transactionHash,
        proxyWallet: t.proxyWallet || t.taker,
        conditionId: t.conditionId,
        tokenId: t.tokenId || t.asset,
        side: t.side?.toUpperCase() || (t.outcome === 'Yes' ? 'BUY' : 'SELL'),
        price: parseFloat(t.price || '0'),
        size: parseFloat(t.size || '0'),
        usdcSize: parseFloat(t.usdcSize || t.size || '0') * parseFloat(t.price || '1'),
        timestamp: t.timestamp || t.createdAt,
        transactionHash: t.transactionHash || '',
        marketSlug: t.slug,
        outcome: t.outcome,
      }));
    } catch (error: any) {
      if (error.response?.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get current positions for a wallet
   */
  async getWalletPositions(walletAddress: string): Promise<UserPosition[]> {
    try {
      const response = await this.dataApi.get('/positions', {
        params: {
          user: walletAddress.toLowerCase(),
          sizeThreshold: 0.01,
        },
      });

      return (response.data || []).map((p: any) => ({
        proxyWallet: p.proxyWallet || walletAddress,
        conditionId: p.conditionId,
        tokenId: p.asset || p.tokenId,
        size: parseFloat(p.size || '0'),
        avgPrice: parseFloat(p.avgPrice || '0'),
        currentPrice: parseFloat(p.curPrice || p.currentPrice || '0'),  // API returns curPrice
        outcome: p.outcome,
        marketSlug: p.slug,
      }));
    } catch (error: any) {
      if (error.response?.status === 404) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get portfolio value for a wallet
   */
  async getWalletValue(walletAddress: string): Promise<number> {
    try {
      const response = await this.dataApi.get('/value', {
        params: {
          user: walletAddress.toLowerCase(),
        },
      });

      const data = response.data;
      if (Array.isArray(data) && data.length > 0) {
        return parseFloat(data[0].value || '0');
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get USDC balance for a wallet (includes positions value)
   */
  async getWalletBalance(walletAddress: string): Promise<{
    usdcBalance: number;
    positionsValue: number;
    totalValue: number;
  }> {
    try {
      const [value, positions] = await Promise.all([
        this.getWalletValue(walletAddress),
        this.getWalletPositions(walletAddress),
      ]);

      const positionsValue = positions.reduce((sum, p) => {
        return sum + (p.size * (p.currentPrice || p.avgPrice));
      }, 0);

      return {
        usdcBalance: value,
        positionsValue,
        totalValue: value + positionsValue,
      };
    } catch (error) {
      return { usdcBalance: 0, positionsValue: 0, totalValue: 0 };
    }
  }

  /**
   * Get active markets
   */
  async getActiveMarkets(limit: number = 100): Promise<Market[]> {
    try {
      const response = await this.gammaApi.get('/markets', {
        params: {
          active: true,
          closed: false,
          limit,
        },
      });

      return (response.data || []).map((m: any) => {
        let tokens: Market['tokens'] = [];
        try {
          const tokenIds = typeof m.clobTokenIds === 'string' 
            ? JSON.parse(m.clobTokenIds) 
            : m.clobTokenIds || [];
          const outcomes = typeof m.outcomes === 'string'
            ? JSON.parse(m.outcomes)
            : m.outcomes || [];
          
          tokens = tokenIds.map((id: string, i: number) => ({
            token_id: id,
            outcome: outcomes[i] || `Outcome ${i}`,
          }));
        } catch (e) {
          // ignore parse errors
        }

        return {
          id: m.id,
          conditionId: m.conditionId,
          question: m.question,
          slug: m.slug,
          outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes || [],
          tokens,
          volume: parseFloat(m.volume || '0'),
          liquidity: parseFloat(m.liquidity || '0'),
          endDate: m.endDate,
        };
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Get market by condition ID
   */
  async getMarketByCondition(conditionId: string): Promise<Market | null> {
    try {
      const response = await this.gammaApi.get('/markets', {
        params: {
          condition_id: conditionId,
        },
      });

      const data = response.data;
      if (Array.isArray(data) && data.length > 0) {
        const m = data[0];
        let tokens: Market['tokens'] = [];
        try {
          const tokenIds = typeof m.clobTokenIds === 'string' 
            ? JSON.parse(m.clobTokenIds) 
            : m.clobTokenIds || [];
          const outcomes = typeof m.outcomes === 'string'
            ? JSON.parse(m.outcomes)
            : m.outcomes || [];
          
          tokens = tokenIds.map((id: string, i: number) => ({
            token_id: id,
            outcome: outcomes[i] || `Outcome ${i}`,
          }));
        } catch (e) {}

        return {
          id: m.id,
          conditionId: m.conditionId,
          question: m.question,
          slug: m.slug,
          outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes || [],
          tokens,
          volume: parseFloat(m.volume || '0'),
          liquidity: parseFloat(m.liquidity || '0'),
          endDate: m.endDate,
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get market by slug
   */
  async getMarketBySlug(slug: string): Promise<Market | null> {
    try {
      const response = await this.gammaApi.get('/markets', {
        params: {
          slug,
        },
      });

      const data = response.data;
      if (Array.isArray(data) && data.length > 0) {
        const m = data[0];
        let tokens: Market['tokens'] = [];
        try {
          const tokenIds = typeof m.clobTokenIds === 'string' 
            ? JSON.parse(m.clobTokenIds) 
            : m.clobTokenIds || [];
          const outcomes = typeof m.outcomes === 'string'
            ? JSON.parse(m.outcomes)
            : m.outcomes || [];
          
          tokens = tokenIds.map((id: string, i: number) => ({
            token_id: id,
            outcome: outcomes[i] || `Outcome ${i}`,
          }));
        } catch (e) {}

        return {
          id: m.id,
          conditionId: m.conditionId,
          question: m.question,
          slug: m.slug,
          outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes || [],
          tokens,
          volume: parseFloat(m.volume || '0'),
          liquidity: parseFloat(m.liquidity || '0'),
          endDate: m.endDate,
        };
      }
      return null;
    } catch (error) {
      return null;
    }
  }
}
