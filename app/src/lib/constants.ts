import { PublicKey } from "@solana/web3.js";

export const PROGRAM_ID = new PublicKey(
  "EvWE8LGzzyZRDASKLnLBy9qZRuL8iaJYiPf2mRZh75yV",
);

export const USDG_MINT = new PublicKey(
  "4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7",
);

// Platform treasury — receives the 1% platform fee on every audience bet.
// Reuses the faucet keypair (same one we fund spectators from) so we don't
// have to manage another wallet for the demo.
export const PLATFORM_TREASURY = new PublicKey(
  "HmECJ1Fww5PyxHybSkDTDgUwP4HGm1aXdrugDX57cH36",
);

// 100 bps = 1%
export const PLATFORM_FEE_BPS = 100;
// LP fee charged by pmAMM on buy_outcome_tokens (matches VAULT_LP_FEE_BPS).
export const LP_FEE_BPS = 100;

export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

export const TOKEN_DECIMALS = 6;

export const SEEDS = {
  REGISTRY: Buffer.from("registry"),
  VAULT: Buffer.from("vault"),
  COMMITTER: Buffer.from("committer"),
  MARKET: Buffer.from("market"),
  POOL: Buffer.from("pool"),
  LP_MINT: Buffer.from("lp_mint"),
  YES_MINT: Buffer.from("yes_mint"),
  NO_MINT: Buffer.from("no_mint"),
};
