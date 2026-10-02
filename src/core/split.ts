/**
 * Split arithmetic. Every amount is an integer number of cents, so nothing
 * here can drift by a rounding error: the parts always add up to the invoice.
 * Framework-free — `node --test` loads this file directly.
 */

export const MIN_AMOUNT_CENTS = 100; // $1.00
export const MAX_AMOUNT_CENTS = 100_000_000; // $1,000,000.00

export interface Allocation {
  /** Destination key (see DESTINATIONS). */
  symbol: string;
  /** Whole percent of the stock portion. All shares must add up to 100. */
  share: number;
}

export interface AllocatedAmount extends Allocation {
  cents: number;
}

export interface Split {
  usdgCents: number;
  stockCents: number;
}

/** Parse what a person types ("1,000", "$250.5", "80.00") into cents. Null when it is not an amount. */
export function parseAmount(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!/^\d{1,9}(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function formatUsd(cents: number): string {
  const whole = Math.trunc(cents / 100).toLocaleString("en-US");
  return `$${whole}.${String(cents % 100).padStart(2, "0")}`;
}

/** Dollars without cents when the amount is whole ("$800"), with cents otherwise. */
export function formatUsdShort(cents: number): string {
  return cents % 100 === 0 ? `$${(cents / 100).toLocaleString("en-US")}` : formatUsd(cents);
}

/** Stock portion rounds to the nearest cent; the USDG portion is the exact remainder. */
export function splitAmount(amountCents: number, stockPercent: number): Split {
  const stockCents = Math.floor((amountCents * stockPercent + 50) / 100);
  return { usdgCents: amountCents - stockCents, stockCents };
}

/**
 * Divide the stock portion between destinations by share. Leftover cents go
 * to the largest fractional remainders (ties: listed order), so the parts
 * sum to `stockCents` exactly.
 */
export function allocateStock(stockCents: number, allocations: Allocation[]): AllocatedAmount[] {
  const exact = allocations.map((a) => (stockCents * a.share) / 100);
  const result = allocations.map((a, i) => ({ ...a, cents: Math.floor(exact[i]) }));
  let leftover = stockCents - result.reduce((sum, a) => sum + a.cents, 0);
  const byRemainder = exact
    .map((value, i) => ({ i, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  for (const { i } of byRemainder) {
    if (leftover <= 0) break;
    result[i].cents += 1;
    leftover -= 1;
  }
  return result;
}

/** Equal whole-percent shares that add up to 100 (the first ones take the remainder). */
export function evenShares(count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(100 / count);
  const extra = 100 - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < extra ? 1 : 0));
}

export function shareTotal(allocations: Allocation[]): number {
  return allocations.reduce((sum, a) => sum + (Number.isFinite(a.share) ? a.share : 0), 0);
}
