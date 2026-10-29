import { describe, expect, it } from 'vitest';

import { estimateCostUsd, hasConfiguredPricing, roundCurrency } from './cost';

describe('cost estimation', () => {
  it('prices input and output tokens at per-million rates', () => {
    expect(
      estimateCostUsd(1_000_000, 500_000, { inputPerMillion: 1.5, outputPerMillion: 2 }),
    ).toBe(2.5);
  });

  it('returns null when the provider reported no usage', () => {
    expect(estimateCostUsd(null, undefined, { inputPerMillion: 1, outputPerMillion: 1 })).toBe(
      null,
    );
  });

  it('treats only positive rates as configured pricing', () => {
    expect(hasConfiguredPricing({ inputPerMillion: 0, outputPerMillion: 0 })).toBe(false);
    expect(hasConfiguredPricing({ inputPerMillion: 0, outputPerMillion: 0.5 })).toBe(true);
  });

  it('rounds to six decimal places for storage', () => {
    expect(roundCurrency(0.00000049)).toBe(0);
    expect(estimateCostUsd(3, 7, { inputPerMillion: 0.1, outputPerMillion: 0.1 })).toBe(
      0.000001,
    );
  });
});
