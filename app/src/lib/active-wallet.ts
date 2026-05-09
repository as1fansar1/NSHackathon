"use client";

import { useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import { useParams } from "next/navigation";
import {
  BurnerRecord,
  loadBurner,
  keypairFromBase58,
} from "./burner-wallet";
import { getProgram } from "./program";

export type ActiveWallet = {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(
    t: T,
  ) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(
    ts: T[],
  ) => Promise<T[]>;
  type: "phantom" | "burner";
  pseudo?: string;
  disconnect?: () => void;
};

/**
 * Returns the currently active wallet for this page.
 *
 * - On a /bet/[id] page, if a burner wallet is stored for this vault,
 *   that burner takes priority over Phantom.
 * - Otherwise falls back to the Phantom (wallet-adapter) wallet.
 */
export function useActiveWallet(): ActiveWallet | null {
  const phantom = useAnchorWallet();
  const params = useParams<{ id?: string }>();
  const vaultId = params?.id;
  const [burner, setBurner] = useState<BurnerRecord | null>(null);

  useEffect(() => {
    if (!vaultId) {
      setBurner(null);
      return;
    }
    setBurner(loadBurner(vaultId));
  }, [vaultId]);

  return useMemo(() => {
    if (burner) {
      const kp = keypairFromBase58(burner.secretKey);
      return makeKeypairWallet(kp, burner.pseudo);
    }
    if (phantom) {
      return {
        publicKey: phantom.publicKey,
        signTransaction: phantom.signTransaction.bind(phantom),
        signAllTransactions: phantom.signAllTransactions.bind(phantom),
        type: "phantom" as const,
      };
    }
    return null;
  }, [burner, phantom]);
}

export function makeKeypairWallet(
  kp: Keypair,
  pseudo?: string,
): ActiveWallet {
  return {
    publicKey: kp.publicKey,
    type: "burner",
    pseudo,
    async signTransaction<T extends Transaction | VersionedTransaction>(
      t: T,
    ) {
      if (t instanceof Transaction) {
        t.partialSign(kp);
      } else {
        // VersionedTransaction
        t.sign([kp]);
      }
      return t;
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(
      ts: T[],
    ) {
      for (const t of ts) {
        if (t instanceof Transaction) t.partialSign(kp);
        else t.sign([kp]);
      }
      return ts;
    },
  };
}

/**
 * Anchor program scoped to the active wallet (burner or Phantom).
 */
export function useActiveProgram(): Program | null {
  const wallet = useActiveWallet();
  const { connection } = useConnection();

  return useMemo(() => {
    if (!wallet) return null;
    return getProgram(connection, wallet as AnchorProvider["wallet"]);
  }, [connection, wallet]);
}
