import { Program } from "@coral-xyz/anchor";
import BN from "bn.js";
import { marketPda, registryPda } from "./pda";

const cache = new Map<string, BN>(); // vault_id (as string) → market_id (BN)

/**
 * Find the market_id created by `launch_vault_market` for the given vault.
 * pmAMM doesn't store the market reference in the vault state, so we iterate
 * from the latest market_id backwards and match by title.
 *
 * Cached in-memory for the page lifetime.
 */
export async function findMarketIdForVault(
  program: Program,
  vaultIdStr: string,
  vaultTitle: string,
): Promise<BN | null> {
  if (cache.has(vaultIdStr)) return cache.get(vaultIdStr)!;

  const reg = await (
    program.account as never as RegistryAcc
  ).registry.fetch(registryPda());
  const marketCount = new BN(reg.marketCount.toString());

  // Iterate from latest down to 1
  for (let i = marketCount.toNumber(); i >= 1; i--) {
    try {
      const id = new BN(i);
      const m = await (program.account as never as MarketAcc).market.fetch(
        marketPda(id),
      );
      if (m.title === vaultTitle) {
        cache.set(vaultIdStr, id);
        return id;
      }
    } catch {
      // skip uninitialized
    }
  }
  return null;
}

type RegistryAcc = {
  registry: {
    fetch: (a: import("@solana/web3.js").PublicKey) => Promise<{
      marketCount: BN;
    }>;
  };
};
type MarketAcc = {
  market: {
    fetch: (a: import("@solana/web3.js").PublicKey) => Promise<{
      title: string;
      authority: import("@solana/web3.js").PublicKey;
      yesMint: import("@solana/web3.js").PublicKey;
      noMint: import("@solana/web3.js").PublicKey;
      collateralMint: import("@solana/web3.js").PublicKey;
      resolutionTime: BN;
      resolved: boolean;
      winningOutcome: boolean;
      outcomeSet: boolean;
      marketId: BN;
    }>;
  };
};
