"use client";

import { use, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Keypair,
} from "@solana/web3.js";
import BN from "bn.js";
import { Program } from "@coral-xyz/anchor";
import { useProgram } from "@/lib/use-program";
import { marketPda, poolPda, lpMintPda, yesMintPda, noMintPda } from "@/lib/pda";
import { USDG_MINT, TOKEN_DECIMALS } from "@/lib/constants";
import {
  createToken2022Account,
  getOrCreateAta,
} from "@/lib/spl-helpers";

type MarketData = {
  authority: string;
  yesMint: string;
  noMint: string;
  collateralMint: string;
  resolutionTime: number;
  resolved: boolean;
  winningOutcome: boolean;
  outcomeSet: boolean;
  marketId: string;
  title: string;
  poolExists: boolean;
};

export default function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const program = useProgram();
  const { publicKey } = useWallet();

  const [market, setMarket] = useState<MarketData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

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
        const marketAddr = marketPda(new BN(id));
        const m = await (program.account as any).market.fetch(marketAddr);

        const poolAddr = poolPda(marketAddr);
        const poolInfo =
          await program.provider.connection.getAccountInfo(poolAddr);

        if (cancelled) return;
        setMarket({
          authority: m.authority.toBase58(),
          yesMint: m.yesMint.toBase58(),
          noMint: m.noMint.toBase58(),
          collateralMint: m.collateralMint.toBase58(),
          resolutionTime: m.resolutionTime.toNumber(),
          resolved: m.resolved,
          winningOutcome: m.winningOutcome,
          outcomeSet: m.outcomeSet,
          marketId: m.marketId.toString(),
          title: m.title,
          poolExists: poolInfo !== null,
        });
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [program, id]);

  if (!publicKey) {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
        <h1 className="text-2xl font-semibold mb-6">Market #{id}</h1>
        <p className="text-gray-500 mb-4">Connect your wallet first.</p>
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
        <h1 className="text-2xl font-semibold mt-2 mb-4">Market #{id}</h1>
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      </main>
    );
  }

  if (!market) {
    return (
      <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
        <p className="text-sm text-gray-500">Loading…</p>
      </main>
    );
  }

  const youAreAuthority =
    publicKey && market.authority === publicKey.toBase58();
  const remaining = market.resolutionTime - now;
  const expired = remaining <= 0;

  return (
    <main className="flex-1 max-w-2xl mx-auto px-6 py-12 w-full">
      <a href="/" className="text-sm text-gray-500 hover:underline">
        ← Back
      </a>
      <div className="mt-2 mb-1 text-xs text-gray-500 font-mono">
        Market #{market.marketId}
      </div>
      <h1 className="text-2xl font-semibold mb-6">{market.title}</h1>

      <div className="space-y-4">
        <Row label="Authority">
          <div className="font-mono text-xs break-all">
            {market.authority}
            {youAreAuthority && (
              <span className="ml-2 text-green-600 font-sans">(you)</span>
            )}
          </div>
        </Row>

        <Row label="Resolution">
          {market.resolved ? (
            <span
              className={`font-medium ${market.winningOutcome ? "text-green-600" : "text-red-600"}`}
            >
              {market.winningOutcome ? "YES wins" : "NO wins"}
            </span>
          ) : expired ? (
            <span className="text-orange-600 font-medium">
              Expired — awaiting resolve
            </span>
          ) : (
            <span className="font-mono">
              {formatRemaining(remaining)} remaining
            </span>
          )}
        </Row>

        <Row label="Pool">
          {market.poolExists ? (
            <span className="text-green-600">Initialized</span>
          ) : (
            <span className="text-gray-500">Not initialized</span>
          )}
        </Row>

        <Row label="Collateral">
          <div className="font-mono text-xs break-all">
            {market.collateralMint}
          </div>
        </Row>
      </div>

      {!market.poolExists && youAreAuthority && program && (
        <InitializePoolSection
          program={program}
          marketId={id}
          onSuccess={() => {
            // Trigger reload by toggling state
            setMarket((m) => (m ? { ...m, poolExists: true } : m));
          }}
        />
      )}
    </main>
  );
}

