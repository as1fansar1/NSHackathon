"use client";

import { use, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { SystemProgram } from "@solana/web3.js";
import BN from "bn.js";
import { QRCodeSVG } from "qrcode.react";
import { useProgram } from "@/lib/use-program";
import { vaultPda, committerPda } from "@/lib/pda";
import { USDG_MINT } from "@/lib/constants";
import {
  displayUsdToUnits,
  formatUsd,
  unitsToDisplayUsd,
} from "@/lib/display";
import { getOrCreateAta } from "@/lib/spl-helpers";

type VaultData = {
  authority: string;
  collateralVault: string;
  commitEndTime: number;
  resolutionTime: number;
  yesTotal: bigint;
  noTotal: bigint;
  launched: boolean;
  vaultId: string;
  title: string;
};

type PositionData = {
  yesAmount: bigint;
  noAmount: bigint;
  claimed: boolean;
  refunded: boolean;
};

export default function BetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const program = useProgram();
  const { publicKey } = useWallet();

  const [vault, setVault] = useState<VaultData | null>(null);
  const [position, setPosition] = useState<PositionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [pageUrl, setPageUrl] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    setPageUrl(window.location.href);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!program) return;
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const vaultAddr = vaultPda(new BN(id));
        const v = await (program.account as never as VaultAccount).vault.fetch(
          vaultAddr,
        );
        if (cancelled) return;
        setVault({
          authority: v.authority.toBase58(),
          collateralVault: v.collateralVault.toBase58(),
          commitEndTime: v.commitEndTime.toNumber(),
          resolutionTime: v.resolutionTime.toNumber(),
          yesTotal: BigInt(v.yesTotal.toString()),
          noTotal: BigInt(v.noTotal.toString()),
          launched: v.launched,
          vaultId: v.vaultId.toString(),
          title: v.title,
        });

        if (publicKey) {
          const posAddr = committerPda(vaultAddr, publicKey);
          try {
            const p = await (
              program.account as never as PositionAccount
            ).committerPosition.fetch(posAddr);
            if (cancelled) return;
            setPosition({
              yesAmount: BigInt(p.yesAmount.toString()),
              noAmount: BigInt(p.noAmount.toString()),
              claimed: p.claimed,
              refunded: p.refunded,
            });
          } catch {
            if (!cancelled) setPosition(null);
          }
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program, id, publicKey, refreshTick]);

  if (!publicKey) {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
        <h1 className="text-2xl font-semibold mb-6">Bet #{id}</h1>
        <p className="text-gray-500 mb-4">
          Connect your wallet to view and join this bet.
        </p>
        <WalletMultiButton />
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
        <a href="/" className="text-sm text-gray-500 hover:underline">
          ← Back
        </a>
        <h1 className="text-2xl font-semibold mt-2 mb-4">Bet #{id}</h1>
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      </main>
    );
  }

  if (!vault) {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  const youAreAuthority = vault.authority === publicKey.toBase58();
  const yesTotalUsd = unitsToDisplayUsd(vault.yesTotal);
  const noTotalUsd = unitsToDisplayUsd(vault.noTotal);
  const totalUsd = yesTotalUsd + noTotalUsd;
  const yesPct = totalUsd > 0 ? (yesTotalUsd / totalUsd) * 100 : 50;

  const inCommitPhase = !vault.launched && now < vault.commitEndTime;
  const commitEnded = !vault.launched && now >= vault.commitEndTime;

  const commitRemaining = vault.commitEndTime - now;

  const yourSide = position
    ? position.yesAmount > 0n
      ? "yes"
      : position.noAmount > 0n
        ? "no"
        : null
    : null;
  const yourStakeUsd = position
    ? unitsToDisplayUsd(position.yesAmount + position.noAmount)
    : 0;
  const creatorSide = "—"; // Would need to read creator's position; left simple for now

  return (
    <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
      <a href="/" className="text-sm text-gray-500 hover:underline">
        ← Back
      </a>
      <div className="mt-2 mb-1 text-xs text-gray-500 font-mono">
        Bet #{vault.vaultId}
      </div>
      <h1 className="text-2xl font-semibold mb-6">{vault.title}</h1>

      {/* Status banner */}
      <div
        className={`rounded p-4 text-sm mb-6 ${
          vault.launched
            ? "bg-blue-50 border border-blue-200"
            : commitEnded
              ? "bg-orange-50 border border-orange-200"
              : "bg-gray-50 border border-gray-200"
        }`}
      >
        {inCommitPhase && (
          <>
            <div className="font-medium">Commit phase</div>
            <div className="text-xs text-gray-600 mt-1 font-mono">
              {formatRemaining(commitRemaining)} remaining — both sides commit
              their stakes.
            </div>
          </>
        )}
        {commitEnded && (
          <>
            <div className="font-medium">Ready to launch</div>
            <div className="text-xs text-gray-600 mt-1">
              Commit phase over. Anyone can launch the market.
            </div>
          </>
        )}
        {vault.launched && (
          <>
            <div className="font-medium">Market live</div>
            <div className="text-xs text-gray-600 mt-1">
              Public trading is open. Buy YES or NO at AMM prices.
            </div>
          </>
        )}
      </div>

      {/* Stake totals */}
      <div className="rounded border border-gray-200 p-5 mb-6">
        <h2 className="text-sm font-medium text-gray-500 mb-3">
          Total committed
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <Stat
            label={`YES (${yesPct.toFixed(0)}%)`}
            value={formatUsd(yesTotalUsd)}
            color="green"
          />
          <Stat
            label={`NO (${(100 - yesPct).toFixed(0)}%)`}
            value={formatUsd(noTotalUsd)}
            color="red"
          />
        </div>
        {totalUsd > 0 && (
          <div className="mt-4 h-2 rounded overflow-hidden bg-gray-100 flex">
            <div
              className="bg-green-500 h-full"
              style={{ width: `${yesPct}%` }}
            />
            <div
              className="bg-red-500 h-full"
              style={{ width: `${100 - yesPct}%` }}
            />
          </div>
        )}
      </div>

      {/* Your position */}
      {position && (position.yesAmount > 0n || position.noAmount > 0n) && (
        <div className="rounded border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-medium text-gray-500 mb-3">
            Your position
          </h2>
          <div className="text-sm">
            {formatUsd(yourStakeUsd)} on{" "}
            <span
              className={
                yourSide === "yes" ? "text-green-600" : "text-red-600"
              }
            >
              {yourSide?.toUpperCase()}
            </span>
            {position.claimed && (
              <span className="ml-2 text-gray-500">(claimed)</span>
            )}
            {position.refunded && (
              <span className="ml-2 text-gray-500">(refunded)</span>
            )}
          </div>
        </div>
      )}

      {/* Match bet (challenger flow) */}
      {inCommitPhase && !position && !youAreAuthority && program && (
        <MatchBetSection
          program={program}
          vaultId={id}
          collateralVault={vault.collateralVault}
          onSuccess={() => setRefreshTick((t) => t + 1)}
        />
      )}

      {/* QR code for sharing */}
      {inCommitPhase && pageUrl && (
        <div className="rounded border border-gray-200 p-5 mb-6">
          <h2 className="text-sm font-medium text-gray-500 mb-3">
            Share with the challenger
          </h2>
          <div className="flex flex-col items-center gap-3">
            <div className="bg-white p-3 rounded border border-gray-100">
              <QRCodeSVG value={pageUrl} size={160} />
            </div>
            <div className="text-[11px] text-gray-500 font-mono break-all text-center">
              {pageUrl}
            </div>
          </div>
        </div>
      )}

      {creatorSide && false && <span>{creatorSide}</span>}
    </main>
  );
}

