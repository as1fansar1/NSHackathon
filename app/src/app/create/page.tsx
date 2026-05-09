"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import BN from "bn.js";
import { useProgram } from "@/lib/use-program";
import { USDG_MINT } from "@/lib/constants";
import { vaultPda, committerPda } from "@/lib/pda";
import {
  displayUsdToUnits,
  formatUsd,
  unitsToDisplayUsd,
} from "@/lib/display";
import {
  createToken2022Account,
  getOrCreateAta,
} from "@/lib/spl-helpers";

type Side = "yes" | "no";

export default function CreateBetPage() {
  const router = useRouter();
  const program = useProgram();
  const { publicKey } = useWallet();

  const [title, setTitle] = useState("Will I do 10 pushups?");
  const [side, setSide] = useState<Side>("yes");
  const [stakeUsd, setStakeUsd] = useState("10");
  const [commitMinutes, setCommitMinutes] = useState(1);
  const [marketMinutes, setMarketMinutes] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const stakeUnits = displayUsdToUnits(parseFloat(stakeUsd) || 0);
  // 1 USDG = 1_000_000 base units (TOKEN_DECIMALS=6)
  const usdgRealStake = stakeUnits.toNumber() / 1_000_000;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!program || !publicKey) return;
    setError(null);
    setStatus(null);
    setSubmitting(true);
    try {
      const provider = program.provider as ProviderLike;

      // Pick a unique vault_id (millis since epoch fits in u64)
      const vaultId = new BN(Date.now());
      const vault = vaultPda(vaultId);

      const commitDurationSec = Math.max(60, commitMinutes * 60);
      const marketDurationSec = Math.max(60, marketMinutes * 60);
      const resolutionTime = new BN(
        Math.floor(Date.now() / 1000) + commitDurationSec + marketDurationSec,
      );

      // 1. Pre-create the Token-2022 collateral vault owned by vault PDA
      setStatus("Creating collateral vault account…");
      const collateralVaultKp = await createToken2022Account(
        provider as never,
        USDG_MINT,
        vault,
      );

      // 2. Initialize vault
      setStatus(`Initializing vault #${vaultId.toString()}…`);
      await program.methods
        .initializeVault(
          vaultId,
          resolutionTime,
          title,
          new BN(commitDurationSec),
        )
        .accounts({
          authority: publicKey,
          vault,
          collateralMint: USDG_MINT,
          collateralVault: collateralVaultKp.publicKey,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as never)
        .rpc();

      // 3. Commit creator's side
      setStatus(`Committing your stake on ${side.toUpperCase()}…`);
      const position = committerPda(vault, publicKey);
      const userCollateral = await getOrCreateAta(
        provider as never,
        USDG_MINT,
        publicKey,
      );

      const accountsCommit = {
        user: publicKey,
        vault,
        position,
        collateralVault: collateralVaultKp.publicKey,
        userCollateral,
        collateralMint: USDG_MINT,
        systemProgram: SystemProgram.programId,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
      };
      if (side === "yes") {
        await program.methods
          .commitYes(stakeUnits)
          .accounts(accountsCommit as never)
          .rpc();
      } else {
        await program.methods
          .commitNo(stakeUnits)
          .accounts(accountsCommit as never)
          .rpc();
      }

      setStatus("Bet created. Redirecting…");
      setTimeout(() => router.push(`/bet/${vaultId.toString()}`), 800);
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
        <h1 className="text-2xl font-semibold mb-6">Create bet</h1>
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
      <h1 className="text-2xl font-semibold mt-2 mb-1">Create bet</h1>
      <p className="text-sm text-gray-500 mb-6">
        Open a 1v1 bet. Once both sides commit and the timer ends, anyone can
        join the market.
      </p>

      <form onSubmit={handleSubmit} className="space-y-5">
        <Field label="Bet title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={128}
            required
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Your side">
          <div className="grid grid-cols-2 gap-3">
            <SideButton
              active={side === "yes"}
              onClick={() => setSide("yes")}
              label="YES"
              hint="this will happen"
              color="green"
            />
            <SideButton
              active={side === "no"}
              onClick={() => setSide("no")}
              label="NO"
              hint="this won't happen"
              color="red"
            />
          </div>
        </Field>

        <Field label="Your stake ($)">
          <input
            type="number"
            min="2"
            step="1"
            value={stakeUsd}
            onChange={(e) => setStakeUsd(e.target.value)}
            required
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
          />
          <p className="text-[11px] text-gray-500 mt-1 font-mono">
            ≈ {formatUsd(parseFloat(stakeUsd) || 0)} = {usdgRealStake.toFixed(2)}{" "}
            USDG real. Min $2 per commit, $20 combined to launch the market.
            Challenger should match.
          </p>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Commit phase (min)">
            <input
              type="number"
              min={1}
              max={60}
              value={commitMinutes}
              onChange={(e) =>
                setCommitMinutes(parseInt(e.target.value) || 1)
              }
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Market phase (min)">
            <input
              type="number"
              min={1}
              max={60}
              value={marketMinutes}
              onChange={(e) =>
                setMarketMinutes(parseInt(e.target.value) || 1)
              }
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <p className="text-[11px] text-gray-500 -mt-3 font-mono">
          After commit ends → anyone calls Launch → market is open for{" "}
          {marketMinutes} min → you resolve YES/NO.
        </p>

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting
            ? "Submitting…"
            : `Create bet & commit ${formatUsd(parseFloat(stakeUsd) || 0)} on ${side.toUpperCase()}`}
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

function SideButton({
  active,
  onClick,
  label,
  hint,
  color,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hint: string;
  color: "green" | "red";
}) {
  const activeClass =
    color === "green"
      ? "bg-green-600 border-green-600 text-white"
      : "bg-red-600 border-red-600 text-white";
  const idleClass =
    "border-gray-300 text-gray-700 hover:border-gray-400 bg-white";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border-2 py-3 text-sm font-medium transition ${active ? activeClass : idleClass}`}
    >
      <div className="font-bold">{label}</div>
      <div
        className={`text-[11px] font-normal ${active ? "opacity-90" : "text-gray-500"}`}
      >
        {hint}
      </div>
    </button>
  );
}

type ProviderLike = {
  publicKey?: import("@solana/web3.js").PublicKey;
  connection: import("@solana/web3.js").Connection;
};
