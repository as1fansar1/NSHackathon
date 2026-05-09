import BN from "bn.js";
import { TOKEN_DECIMALS } from "./constants";

/**
 * UI display scaling: real USDG on-chain × 2 = display dollars.
 *
 * Picked 2× because the pmAMM Commitment Vault has these on-chain limits:
 *   MIN_COMMIT       = 1 USDG  (per call)
 *   MIN_TOTAL_COMMIT = 10 USDG (yes + no combined, before launch)
 *
 * With 2×:
 *   $2  display  = 1  USDG real ← MIN_COMMIT (per side)
 *   $10 display  = 5  USDG real ← typical bet stake per side
 *   $20 display  = 10 USDG real ← MIN_TOTAL_COMMIT (both sides combined)
 *
 * So a "$10 each side" demo bet hits exactly the launch threshold.
 * USDG has 6 decimals → 1 USDG = 1,000,000 base units → $1 display = 500,000 base units.
 */
export const DISPLAY_USD_PER_USDG = 2;
export const BASE_UNITS_PER_DISPLAY_USD =
  10 ** TOKEN_DECIMALS / DISPLAY_USD_PER_USDG; // = 500_000

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

/** Format $X with separators, e.g. 1234.5 → "$1,234.50". */
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

/** Minimum displayed amount per commit (=1 USDG real, the on-chain MIN_COMMIT). */
export const MIN_COMMIT_DISPLAY_USD = 2;

/** Minimum total committed (yes + no) before launch — on-chain MIN_TOTAL_COMMIT. */
export const MIN_TOTAL_COMMIT_DISPLAY_USD = 20;
