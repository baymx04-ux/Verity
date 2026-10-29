export interface TokenRates {
  /** USD per one million input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per one million output (completion) tokens. */
  outputPerMillion: number;
}

export const DEFAULT_TOKEN_RATES: TokenRates = {
  inputPerMillion: 0,
  outputPerMillion: 0,
};

export function hasConfiguredPricing(rates: TokenRates): boolean {
  return rates.inputPerMillion > 0 || rates.outputPerMillion > 0;
}

/**
 * Estimate request cost from token usage and configured rates.
 *
 * Returns null when the provider did not report usage, so dashboards can show
 * "not available" instead of inventing a zero. A configured rate of 0 is
 * treated as unpriced by `hasConfiguredPricing`, not as free usage.
 */
export function estimateCostUsd(
  promptTokens: number | null | undefined,
  completionTokens: number | null | undefined,
  rates: TokenRates,
): number | null {
  const input = normalizeTokens(promptTokens);
  const output = normalizeTokens(completionTokens);
  if (input === null && output === null) {
    return null;
  }

  const cost = ((input ?? 0) / 1_000_000) * rates.inputPerMillion;
  const outputCost = ((output ?? 0) / 1_000_000) * rates.outputPerMillion;
  return roundCurrency(cost + outputCost);
}

function normalizeTokens(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function roundCurrency(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
