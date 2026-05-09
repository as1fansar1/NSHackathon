"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  LAMPORTS_PER_SOL,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import BN from "bn.js";
import { useProgram } from "@/lib/use-program";
import { USDG_MINT, TOKEN_DECIMALS } from "@/lib/constants";
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
import { generateBurner, keypairToBase58 } from "@/lib/burner-wallet";
import { registerPseudo } from "@/lib/pseudo-client";

type Side = "yes" | "no";

export default function CreateBetPage() {
  const router = useRouter();
  const program = useProgram();
  const { publicKey } = useWallet();

  const [title, setTitle] = useState("Will I do 50 pushups?");
  const [pseudo, setPseudo] = useState("");
  const [side, setSide] = useState<Side>("yes");
  const [stakeUsd, setStakeUsd] = useState("10");
  const [marketMinutes, setMarketMinutes] = useState(5);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Commit phase length, hidden from UI. pmAMM enforces a 60s minimum on-chain.
  const COMMIT_DURATION_SEC = 60;

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

      const commitDurationSec = COMMIT_DURATION_SEC;
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

      // Register the creator's pseudo against their pubkey for the leaderboard.
      void registerPseudo(
        vaultId.toString(),
        publicKey.toBase58(),
        pseudo.trim(),
      );

      // Always provision a burner wallet for the challenger: generate a
      // fresh Keypair, fund it with $10 USDG + 0.01 SOL, store the secret
      // locally so the bet page can embed it in the QR URL.
      {
        setStatus("Funding challenger wallet ($10 USDG + 0.01 SOL for fees)…");
        const burnerKp = generateBurner();
        const burnerUsdgAta = await getAssociatedTokenAddress(
          USDG_MINT,
          burnerKp.publicKey,
          false,
          TOKEN_2022_PROGRAM_ID,
        );
        const creatorUsdgAta = await getAssociatedTokenAddress(
          USDG_MINT,
          publicKey,
          false,
          TOKEN_2022_PROGRAM_ID,
        );
        const tenDollarsUnits = displayUsdToUnits(10);

        const tx = new Transaction().add(
          // Send some SOL so the burner can pay tx fees + position-account rent
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: burnerKp.publicKey,
            lamports: 0.01 * LAMPORTS_PER_SOL,
          }),
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            burnerUsdgAta,
            burnerKp.publicKey,
            USDG_MINT,
            TOKEN_2022_PROGRAM_ID,
          ),
          createTransferCheckedInstruction(
            creatorUsdgAta,
            USDG_MINT,
            burnerUsdgAta,
            publicKey,
            BigInt(tenDollarsUnits.toString()),
            TOKEN_DECIMALS,
            [],
            TOKEN_2022_PROGRAM_ID,
          ),
        );
        await provider.sendAndConfirm(tx, [], {
          commitment: "confirmed",
        });

        // Store the burner secret for THIS vault so the creator's bet page
        // can read it back and embed it in the QR URL.
        localStorage.setItem(
          `provisioned_${vaultId.toString()}`,
          keypairToBase58(burnerKp),
        );
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
        <Field label="Your pseudo">
          <input
            type="text"
            value={pseudo}
            onChange={(e) => setPseudo(e.target.value)}
            maxLength={32}
            required
            placeholder="e.g. mathis"
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            Shown on the leaderboard at resolution.
          </p>
        </Field>

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

        <Field label="Market open for (min, after both have committed)">
          <input
            type="number"
            min={1}
            max={60}
            value={marketMinutes}
            onChange={(e) => setMarketMinutes(parseInt(e.target.value) || 1)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="text-[11px] text-gray-500 mt-1">
            How long the public market stays open before you resolve YES/NO.
          </p>
        </Field>

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

type ProviderLike = import("@coral-xyz/anchor").AnchorProvider;
