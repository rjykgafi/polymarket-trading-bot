/**
 * Statistics tracker - saves trade events to stats.json
 */

import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const STATS_FILE = join(process.cwd(), 'stats.json');

interface WalletStats {
  buys: number;
  sells: number;
  lastTrade: string;
}

interface RecentTrade {
  time: string;
  wallet: string;
  side: string;
  amount: number;
  market: string;
  copied: boolean;
}

interface Stats {
  startedAt: string;
  lastUpdated: string;
  totalEvents: number;
  buys: number;
  sells: number;
  byWallet: { [wallet: string]: WalletStats };
  copied: {
    success: number;
    failed: number;
    skipped: number;
  };
  recentTrades: RecentTrade[];
}

function loadStats(): Stats {
  if (existsSync(STATS_FILE)) {
    try {
      return JSON.parse(readFileSync(STATS_FILE, 'utf-8'));
    } catch {
      // File corrupted, start fresh
    }
  }
  
  return {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalEvents: 0,
    buys: 0,
    sells: 0,
    byWallet: {},
    copied: { success: 0, failed: 0, skipped: 0 },
    recentTrades: [],
  };
}

function saveStats(stats: Stats): void {
  try {
    writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2), 'utf-8');
  } catch (e) {
    // Ignore write errors
  }
}

/**
 * Record a trade event from a tracked wallet
 */
export function recordTradeEvent(
  wallet: string,
  side: 'BUY' | 'SELL',
  amount: number,
  market: string,
  copied: boolean,
  copyResult?: 'success' | 'failed' | 'skipped'
): void {
  const stats = loadStats();
  const now = new Date().toISOString();
  
  // Update totals
  stats.totalEvents++;
  stats.lastUpdated = now;
  
  if (side === 'BUY') {
    stats.buys++;
  } else {
    stats.sells++;
  }
  
  // Update wallet stats
  if (!stats.byWallet[wallet]) {
    stats.byWallet[wallet] = { buys: 0, sells: 0, lastTrade: now };
  }
  
  if (side === 'BUY') {
    stats.byWallet[wallet].buys++;
  } else {
    stats.byWallet[wallet].sells++;
  }
  stats.byWallet[wallet].lastTrade = now;
  
  // Update copy stats
  if (copyResult === 'success') {
    stats.copied.success++;
  } else if (copyResult === 'failed') {
    stats.copied.failed++;
  } else {
    stats.copied.skipped++;
  }
  
  // Add to recent trades (keep last 50)
  stats.recentTrades.unshift({
    time: now,
    wallet: wallet.substring(0, 10) + '...',
    side,
    amount,
    market: market.substring(0, 30),
    copied,
  });
  
  if (stats.recentTrades.length > 50) {
    stats.recentTrades = stats.recentTrades.slice(0, 50);
  }
  
  saveStats(stats);
}

/**
 * Get current stats summary
 */
export function getStatsSummary(): string {
  const stats = loadStats();
  return `📊 Stats: ${stats.buys} BUY / ${stats.sells} SELL (total: ${stats.totalEvents})`;
}

/**
 * Reset stats
 */
export function resetStats(): void {
  const stats: Stats = {
    startedAt: new Date().toISOString(),
    lastUpdated: new Date().toISOString(),
    totalEvents: 0,
    buys: 0,
    sells: 0,
    byWallet: {},
    copied: { success: 0, failed: 0, skipped: 0 },
    recentTrades: [],
  };
  saveStats(stats);
}

