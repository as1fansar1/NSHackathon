import BN from "bn.js";
import { TOKEN_DECIMALS } from "./constants";

/**
 * UI cosplay scaling: real USDG on-chain is scaled up 100,000× for display.
 *
 *   1 USDG (real)  =  $100,000 (display)
 *   0.001 USDG     =  $100     (display)   ← around the pool init minimum
 *   0.0001 USDG    =  $10      (display)   ← OK for trades, BELOW pool init min
 *
 * USDG has 6 decimals, so 1 USDG = 1,000,000 base units.
 * Combined with the 100,000× display ratio: $1 display = 10 base units.
 */
export const DISPLAY_USD_PER_USDG = 100_000;
export const BASE_UNITS_PER_DISPLAY_USD =
  10 ** TOKEN_DECIMALS / DISPLAY_USD_PER_USDG; // = 10

/** Display $X → on-chain USDG base units (for tx args, must be u64). */
export function displayUsdToUnits(displayUsd: number): BN {
  return new BN(Math.round(displayUsd * BASE_UNITS_PER_DISPLAY_USD));
}

/** On-chain USDG base units → display $X. */
export function unitsToDisplayUsd(
  units: bigint | BN | number | string,
): number {
  let n: number;
  if (typeof units === "bigint") n = Number(units);
  else if (typeof units === "number") n = units;
  else if (typeof units === "string") n = Number(units);
  else n = units.toNumber();
  return n / BASE_UNITS_PER_DISPLAY_USD;
}

/** Format $X with separators and 2 decimals, e.g. 12300000 → "$12,300,000.00". */
export function formatUsd(displayUsd: number): string {
  return displayUsd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** Compact format for big numbers: 12300000 → "$12.3M". */
export function formatUsdCompact(displayUsd: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(displayUsd);
}

/** On-chain MINIMUM_LIQUIDITY = 1000 units → strictly > 1000, so display > $100. */
export const MIN_POOL_INIT_DISPLAY_USD = 100;