function MatchBetSection({
  program,
  vaultId,
  collateralVault,
  onSuccess,
}: {
  program: import("@coral-xyz/anchor").Program;
  vaultId: string;
  collateralVault: string;
  onSuccess: () => void;
}) {
  const { publicKey } = useWallet();
  const [side, setSide] = useState<"yes" | "no">("no");
  const [stakeUsd, setStakeUsd] = useState("500000");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleMatch(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey) return;
    setError(null);
    setSubmitting(true);
    try {
      const provider = program.provider as never as ProviderLike;
      const vault = vaultPda(new BN(vaultId));
      const position = committerPda(vault, publicKey);

      const userCollateral = await getOrCreateAta(
        provider as never,
        USDG_MINT,
        publicKey,
      );

      const accounts = {
        user: publicKey,
        vault,
        position,
        collateralVault: new (await import("@solana/web3.js")).PublicKey(
          collateralVault,
        ),
        userCollateral,
        collateralMint: USDG_MINT,
        systemProgram: SystemProgram.programId,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
      };
      const amount = displayUsdToUnits(parseFloat(stakeUsd) || 0);

      if (side === "yes") {
        await program.methods
          .commitYes(amount)
          .accounts(accounts as never)
          .rpc();
      } else {
        await program.methods
          .commitNo(amount)
          .accounts(accounts as never)
          .rpc();
      }
      onSuccess();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={handleMatch}
      className="rounded border border-gray-200 p-5 mb-6 space-y-4"
    >
      <h2 className="text-sm font-medium text-gray-500">Match this bet</h2>

      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setSide("yes")}
          className={`rounded border-2 py-3 text-sm font-bold ${
            side === "yes"
              ? "bg-green-600 border-green-600 text-white"
              : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
          }`}
        >
          YES
        </button>
        <button
          type="button"
          onClick={() => setSide("no")}
          className={`rounded border-2 py-3 text-sm font-bold ${
            side === "no"
              ? "bg-red-600 border-red-600 text-white"
              : "border-gray-300 bg-white text-gray-700 hover:border-gray-400"
          }`}
        >
          NO
        </button>
      </div>

      <label className="block">
        <div className="text-sm font-medium mb-1">Your stake ($)</div>
        <input
          type="number"
          min="100000"
          step="10000"
          value={stakeUsd}
          onChange={(e) => setStakeUsd(e.target.value)}
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
        <p className="text-[11px] text-gray-500 mt-1">
          ≈ {formatUsd(parseFloat(stakeUsd) || 0)} display.
        </p>
      </label>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting
          ? "Submitting…"
          : `Commit ${formatUsd(parseFloat(stakeUsd) || 0)} on ${side.toUpperCase()}`}
      </button>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      )}
    </form>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: "green" | "red";
}) {
  const colorClass = color === "green" ? "text-green-700" : "text-red-700";
  return (
    <div className="rounded border border-gray-100 p-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={`font-mono text-lg ${colorClass}`}>{value}</div>
    </div>
  );
}

function formatRemaining(s: number): string {
  if (s <= 0) return "0s";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

type ProviderLike = {
  publicKey?: import("@solana/web3.js").PublicKey;
  connection: import("@solana/web3.js").Connection;
};
type VaultAccount = {
  vault: {
    fetch: (a: import("@solana/web3.js").PublicKey) => Promise<{
      authority: import("@solana/web3.js").PublicKey;
      collateralVault: import("@solana/web3.js").PublicKey;
      commitEndTime: BN;
      resolutionTime: BN;
      yesTotal: BN;
      noTotal: BN;
      launched: boolean;
      vaultId: BN;
      title: string;
    }>;
  };
};
type PositionAccount = {
  committerPosition: {
    fetch: (a: import("@solana/web3.js").PublicKey) => Promise<{
      yesAmount: BN;
      noAmount: BN;
      claimed: boolean;
      refunded: boolean;
    }>;
  };
};
