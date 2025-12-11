/**
 * Simple Expected Value calculation
 */
export function expectedValue(
  probAi: number,
  probMarket: number,
  reward: number = 1.0
): number {
  return (probAi * reward) - (probMarket * reward);
}

/**
 * Kelly Criterion: optimal bet fraction
 */
export function kellyFraction(prob: number, odds: number): number {
  const b = odds - 1;
  return b > 0 ? (b * prob - (1 - prob)) / b : 0;
}

