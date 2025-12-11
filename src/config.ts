// Global configuration for the Polymarket Copy Trading Bot

export type SizingMode = "fixed" | "proportional";

export interface Config {
  wallets_to_track: string[];
  mode: SizingMode;
  fixed_stake?: number;  // Only used if mode = "fixed"
  min_stake: number;
  max_stake: number;
  profit_take_percent?: number;
}

export const CONFIG: Config = {
  wallets_to_track: [],
  mode: "proportional",
  min_stake: 5,
  max_stake: 300,
  profit_take_percent: 15,  // Default, overridden by TAKE_PROFIT_PERCENT env
};

export function loadConfig(): Config {
  return { ...CONFIG };
}