function InitializePoolSection({
  program,
  marketId,
  onSuccess,
}: {
  program: Program;
  marketId: string;
  onSuccess: () => void;
}) {
  const [collateralAmount, setCollateralAmount] = useState("10");
  const [initialPriceBps, setInitialPriceBps] = useState(5000);
  const [feeBps, setFeeBps] = useState(0);
  const [isDynamic, setIsDynamic] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setStatus(null);
    setSubmitting(true);
    try {
      const provider = program.provider as AnchorProviderLike;
      const payer = provider.publicKey!;
      const connection = provider.connection;

      const market = marketPda(new BN(marketId));
      const pool = poolPda(market);
      const lpMint = lpMintPda(pool);
      const yesMint = yesMintPda(market);
      const noMint = noMintPda(market);

      setStatus("Ensuring USDG account exists…");
      const payerCollateral = await getOrCreateAta(
        provider as never,
        USDG_MINT,
        payer,
      );

      setStatus("Creating collateral reserve (Token-2022)…");
      const collateralReserveKp = await createToken2022Account(
        provider as never,
        USDG_MINT,
        pool,
      );

      const yesReserveKp = Keypair.generate();
      const noReserveKp = Keypair.generate();

      const payerLp = await getAssociatedTokenAddress(lpMint, payer);

      const amount = new BN(
        Math.floor(parseFloat(collateralAmount) * 10 ** TOKEN_DECIMALS),
      );

      setStatus("Initializing pool… (sign in your wallet)");
      const sig = await program.methods
        .initializePool(amount, isDynamic, feeBps, initialPriceBps)
        .accounts({
          payer,
          market,
          pool,
          lpMint,
          yesReserve: yesReserveKp.publicKey,
          noReserve: noReserveKp.publicKey,
          collateralReserve: collateralReserveKp.publicKey,
          yesMint,
          noMint,
          collateralMint: USDG_MINT,
          payerCollateral,
          payerLp,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as never)
        .signers([yesReserveKp, noReserveKp])
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
        ])
        .rpc();

      setStatus(`Pool initialized. Tx: ${sig.slice(0, 12)}…`);
      // small wait then mark done
      void connection;
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
      onSubmit={handleInit}
      className="mt-8 rounded border border-gray-200 p-5 space-y-4"
    >
      <h3 className="text-lg font-medium">Initialize pool</h3>
      <p className="text-xs text-gray-500">
        You&apos;re the authority. Seed the market with USDG liquidity.
      </p>

      <label className="block">
        <div className="text-sm font-medium mb-1">USDG liquidity</div>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={collateralAmount}
          onChange={(e) => setCollateralAmount(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          required
        />
      </label>

      <label className="block">
        <div className="text-sm font-medium mb-1">
          Initial YES price: {(initialPriceBps / 100).toFixed(2)}%
        </div>
        <input
          type="range"
          min={100}
          max={9900}
          step={100}
          value={initialPriceBps}
          onChange={(e) => setInitialPriceBps(parseInt(e.target.value))}
          className="w-full"
        />
      </label>

      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <div className="text-sm font-medium mb-1">Fee (bps)</div>
          <input
            type="number"
            min={0}
            max={1000}
            value={feeBps}
            onChange={(e) => setFeeBps(parseInt(e.target.value) || 0)}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
          />
        </label>
        <label className="flex items-center gap-2 pt-7">
          <input
            type="checkbox"
            checked={isDynamic}
            onChange={(e) => setIsDynamic(e.target.checked)}
          />
          <span className="text-sm">Dynamic L (time-decaying)</span>
        </label>
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Initialize pool"}
      </button>

      {status && (
        <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs font-mono break-all">
          {status}
        </div>
      )}
      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      )}
    </form>
  );
}

type AnchorProviderLike = {
  publicKey?: import("@solana/web3.js").PublicKey;
  connection: import("@solana/web3.js").Connection;
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-4 items-start py-2 border-b border-gray-100">
      <div className="text-xs text-gray-500 uppercase tracking-wide pt-0.5">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}

function formatRemaining(s: number): string {
  if (s <= 0) return "0s";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}
