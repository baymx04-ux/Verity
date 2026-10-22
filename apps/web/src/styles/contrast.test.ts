import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.1 contrast checks for the token pairs that carry body text.
 * Tokens live in `styles/index.css`; keep these values in sync when the palette
 * changes. Decorative text (placeholders, disabled controls) is intentionally not
 * part of the AA budget.
 */
const TOKENS = {
  surface: '#ffffff',
  canvas: '#faf8ff',
  inset: '#f1f5f9',
  ink900: '#0f172a',
  ink700: '#334155',
  ink500: '#64748b',
  action: '#006194',
  actionAccent: '#0284c7',
  actionTint: '#f0f9ff',
  verifiedText: '#047857',
  verifiedBg: '#ecfdf5',
  dangerText: '#be123c',
  dangerBg: '#fff1f2',
  warningText: '#92400e',
  warningBg: '#fffbeb',
  white: '#ffffff',
} as const;

function channel(value: number): number {
  const normalised = value / 255;
  return normalised <= 0.03928 ? normalised / 12.92 : ((normalised + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(foreground: string, background: string): number {
  const light = Math.max(luminance(foreground), luminance(background));
  const dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

const AA_BODY = 4.5;
const AA_LARGE = 3;

describe('design token contrast', () => {
  it.each([
    ['primary ink on surface', TOKENS.ink900, TOKENS.surface, AA_BODY],
    ['body ink on surface', TOKENS.ink700, TOKENS.surface, AA_BODY],
    ['muted ink on surface', TOKENS.ink500, TOKENS.surface, AA_BODY],
    ['body ink on canvas', TOKENS.ink700, TOKENS.canvas, AA_BODY],
    ['body ink on inset', TOKENS.ink700, TOKENS.inset, AA_BODY],
    ['white on primary action', TOKENS.white, TOKENS.action, AA_BODY],
    ['white on action accent (large)', TOKENS.white, TOKENS.actionAccent, AA_LARGE],
    ['action text on tint', TOKENS.action, TOKENS.actionTint, AA_BODY],
    ['verified text on tint', TOKENS.verifiedText, TOKENS.verifiedBg, AA_BODY],
    ['danger text on tint', TOKENS.dangerText, TOKENS.dangerBg, AA_BODY],
    ['warning text on tint', TOKENS.warningText, TOKENS.warningBg, AA_BODY],
  ])('%s meets its contrast target', (_label, foreground, background, target) => {
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(target);
  });
});
