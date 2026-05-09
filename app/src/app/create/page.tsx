"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import BN from "bn.js";
import { useProgram } from "@/lib/use-program";
import { USDG_MINT } from "@/lib/constants";
import {
  registryPda,
  marketPda,
  yesMintPda,
  noMintPda,
} from "@/lib/pda";

export default function CreateMarketPage() {
  const router = useRouter();
  const program = useProgram();
  const { publicKey } = useWallet();

  const [title, setTitle] = useState("Will SOL hit $500 by end of 2026?");
  const [durationMinutes, setDurationMinutes] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!program || !publicKey) return;
    setError(null);
    setStatus(null);
    setSubmitting(true);
    try {
      // 1. Fetch registry to know next market_id
      setStatus("Reading registry…");
      const registry = registryPda();
      const reg = await (program.account as any).registry.fetch(registry);
      const nextId = new BN(reg.marketCount.toString()).addn(1);

      // 2. Derive PDAs
      const market = marketPda(nextId);
      const yesMint = yesMintPda(market);
      const noMint = noMintPda(market);

      // 3. Build resolution_time = now + duration
      const resolutionTime = new BN(
        Math.floor(Date.now() / 1000) + durationMinutes * 60,
      );

      setStatus(
        `Creating market #${nextId.toString()}… (sign in your wallet)`,
      );
      const sig = await program.methods
        .createMarket(resolutionTime, title)
        .accounts({
          authority: publicKey,
          registry,
          market,
          collateralMint: USDG_MINT,
          yesMint,
          noMint,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as any)
        .rpc();

      setStatus(`Market #${nextId.toString()} created. Tx: ${sig}`);
      setTimeout(() => router.push(`/market/${nextId.toString()}`), 1500);
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!publicKey) {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
        <h1 className="text-2xl font-semibold mb-6">Create market</h1>
        <p className="text-gray-500 mb-4">Connect your wallet first.</p>
        <WalletMultiButton />
      </main>
    );
  }

  return (
    <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
      <a href="/" className="text-sm text-gray-500 hover:underline">
        ← Back
      </a>
      <h1 className="text-2xl font-semibold mt-2 mb-6">Create market</h1>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="Title (max 128 chars)">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={128}
            required
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Resolves in (minutes)">
          <input
            type="number"
            min={1}
            max={10080}
            value={durationMinutes}
            onChange={(e) => setDurationMinutes(parseInt(e.target.value) || 1)}
            required
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-500 mt-1">
            For testing the full lifecycle, use 2–5 min. You become the
            authority and can resolve YES/NO after this delay.
          </p>
        </Field>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "Create market"}
        </button>
      </form>

      {status && (
        <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-3 text-xs font-mono break-all">
          {status}
        </div>
      )}
      {error && (
        <div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      )}
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium mb-1">{label}</div>
      {children}
    </label>
  );
}
