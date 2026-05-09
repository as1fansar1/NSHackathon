"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
  getAccount,
} from "@solana/spl-token";
import { USDG_MINT, TOKEN_DECIMALS } from "@/lib/constants";

export default function Home() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [usdgBalance, setUsdgBalance] = useState<string | null>(null);
  const [solBalance, setSolBalance] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) {
      setUsdgBalance(null);
      setSolBalance(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const lamports = await connection.getBalance(publicKey);
        if (!cancelled) setSolBalance((lamports / 1e9).toFixed(4));

        const ata = await getAssociatedTokenAddress(
          USDG_MINT,
          publicKey,
          false,
          TOKEN_2022_PROGRAM_ID,
        );
        try {
          const acct = await getAccount(
            connection,
            ata,
            "confirmed",
            TOKEN_2022_PROGRAM_ID,
          );
          if (!cancelled) {
            const ui = Number(acct.amount) / 10 ** TOKEN_DECIMALS;
            setUsdgBalance(ui.toFixed(2));
          }
        } catch {
          if (!cancelled) setUsdgBalance("0.00");
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connection, publicKey]);

  return (
    <main className="flex-1 max-w-3xl mx-auto px-6 py-12 w-full">
      <header className="flex justify-between items-center mb-12">
        <h1 className="text-2xl font-semibold tracking-tight">
          NS Hackathon — pm-AMM
        </h1>
        <WalletMultiButton />
      </header>

      {!publicKey ? (
        <p className="text-gray-500">Connect your Phantom wallet (devnet).</p>
      ) : (
        <section className="space-y-6">
          <div className="rounded-lg border border-gray-200 p-5">
            <h2 className="text-sm font-medium text-gray-500 mb-3">
              Connected wallet
            </h2>
            <div className="font-mono text-xs break-all">
              {publicKey.toBase58()}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4">
              <Stat label="SOL" value={solBalance ?? "…"} />
              <Stat label="USDG" value={usdgBalance ?? "…"} />
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-gray-200 p-5 text-sm text-gray-600">
            <p>
              Need devnet SOL? Use{" "}
              <a
                className="underline"
                href="https://faucet.solana.com"
                target="_blank"
                rel="noreferrer"
              >
                faucet.solana.com
              </a>
              .
            </p>
            <p className="mt-2">
              USDG faucet:{" "}
              <a
                className="underline"
                href="https://faucet.paxos.com/"
                target="_blank"
                rel="noreferrer"
              >
                faucet.paxos.com
              </a>
              .
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-gray-100 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-mono text-lg">{value}</div>
    </div>
  );
}
