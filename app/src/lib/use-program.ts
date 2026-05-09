"use client";

import { useMemo } from "react";
import {
  useAnchorWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import { getProgram } from "./program";

export function useProgram() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  return useMemo(() => {
    if (!wallet) return null;
    return getProgram(connection, wallet);
  }, [connection, wallet]);
}
