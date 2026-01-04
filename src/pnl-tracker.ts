/**
 * PnL Tracker - Simple equity-based tracking
 * 
 * Session P/L = current equity - start equity
 * (simple, accurate, no complex calculations)
 */

import { PolymarketAPI } from './api';
import { WalletManager } from './wallet';

interface PositionSnapshot {
  tokenId: string;
  size: number;
  avgPrice: number;
  currentPrice: number;
  marketSlug: string;
  costBasis: number;
  currentValue: number;
  unrealizedPnL: number;
}

interface Snapshot {
  timestamp: Date;
  usdcBalance: number;
  positionsValue: number;
  totalEquity: number;
  positions: PositionSnapshot[];
}

export type OnPositionClosedCallback = (tokenId: string, marketSlug: string) => void;

export class PnLTracker {
  private api: PolymarketAPI;
  private wallet: WalletManager;
  private walletAddress: string;
  
  private startEquity: number = 0;
  private currentSnapshot: Snapshot | null = null;
  
  private winCount: number = 0;
  private lossCount: number = 0;
  
  private updateIntervalMs: number;
  private isRunning: boolean = false;
  private onPositionClosed: OnPositionClosedCallback | null = null;

  constructor(
    wallet: WalletManager,
    walletAddress: string,
    updateIntervalMs: number = 30000
  ) {
    this.api = new PolymarketAPI();
    this.wallet = wallet;
    this.walletAddress = walletAddress;
    this.updateIntervalMs = updateIntervalMs;
  }

  setOnPositionClosed(callback: OnPositionClosedCallback): void {
    this.onPositionClosed = callback;
  }

  async initialize(): Promise<PnLInfo> {
    this.currentSnapshot = await this.takeSnapshot();
    this.startEquity = this.currentSnapshot.totalEquity;
    return this.getPnLInfo();
  }

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    
    while (this.isRunning) {
      await new Promise(r => setTimeout(r, this.updateIntervalMs));
      await this.update();
    }
  }

  stop(): void {
    this.isRunning = false;
  }

  async update(): Promise<PnLInfo> {
    const prevSnapshot = this.currentSnapshot;
    
    try {
      this.currentSnapshot = await this.takeSnapshot();
    } catch {
      return this.getPnLInfo();
    }
    
    // Detect closed positions
    if (prevSnapshot) {
      const currentTokenIds = new Set(this.currentSnapshot.positions.map(p => p.tokenId));
      
      for (const prevPos of prevSnapshot.positions) {
        if (!currentTokenIds.has(prevPos.tokenId)) {
          // Position closed
          const pnl = prevPos.unrealizedPnL;
          
          if (pnl > 0.01) this.winCount++;
          else if (pnl < -0.01) this.lossCount++;
          
          // Log closed position
          const sign = pnl >= 0 ? '+' : '';
          const emoji = pnl >= 0 ? '✅' : '❌';
          const pnlPct = prevPos.costBasis > 0 ? (pnl / prevPos.costBasis) * 100 : 0;
          
          console.log(`\n${emoji} CLOSED: ${prevPos.marketSlug.substring(0, 30)}`);
          console.log(`   P/L: ${sign}$${pnl.toFixed(2)} (${sign}${pnlPct.toFixed(1)}%)`);
          
          const sessionPnL = this.currentSnapshot.totalEquity - this.startEquity;
          const sessionSign = sessionPnL >= 0 ? '+' : '';
          console.log(`   Session: ${sessionSign}$${sessionPnL.toFixed(2)} | ${this.winCount}W/${this.lossCount}L`);
          
          if (this.onPositionClosed) {
            this.onPositionClosed(prevPos.tokenId, prevPos.marketSlug);
          }
        }
      }
    }
    
    return this.getPnLInfo();
  }

  async forceUpdate(): Promise<PnLInfo> {
    return this.update();
  }

  private async takeSnapshot(): Promise<Snapshot> {
    const [balance, rawPositions] = await Promise.all([
      this.wallet.getBalance(),
      this.api.getWalletPositions(this.walletAddress),
    ]);
    
    const positions: PositionSnapshot[] = rawPositions
      .filter(p => p.size > 0.01)
      .map(p => {
        const currentPrice = p.currentPrice || p.avgPrice;
        const costBasis = p.size * p.avgPrice;
        const currentValue = p.size * currentPrice;
        
        return {
          tokenId: p.tokenId,
          size: p.size,
          avgPrice: p.avgPrice,
          currentPrice,
          marketSlug: p.marketSlug || '',
          costBasis,
          currentValue,
          unrealizedPnL: currentValue - costBasis,
        };
      });
    
    const positionsValue = positions.reduce((sum, p) => sum + p.currentValue, 0);
    
    return {
      timestamp: new Date(),
      usdcBalance: balance.polymarketBalance,
      positionsValue,
      totalEquity: balance.polymarketBalance + positionsValue,
      positions,
    };
  }

  getPnLInfo(): PnLInfo {
    if (!this.currentSnapshot) {
      return {
        startEquity: 0,
        currentEquity: 0,
        sessionPnL: 0,
        sessionPnLPercent: 0,
        usdcBalance: 0,
        positionsValue: 0,
        positionCount: 0,
        winCount: 0,
        lossCount: 0,
        positions: [],
      };
    }
    
    const sessionPnL = this.currentSnapshot.totalEquity - this.startEquity;
    const sessionPnLPercent = this.startEquity > 0 
      ? (sessionPnL / this.startEquity) * 100 
      : 0;
    
    return {
      startEquity: this.startEquity,
      currentEquity: this.currentSnapshot.totalEquity,
      sessionPnL,
      sessionPnLPercent,
      usdcBalance: this.currentSnapshot.usdcBalance,
      positionsValue: this.currentSnapshot.positionsValue,
      positionCount: this.currentSnapshot.positions.length,
      winCount: this.winCount,
      lossCount: this.lossCount,
      positions: this.currentSnapshot.positions.map(p => ({
        market: p.marketSlug,
        size: p.size,
        avgPrice: p.avgPrice,
        currentPrice: p.currentPrice,
        pnl: p.unrealizedPnL,
        pnlPercent: p.costBasis > 0 ? (p.unrealizedPnL / p.costBasis) * 100 : 0,
      })),
    };
  }
}

export interface PnLInfo {
  startEquity: number;
  currentEquity: number;
  sessionPnL: number;
  sessionPnLPercent: number;
  usdcBalance: number;
  positionsValue: number;
  positionCount: number;
  winCount: number;
  lossCount: number;
  positions: Array<{
    market: string;
    size: number;
    avgPrice: number;
    currentPrice: number;
    pnl: number;
    pnlPercent: number;
  }>;
}
