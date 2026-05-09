import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { PROGRAM_ID, SEEDS } from "./constants";

export function registryPda(): PublicKey {
  return PublicKey.findProgramAddressSync([SEEDS.REGISTRY], PROGRAM_ID)[0];
}

export function marketPda(marketId: BN | number): PublicKey {
  const id = typeof marketId === "number" ? new BN(marketId) : marketId;
  return PublicKey.findProgramAddressSync(
    [SEEDS.MARKET, id.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
}

export function poolPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.POOL, market.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function yesMintPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.YES_MINT, market.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function noMintPda(market: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.NO_MINT, market.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function lpMintPda(pool: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [SEEDS.LP_MINT, pool.toBuffer()],
    PROGRAM_ID,
  )[0];
}
