"use client";

import { use, useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import BN from "bn.js";
import { useProgram } from "@/lib/use-program";
import { marketPda, poolPda } from "@/lib/pda";

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

      {!market.poolExists && youAreAuthority && (
        <div className="mt-8 rounded border border-blue-200 bg-blue-50 p-4 text-sm">
          You&apos;re the authority. Next step: initialize a pool with USDG
          liquidity. (UI coming next.)
        </div>
      )}
    </main>
  );
}

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
