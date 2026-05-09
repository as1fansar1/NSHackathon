"use client";

import React, { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import BN from "bn.js";
import { QRCodeSVG } from "qrcode.react";
import { Program } from "@coral-xyz/anchor";
import { useActiveProgram, useActiveWallet } from "@/lib/active-wallet";
import {
  vaultPda,
  committerPda,
  registryPda,
  marketPda,
  poolPda,
  yesMintPda,
  noMintPda,
  lpMintPda,
} from "@/lib/pda";
import { USDG_MINT } from "@/lib/constants";
import {
  displayUsdToUnits,
  formatUsd,
  unitsToDisplayUsd,
} from "@/lib/display";
import {
  createToken2022Account,
  getOrCreateAta,
} from "@/lib/spl-helpers";
import {
  loadBurner,
  saveBurner,
  keypairFromBase58,
  generateBurner,
  keypairToBase58,
} from "@/lib/burner-wallet";
import { registerPseudo, fetchPseudos } from "@/lib/pseudo-client";

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

type MarketData = {
  marketId: string;
  resolved: boolean;
  winningOutcome: boolean;
  outcomeSet: boolean;
  resolutionTime: number;
  yesMint: PublicKey;
  noMint: PublicKey;
};

type PoolState = {
  poolPda: PublicKey;
  yesReserve: PublicKey;
  noReserve: PublicKey;
  collateralReserve: PublicKey;
  yesReserveUnits: bigint;
  noReserveUnits: bigint;
  collateralUnits: bigint; // actual collateral_reserve balance (Token-2022)
  yesPrice: number; // 0..1
};

export default function BetDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const program = useActiveProgram();
  const activeWallet = useActiveWallet();
  const publicKey = activeWallet?.publicKey ?? null;
  const searchParams = useSearchParams();
  const urlKey = searchParams.get("key");

  const [vault, setVault] = useState<VaultData | null>(null);
  const [position, setPosition] = useState<PositionData | null>(null);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [pool, setPool] = useState<PoolState | null>(null);
  const [userYesUnits, setUserYesUnits] = useState<bigint>(0n);
  const [userNoUnits, setUserNoUnits] = useState<bigint>(0n);
  const [userUsdgUnits, setUserUsdgUnits] = useState<bigint>(0n);
  const [userTrackedBetUnits, setUserTrackedBetUnits] = useState<bigint>(0n);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [shareUrl, setShareUrl] = useState("");
  const [refreshTick, setRefreshTick] = useState(0);

  useEffect(() => {
    // The QR / share URL: if a burner was provisioned by the creator on
    // this device, embed its secret key so the scanner gets a wallet.
    const baseUrl =
      window.location.origin + window.location.pathname.replace(/\?.*$/, "");
    const provisioned = localStorage.getItem(`provisioned_${id}`);
    setShareUrl(provisioned ? `${baseUrl}?key=${provisioned}` : baseUrl);
  }, [id]);

  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  // Live polling: refetch vault + market + pool every 3s while the bet is
  // active so odds and counters update without user action.
  useEffect(() => {
    const interval = setInterval(() => {
      setRefreshTick((t) => t + 1);
    }, 3000);
    return () => clearInterval(interval);
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

          // Active wallet's USDG balance (Token-2022 ATA)
          const usdgAta = await getAssociatedTokenAddress(
            USDG_MINT,
            publicKey,
            false,
            TOKEN_2022_PROGRAM_ID,
          );
          const bal = await fetchBal(program.provider.connection, usdgAta);
          if (!cancelled) setUserUsdgUnits(bal);

          // User's tracked audience bets (cumulative)
          try {
            const r = await fetch(`/api/bet-track?vault=${id}`);
            if (r.ok) {
              const j = await r.json();
              const v = j.bets?.[publicKey.toBase58()];
              if (!cancelled)
                setUserTrackedBetUnits(v ? BigInt(v) : 0n);
            }
          } catch {
            /* best-effort */
          }
        }

        // If launched, find the associated market and fetch its state.
        if (v.launched) {
          const { findMarketIdForVault } = await import(
            "@/lib/market-discovery"
          );
          const mid = await findMarketIdForVault(program, id, v.title);
          if (cancelled || !mid) return;
          const marketAddr = marketPda(mid);
          const m = await (
            program.account as never as MarketAcc
          ).market.fetch(marketAddr);
          if (cancelled) return;
          setMarket({
            marketId: mid.toString(),
            resolved: m.resolved,
            winningOutcome: m.winningOutcome,
            outcomeSet: m.outcomeSet,
            resolutionTime: m.resolutionTime.toNumber(),
            yesMint: m.yesMint,
            noMint: m.noMint,
          });

          // User's YES + NO balances (classic SPL Token)
          if (publicKey) {
            const yesAta = await getAssociatedTokenAddress(
              m.yesMint,
              publicKey,
            );
            const noAta = await getAssociatedTokenAddress(
              m.noMint,
              publicKey,
            );
            const [yesBal, noBal] = await Promise.all([
              fetchBal(program.provider.connection, yesAta),
              fetchBal(program.provider.connection, noAta),
            ]);
            if (!cancelled) {
              setUserYesUnits(yesBal);
              setUserNoUnits(noBal);
            }
          }

          // Pool state (reserves + AMM price)
          const poolAddr = poolPda(marketAddr);
          const p = await (
            program.account as never as PoolAccountFetch
          ).pool.fetch(poolAddr);
          const [yesRes, noRes, collBal] = await Promise.all([
            fetchBal(program.provider.connection, p.yesReserve),
            fetchBal(program.provider.connection, p.noReserve),
            fetchBal(program.provider.connection, p.collateralReserve),
          ]);
          if (!cancelled) {
            const total = Number(yesRes + noRes);
            // Approximation: P_yes = no_reserve / (yes + no).
            // Buying YES drains pool's yes_reserve and grows no_reserve,
            // so P_yes goes up — directionally correct for the demo.
            const yesPrice =
              total > 0 ? Number(noRes) / total : 0.5;
            setPool({
              poolPda: poolAddr,
              yesReserve: p.yesReserve,
              noReserve: p.noReserve,
              collateralReserve: p.collateralReserve,
              yesReserveUnits: yesRes,
              noReserveUnits: noRes,
              collateralUnits: collBal,
              yesPrice,
            });
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

  // ?key= present + no burner stored → show pseudo prompt to claim it
  const burnerStored = typeof window !== "undefined" && loadBurner(id);
  const joinMode = searchParams.get("join");
  if (urlKey && !burnerStored) {
    return <ClaimBurnerScreen vaultId={id} secretKey={urlKey} />;
  }
  if (joinMode === "audience" && !burnerStored) {
    return <JoinAudienceScreen vaultId={id} />;
  }

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
      <div className="flex items-center justify-between gap-3">
        <a href="/" className="text-sm text-gray-500 hover:underline">
          ← Back
        </a>
        <div className="flex items-center gap-2">
          {activeWallet && (
            <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700 font-mono font-medium">
              💰 {formatUsd(unitsToDisplayUsd(userUsdgUnits))}
            </span>
          )}
          {activeWallet?.type === "burner" && (
            <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-700 font-medium">
              🎫 {activeWallet.pseudo ?? "burner"}
            </span>
          )}
        </div>
      </div>
      <div className="mt-2 mb-1 text-xs text-gray-500 font-mono">
        Bet #{vault.vaultId}
      </div>
      <h1 className="text-2xl font-semibold mb-6">{vault.title}</h1>

      {/* Status banner */}
      <div
        className={`rounded p-4 text-sm mb-6 ${
          market?.resolved
            ? "bg-yellow-50 border border-yellow-200"
            : vault.launched
              ? "bg-blue-50 border border-blue-200"
              : commitEnded
                ? "bg-orange-50 border border-orange-200"
                : "bg-gray-50 border border-gray-200"
        }`}
      >
        {inCommitPhase && (
          <>
            <div className="font-medium">
              {vault.yesTotal > 0n && vault.noTotal > 0n
                ? "Both sides matched ✓"
                : "Waiting for challenger"}
            </div>
            <div className="text-xs text-gray-600 mt-1 font-mono">
              {vault.yesTotal > 0n && vault.noTotal > 0n
                ? `Market launches in ${formatRemaining(commitRemaining)}…`
                : `Scan the QR to match. Auto-launches in ${formatRemaining(commitRemaining)} once both have committed.`}
            </div>
          </>
        )}
        {commitEnded && (
          <>
            <div className="font-medium">Ready to launch</div>
            <div className="text-xs text-gray-600 mt-1">
              Anyone can launch the market now.
            </div>
          </>
        )}
        {vault.launched && market?.resolved && (
          <>
            <div className="font-medium">Bet resolved</div>
            <div className="text-xs text-gray-600 mt-1">
              Final outcome:{" "}
              <span
                className={
                  market.winningOutcome
                    ? "text-green-700 font-semibold"
                    : "text-red-700 font-semibold"
                }
              >
                {market.winningOutcome ? "YES" : "NO"} wins
              </span>
              . Winners can redeem their tokens.
            </div>
          </>
        )}
        {vault.launched && !market?.resolved && (
          <>
            <div className="font-medium">Market live</div>
            <div className="text-xs text-gray-600 mt-1">
              Public trading is open. Buy YES or NO at AMM prices.
            </div>
          </>
        )}
      </div>

      {/* Stake totals — hidden post-launch (the Market card has live odds) */}
      {!vault.launched && (
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
      )}

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

      {/* Launch market (anyone, after commit phase) */}
      {commitEnded && program && (
        <LaunchSection
          program={program}
          vaultId={id}
          vaultCollateral={vault.collateralVault}
          enoughLiquidity={
            yesTotalUsd + noTotalUsd >= 20 &&
            vault.yesTotal > 0n &&
            vault.noTotal > 0n
          }
          onSuccess={() => setRefreshTick((t) => t + 1)}
        />
      )}

      {/* Market info + lifecycle (post-launch) */}
      {vault.launched && market && (
        <div className="rounded border border-gray-200 p-5 mb-6 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-500">Market</h3>
            <span className="text-[11px] text-gray-400 font-mono">
              #{market.marketId}
            </span>
          </div>
          <div className="text-sm">
            {market.resolved ? (
              <span
                className={`font-medium ${market.winningOutcome ? "text-green-600" : "text-red-600"}`}
              >
                ✓ {market.winningOutcome ? "YES wins" : "NO wins"}
              </span>
            ) : market.resolutionTime <= now ? (
              <span className="text-orange-600 font-medium">
                Expired — awaiting resolve
              </span>
            ) : (
              <span className="font-mono">
                {formatRemaining(market.resolutionTime - now)} until
                resolution
              </span>
            )}
          </div>
          {pool && !market.resolved && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Live odds</span>
                <span>updates every 3s</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <PriceCard
                  label="YES"
                  pct={pool.yesPrice * 100}
                  color="green"
                />
                <PriceCard
                  label="NO"
                  pct={(1 - pool.yesPrice) * 100}
                  color="red"
                />
              </div>
              <div className="mt-3 h-1.5 rounded overflow-hidden bg-gray-100 flex">
                <div
                  className="bg-green-500 h-full transition-all duration-500"
                  style={{ width: `${pool.yesPrice * 100}%` }}
                />
                <div
                  className="bg-red-500 h-full transition-all duration-500"
                  style={{ width: `${(1 - pool.yesPrice) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Trade panel — open during live market for any wallet */}
      {vault.launched &&
        market &&
        !market.resolved &&
        market.resolutionTime > now &&
        pool &&
        program && (
          <TradePanelSection
            program={program}
            vaultId={id}
            marketId={market.marketId}
            yesMint={market.yesMint}
            noMint={market.noMint}
            poolState={pool}
            userYesUnits={userYesUnits}
            userNoUnits={userNoUnits}
            userSpentUnits={
              (position
                ? position.yesAmount + position.noAmount
                : 0n) + userTrackedBetUnits
            }
            poolCollateralUnits={pool.collateralUnits}
            onSuccess={() => setRefreshTick((t) => t + 1)}
          />
        )}

      {/* Audience QR — fixed URL; faucet drops a fresh $5 wallet per pseudo */}
      {vault.launched && market && !market.resolved && (
        <AudienceInviteSection />
      )}

      {/* Claim committer (post-launch, position not yet claimed) */}
      {vault.launched &&
        market &&
        position &&
        !position.claimed &&
        !position.refunded &&
        (position.yesAmount > 0n || position.noAmount > 0n) &&
        program && (
          <ClaimSection
            program={program}
            vaultId={id}
            vaultTitle={vault.title}
            onSuccess={() => setRefreshTick((t) => t + 1)}
          />
        )}

      {/* Resolve YES/NO (authority only, post-expiry, not yet resolved) */}
      {vault.launched &&
        market &&
        !market.resolved &&
        market.resolutionTime <= now &&
        youAreAuthority &&
        program && (
          <ResolveSection
            program={program}
            marketId={market.marketId}
            onSuccess={() => setRefreshTick((t) => t + 1)}
          />
        )}

      {/* Redeem (resolved + user has winning tokens) */}
      {vault.launched &&
        market &&
        market.resolved &&
        program &&
        ((market.winningOutcome && userYesUnits > 0n) ||
          (!market.winningOutcome && userNoUnits > 0n)) && (
          <RedeemSection
            program={program}
            marketId={market.marketId}
            winningOutcome={market.winningOutcome}
            winningUnits={
              market.winningOutcome ? userYesUnits : userNoUnits
            }
            onSuccess={() => setRefreshTick((t) => t + 1)}
          />
        )}

      {/* Leaderboard — visible after launch, prominent after resolution */}
      {vault.launched && market && program && (
        <LeaderboardSection
          program={program}
          vaultId={id}
          marketId={market.marketId}
          yesMint={market.yesMint}
          noMint={market.noMint}
          resolved={market.resolved}
          winningOutcome={market.winningOutcome}
          poolCollateralUnits={pool?.collateralUnits ?? 0n}
        />
      )}

      {/* QR code for sharing */}
      {inCommitPhase && shareUrl && (
        <ShareableQrCard
          url={shareUrl}
          title="Share with the challenger"
          note={
            shareUrl.includes("?key=")
              ? "⚡ This QR contains a pre-funded $10 burner wallet. Scanner picks a pseudo and is ready to bet."
              : null
          }
        />
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
  const wallet = useActiveWallet();
  const publicKey = wallet?.publicKey ?? null;
  const [side, setSide] = useState<"yes" | "no">("no");
  const [stakeUsd, setStakeUsd] = useState("10");
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
          min="2"
          step="1"
          value={stakeUsd}
          onChange={(e) => setStakeUsd(e.target.value)}
          required
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
        <p className="text-[11px] text-gray-500 mt-1">
          Min $2 per commit. Match the creator&apos;s stake to keep odds at
          50/50.
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

function LaunchSection({
  program,
  vaultId,
  vaultCollateral,
  enoughLiquidity,
  onSuccess,
}: {
  program: Program;
  vaultId: string;
  vaultCollateral: string;
  enoughLiquidity: boolean;
  onSuccess: () => void;
}) {
  const wallet = useActiveWallet();
  const publicKey = wallet?.publicKey ?? null;
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoLaunchedRef = React.useRef(false);

  // Auto-launch as soon as conditions are met. Phantom only — burners
  // don't have enough SOL to pay for the 8 init accounts. Burners + the
  // manual button are the fallback. One-shot per page session.
  useEffect(() => {
    if (autoLaunchedRef.current) return;
    if (!enoughLiquidity) return;
    if (!publicKey) return;
    if (wallet?.type !== "phantom") return;
    autoLaunchedRef.current = true;
    void handleLaunch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enoughLiquidity, publicKey, wallet?.type]);

  async function handleLaunch() {
    if (!publicKey) return;
    setError(null);
    setStatus(null);
    setSubmitting(true);
    try {
      const provider = program.provider as ProviderLike;
      const vault = vaultPda(new BN(vaultId));

      // Read registry to know the next market_id
      setStatus("Reading registry…");
      const registry = registryPda();
      const reg = await (program.account as never as RegistryAccount).registry.fetch(registry);
      const nextMarketId = new BN(reg.marketCount.toString()).addn(1);

      // Derive PDAs
      const market = marketPda(nextMarketId);
      const yesMint = yesMintPda(market);
      const noMint = noMintPda(market);
      const pool = poolPda(market);
      const lpMint = lpMintPda(pool);

      // Derive ATAs for vault (will be created via init)
      const vaultLp = await getAssociatedTokenAddress(lpMint, vault, true);
      const vaultYes = await getAssociatedTokenAddress(yesMint, vault, true);
      const vaultNo = await getAssociatedTokenAddress(noMint, vault, true);

      // Pre-create the Token-2022 collateral reserve owned by pool PDA
      setStatus("Creating pool collateral reserve…");
      const collateralReserveKp = await createToken2022Account(
        provider as never,
        USDG_MINT,
        pool,
      );

      // Generate fresh keypairs for yes/no reserves (signers, init in tx)
      const yesReserveKp = Keypair.generate();
      const noReserveKp = Keypair.generate();

      setStatus("Launching market… (sign in wallet)");
      const sig = await program.methods
        .launchVaultMarket()
        .accounts({
          payer: publicKey,
          vault,
          registry,
          market,
          yesMint,
          noMint,
          pool,
          lpMint,
          yesReserve: yesReserveKp.publicKey,
          noReserve: noReserveKp.publicKey,
          collateralReserve: collateralReserveKp.publicKey,
          vaultCollateral: new PublicKey(vaultCollateral),
          collateralMint: USDG_MINT,
          vaultLp,
          vaultYes,
          vaultNo,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        } as never)
        .signers([yesReserveKp, noReserveKp])
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 800_000 }),
        ])
        .rpc();

      setStatus(`Market launched. Tx: ${sig.slice(0, 12)}…`);
      onSuccess();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded border border-orange-300 bg-orange-50 p-5 mb-6">
      <h3 className="text-lg font-medium mb-1">Ready to launch</h3>
      <p className="text-xs text-gray-600 mb-4">
        Commit phase ended. Anyone can launch the market — open it up to the
        audience.
      </p>
      {!enoughLiquidity ? (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs">
          Not launchable yet — need both YES and NO commitments and at least
          $20 total combined. Holders can refund instead.
        </div>
      ) : (
        <button
          onClick={handleLaunch}
          disabled={submitting}
          className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
        >
          {submitting ? "Submitting…" : "🚀 Launch market"}
        </button>
      )}
      {status && (
        <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-xs font-mono break-all">
          {status}
        </div>
      )}
      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      )}
    </div>
  );
}

function ClaimSection({
  program,
  vaultId,
  vaultTitle,
  onSuccess,
}: {
  program: Program;
  vaultId: string;
  vaultTitle: string;
  onSuccess: () => void;
}) {
  const wallet = useActiveWallet();
  const publicKey = wallet?.publicKey ?? null;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClaim() {
    if (!publicKey) return;
    setError(null);
    setSubmitting(true);
    try {
      const { findMarketIdForVault } = await import(
        "@/lib/market-discovery"
      );
      const { createAssociatedTokenAccountIdempotentInstruction } =
        await import("@solana/spl-token");

      const vault = vaultPda(new BN(vaultId));
      const position = committerPda(vault, publicKey);

      const mid = await findMarketIdForVault(program, vaultId, vaultTitle);
      if (!mid) throw new Error("Associated market not found");

      const market = marketPda(mid);
      const yesMint = yesMintPda(market);
      const noMint = noMintPda(market);
      const pool = poolPda(market);
      const lpMint = lpMintPda(pool);

      const vaultYes = await getAssociatedTokenAddress(yesMint, vault, true);
      const vaultNo = await getAssociatedTokenAddress(noMint, vault, true);
      const vaultLp = await getAssociatedTokenAddress(lpMint, vault, true);

      const userYes = await getAssociatedTokenAddress(yesMint, publicKey);
      const userNo = await getAssociatedTokenAddress(noMint, publicKey);
      const userLp = await getAssociatedTokenAddress(lpMint, publicKey);

      await program.methods
        .claimCommitter()
        .accounts({
          user: publicKey,
          vault,
          position,
          vaultYes,
          vaultNo,
          vaultLp,
          userYes,
          userNo,
          userLp,
          lpMint,
          tokenProgram: TOKEN_PROGRAM_ID,
        } as never)
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            userYes,
            publicKey,
            yesMint,
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            userNo,
            publicKey,
            noMint,
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            userLp,
            publicKey,
            lpMint,
          ),
        ])
        .rpc();

      onSuccess();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded border border-blue-200 bg-blue-50 p-5 mb-6">
      <h3 className="text-sm font-medium mb-1">Claim your tokens</h3>
      <p className="text-xs text-gray-600 mb-3">
        The market launched — claim your fair-odds outcome tokens + LP share
        from your commit.
      </p>
      <button
        onClick={handleClaim}
        disabled={submitting}
        className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Claim tokens"}
      </button>
      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      )}
    </div>
  );
}

function ResolveSection({
  program,
  marketId,
  onSuccess,
}: {
  program: Program;
  marketId: string;
  onSuccess: () => void;
}) {
  const wallet = useActiveWallet();
  const publicKey = wallet?.publicKey ?? null;
  const [submitting, setSubmitting] = useState<"yes" | "no" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(winning: boolean) {
    if (!publicKey) return;
    setError(null);
    setSubmitting(winning ? "yes" : "no");
    try {
      const market = marketPda(new BN(marketId));
      await program.methods
        .resolveMarket(winning)
        .accounts({ authority: publicKey, market } as never)
        .rpc();
      onSuccess();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="rounded border border-orange-300 bg-orange-50 p-5 mb-6">
      <h3 className="text-sm font-medium mb-1">Resolve the bet</h3>
      <p className="text-xs text-gray-600 mb-3">
        You&apos;re the creator. Pick the winning side. This is final.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => resolve(true)}
          disabled={submitting !== null}
          className="rounded bg-green-600 hover:bg-green-700 text-white py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {submitting === "yes" ? "Submitting…" : "YES wins"}
        </button>
        <button
          onClick={() => resolve(false)}
          disabled={submitting !== null}
          className="rounded bg-red-600 hover:bg-red-700 text-white py-2.5 text-sm font-medium disabled:opacity-50"
        >
          {submitting === "no" ? "Submitting…" : "NO wins"}
        </button>
      </div>
      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      )}
    </div>
  );
}

function RedeemSection({
  program,
  marketId,
  winningOutcome,
  winningUnits,
  onSuccess,
}: {
  program: Program;
  marketId: string;
  winningOutcome: boolean;
  winningUnits: bigint;
  onSuccess: () => void;
}) {
  const wallet = useActiveWallet();
  const publicKey = wallet?.publicKey ?? null;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const winningUsd = unitsToDisplayUsd(winningUnits);

  async function handleRedeem() {
    if (!publicKey) return;
    setError(null);
    setSubmitting(true);
    try {
      const market = marketPda(new BN(marketId));
      const pool = poolPda(market);
      const yesMint = yesMintPda(market);
      const noMint = noMintPda(market);

      // Read pool to get reserve addresses
      const p = await (
        program.account as never as PoolAcc
      ).pool.fetch(pool);

      const userYes = await getAssociatedTokenAddress(yesMint, publicKey);
      const userNo = await getAssociatedTokenAddress(noMint, publicKey);
      const userCollateral = await getAssociatedTokenAddress(
        USDG_MINT,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      await program.methods
        .redeem()
        .accounts({
          user: publicKey,
          market,
          pool,
          collateralReserve: p.collateralReserve,
          yesReserve: p.yesReserve,
          noReserve: p.noReserve,
          yesMint,
          noMint,
          userYes,
          userNo,
          userCollateral,
          collateralMint: USDG_MINT,
          tokenProgram: TOKEN_PROGRAM_ID,
          collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
        } as never)
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 300_000 }),
        ])
        .rpc();

      onSuccess();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded border border-green-300 bg-green-50 p-5 mb-6">
      <h3 className="text-sm font-medium mb-1">
        🎉 You won! Redeem your USDG
      </h3>
      <p className="text-xs text-gray-600 mb-3">
        You hold {formatUsd(winningUsd)} of {winningOutcome ? "YES" : "NO"}{" "}
        tokens. Burn them 1:1 for USDG collateral.
      </p>
      <button
        onClick={handleRedeem}
        disabled={submitting}
        className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : `Redeem ${formatUsd(winningUsd)}`}
      </button>
      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      )}
    </div>
  );
}

type PoolAcc = {
  pool: {
    fetch: (a: PublicKey) => Promise<{
      yesReserve: PublicKey;
      noReserve: PublicKey;
      collateralReserve: PublicKey;
      lpMint: PublicKey;
    }>;
  };
};

function PriceCard({
  label,
  pct,
  color,
}: {
  label: string;
  pct: number;
  color: "green" | "red";
}) {
  const text = color === "green" ? "text-green-700" : "text-red-700";
  return (
    <div className="rounded border border-gray-100 p-3 text-center">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-mono font-medium ${text}`}>
        {pct.toFixed(1)}%
      </div>
    </div>
  );
}

function TradePanelSection({
  program,
  vaultId,
  marketId,
  yesMint,
  noMint,
  poolState,
  userYesUnits,
  userNoUnits,
  userSpentUnits,
  poolCollateralUnits,
  onSuccess,
}: {
  program: Program;
  vaultId: string;
  marketId: string;
  yesMint: PublicKey;
  noMint: PublicKey;
  poolState: PoolState;
  userYesUnits: bigint;
  userNoUnits: bigint;
  userSpentUnits: bigint;
  poolCollateralUnits: bigint;
  onSuccess: () => void;
}) {
  const wallet = useActiveWallet();
  const publicKey = wallet?.publicKey ?? null;
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amountUsd, setAmountUsd] = useState("5");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const userYesUsd = unitsToDisplayUsd(userYesUnits);
  const userNoUsd = unitsToDisplayUsd(userNoUnits);

  async function handleBuy() {
    if (!publicKey) return;
    setError(null);
    setSubmitting(true);
    try {
      const { createAssociatedTokenAccountIdempotentInstruction } =
        await import("@solana/spl-token");

      const market = marketPda(new BN(marketId));
      const userYes = await getAssociatedTokenAddress(yesMint, publicKey);
      const userNo = await getAssociatedTokenAddress(noMint, publicKey);
      const userCollateral = await getAssociatedTokenAddress(
        USDG_MINT,
        publicKey,
        false,
        TOKEN_2022_PROGRAM_ID,
      );

      const amountUnits = displayUsdToUnits(parseFloat(amountUsd) || 0);

      // Compound: mint a complete pair (buy_outcome_tokens), then swap the
      // unwanted side into the wanted side via the AMM. End result: user
      // holds > amountUnits of `side` (price-dependent), 0 of the other.
      const buyAccounts = {
        user: publicKey,
        market,
        pool: poolState.poolPda,
        collateralReserve: poolState.collateralReserve,
        yesMint,
        noMint,
        userCollateral,
        userYes,
        userNo,
        collateralMint: USDG_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        collateralTokenProgram: TOKEN_2022_PROGRAM_ID,
      };
      const swapAccounts = {
        user: publicKey,
        market,
        pool: poolState.poolPda,
        yesReserve: poolState.yesReserve,
        noReserve: poolState.noReserve,
        userYes,
        userNo,
        yesMint,
        noMint,
        collateralReserve: poolState.collateralReserve,
        tokenProgram: TOKEN_PROGRAM_ID,
      };

      const buyIx = await program.methods
        .buyOutcomeTokens(amountUnits)
        .accounts(buyAccounts as never)
        .instruction();

      // launch_vault_market sets pool.fee_bps = VAULT_LP_FEE_BPS (100 bps = 1%).
      // So buy_outcome_tokens mints amountUnits * 0.99 of each side.
      // Scale the swap amount_in down to what the user actually has.
      const swapAmountIn = amountUnits.muln(99).divn(100);
      const swapIx = await program.methods
        .swap(swapAmountIn, new BN(0), side === "no")
        .accounts(swapAccounts as never)
        .instruction();

      await program.methods
        .buyOutcomeTokens(amountUnits)
        .accounts(buyAccounts as never)
        .preInstructions([
          ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            userYes,
            publicKey,
            yesMint,
          ),
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            userNo,
            publicKey,
            noMint,
          ),
        ])
        .postInstructions([swapIx])
        .rpc();

      // suppress unused-warning on `buyIx` — we re-use the same call shape
      // via .rpc() above for clarity in the action chain
      void buyIx;

      // Track audience bet amount in KV so the leaderboard can show how
      // much they put in (committers' bets come from on-chain positions).
      try {
        await fetch("/api/bet-track", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            vault: vaultId,
            pubkey: publicKey.toBase58(),
            units: amountUnits.toString(),
          }),
        });
      } catch {
        /* best-effort */
      }

      onSuccess();
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  const spentUsd = unitsToDisplayUsd(userSpentUnits);
  // Apply pool's pro-rata clamp: if winning-side circulating > collateral,
  // each token redeems for less than \$1. We can't know everyone's holdings
  // here without an extra fetch, so we approximate using pool reserves +
  // user balances. For the trade panel breakdown we just clamp at \$1 / token
  // and note "≈" since the AMM may rebalance after others trade.
  const ifYesWinsUsd = userYesUsd;
  const ifNoWinsUsd = userNoUsd;
  const yesPnl = ifYesWinsUsd - spentUsd;
  const noPnl = ifNoWinsUsd - spentUsd;
  const hasPosition = userYesUnits > 0n || userNoUnits > 0n;

  // Bet preview: if user has typed an amount, simulate the compound trade
  // and show the projected post-bet state. Approximation: use current
  // AMM price + 1% LP fee, ignore slippage.
  const betAmount = parseFloat(amountUsd) || 0;
  const yesPrice = poolState.yesPrice;
  const noPrice = 1 - yesPrice;
  let previewYesUsd = userYesUsd;
  let previewNoUsd = userNoUsd;
  if (betAmount > 0) {
    const minted = betAmount * 0.99; // after 1% LP fee
    if (side === "yes") {
      // Mint pair: +minted YES + minted NO. Swap NO -> YES at noPrice/yesPrice.
      const swapYesOut = noPrice > 0 ? minted * (noPrice / yesPrice) : 0;
      previewYesUsd = userYesUsd + minted + swapYesOut;
      previewNoUsd = userNoUsd; // NO mostly cleared by swap
    } else {
      const swapNoOut = yesPrice > 0 ? minted * (yesPrice / noPrice) : 0;
      previewNoUsd = userNoUsd + minted + swapNoOut;
      previewYesUsd = userYesUsd;
    }
  }
  const previewSpentUsd = spentUsd + betAmount;
  const previewYesPnl = previewYesUsd - previewSpentUsd;
  const previewNoPnl = previewNoUsd - previewSpentUsd;
  void poolCollateralUnits; // reserved for future precise pro-rata calc

  return (
    <div className="rounded border border-gray-200 p-5 mb-6 space-y-4">
      <h3 className="text-sm font-medium">Place a bet</h3>

      {hasPosition && (
        <div className="rounded border border-gray-200 bg-gray-50 p-3 space-y-1.5 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-gray-500">Spent</span>
            <span className="text-gray-900">{formatUsd(spentUsd)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-600">If YES wins</span>
            <span className="text-green-700 font-semibold">
              {formatUsd(ifYesWinsUsd)}{" "}
              <span
                className={`text-[10px] ${yesPnl >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                ({yesPnl >= 0 ? "+" : "−"}
                {formatUsd(Math.abs(yesPnl))})
              </span>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-red-600">If NO wins</span>
            <span className="text-red-700 font-semibold">
              {formatUsd(ifNoWinsUsd)}{" "}
              <span
                className={`text-[10px] ${noPnl >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                ({noPnl >= 0 ? "+" : "−"}
                {formatUsd(Math.abs(noPnl))})
              </span>
            </span>
          </div>
        </div>
      )}

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
          Buy YES @ {(poolState.yesPrice * 100).toFixed(0)}%
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
          Buy NO @ {((1 - poolState.yesPrice) * 100).toFixed(0)}%
        </button>
      </div>

      <label className="block">
        <div className="text-sm font-medium mb-1">Amount ($)</div>
        <input
          type="number"
          min="1"
          step="1"
          value={amountUsd}
          onChange={(e) => setAmountUsd(e.target.value)}
          className="w-full rounded border border-gray-300 px-3 py-2 text-sm font-mono"
        />
      </label>

      {/* Preview: what your position becomes after this bet */}
      {betAmount > 0 && (
        <div className="rounded border border-gray-300 bg-white p-3 space-y-1.5 font-mono text-xs">
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mb-1">
            After this bet (≈ estimate)
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Total spent</span>
            <span className="text-gray-900">{formatUsd(previewSpentUsd)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-green-600">If YES wins</span>
            <span className="text-green-700 font-semibold">
              {formatUsd(previewYesUsd)}{" "}
              <span
                className={`text-[10px] ${previewYesPnl >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                ({previewYesPnl >= 0 ? "+" : "−"}
                {formatUsd(Math.abs(previewYesPnl))})
              </span>
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-red-600">If NO wins</span>
            <span className="text-red-700 font-semibold">
              {formatUsd(previewNoUsd)}{" "}
              <span
                className={`text-[10px] ${previewNoPnl >= 0 ? "text-green-600" : "text-red-600"}`}
              >
                ({previewNoPnl >= 0 ? "+" : "−"}
                {formatUsd(Math.abs(previewNoPnl))})
              </span>
            </span>
          </div>
        </div>
      )}

      <button
        onClick={handleBuy}
        disabled={submitting || !publicKey}
        className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
      >
        {submitting
          ? "Submitting…"
          : `Buy ${formatUsd(parseFloat(amountUsd) || 0)} of ${side.toUpperCase()}`}
      </button>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
          {error}
        </div>
      )}
    </div>
  );
}

function ShareableQrCard({
  url,
  title,
  note,
}: {
  url: string;
  title: string;
  note: string | null;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }
  async function share() {
    if (typeof navigator === "undefined" || !navigator.share) {
      copy();
      return;
    }
    try {
      await navigator.share({ title, url });
    } catch {
      // user cancelled
    }
  }
  return (
    <div className="rounded border border-gray-200 p-5 mb-6 bg-white">
      <h2 className="text-sm font-medium text-gray-500 mb-3">{title}</h2>
      {note && <p className="text-[11px] text-gray-600 mb-3">{note}</p>}
      <div className="flex flex-col items-center gap-3 mb-3">
        <div className="bg-white p-3 rounded border border-gray-100">
          <QRCodeSVG value={url} size={160} />
        </div>
        <div className="text-[11px] text-gray-500 font-mono break-all text-center">
          {url}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={copy}
          className="rounded border border-gray-300 bg-white py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
        >
          {copied ? "✓ Copied" : "📋 Copy link"}
        </button>
        <button
          onClick={share}
          className="rounded bg-black text-white py-2 text-xs font-medium hover:bg-gray-800"
        >
          ↗ Share
        </button>
      </div>
    </div>
  );
}

function AudienceInviteSection() {
  const [audienceUrl, setAudienceUrl] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const baseUrl =
      window.location.origin + window.location.pathname.replace(/\?.*$/, "");
    setAudienceUrl(`${baseUrl}?join=audience`);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(audienceUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function share() {
    if (typeof navigator === "undefined" || !navigator.share) {
      copy();
      return;
    }
    try {
      await navigator.share({
        title: "Join the bet",
        text: "Pick a pseudo and bet YES or NO — $5 wallet on the house.",
        url: audienceUrl,
      });
    } catch {
      // user cancelled
    }
  }

  return (
    <div className="rounded border border-purple-200 bg-purple-50 p-5 mb-6">
      <h3 className="text-sm font-medium mb-1 text-gray-900">
        📣 Audience QR
      </h3>
      <p className="text-xs text-gray-700 mb-3">
        Anyone scans (or opens the link), picks a pseudo, and gets their own
        pre-funded $5 wallet. They can then bet YES or NO at AMM prices.
      </p>
      {audienceUrl && (
        <>
          <div className="bg-white rounded border border-gray-100 p-4 flex flex-col items-center gap-2 mb-3">
            <QRCodeSVG value={audienceUrl} size={180} />
            <div className="text-[10px] text-gray-500 font-mono break-all text-center">
              {audienceUrl}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={copy}
              className="rounded border border-gray-300 bg-white py-2 text-xs font-medium text-gray-900 hover:bg-gray-50"
            >
              {copied ? "✓ Copied" : "📋 Copy link"}
            </button>
            <button
              onClick={share}
              className="rounded bg-black text-white py-2 text-xs font-medium hover:bg-gray-800"
            >
              ↗ Share
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function JoinAudienceScreen({ vaultId }: { vaultId: string }) {
  const [pseudo, setPseudo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!pseudo.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      setStatus("Generating wallet…");
      const burnerKp = generateBurner();

      setStatus("Requesting $5 from the faucet…");
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pubkey: burnerKp.publicKey.toBase58() }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || `faucet failed (${res.status})`);
      }

      setStatus("Wallet funded. Loading…");
      saveBurner({
        secretKey: keypairToBase58(burnerKp),
        pseudo: pseudo.trim(),
        vaultId,
      });
      // Register pseudo against the burner pubkey for the leaderboard.
      await registerPseudo(
        vaultId,
        burnerKp.publicKey.toBase58(),
        pseudo.trim(),
      );
      const cleanUrl = window.location.origin + window.location.pathname;
      window.location.replace(cleanUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 max-w-md mx-auto px-6 py-12 w-full">
      <div className="rounded-lg border border-gray-200 p-6 bg-white">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🎫</div>
          <h1 className="text-xl font-semibold mb-1 text-gray-900">
            Join as audience
          </h1>
          <p className="text-sm text-gray-600">
            Pick a pseudo. We&apos;ll create your own wallet and drop $5 in
            it so you can bet YES or NO.
          </p>
        </div>

        <form onSubmit={handleJoin} className="space-y-4">
          <label className="block">
            <div className="text-sm font-medium mb-1 text-gray-900">
              Your pseudo
            </div>
            <input
              type="text"
              value={pseudo}
              onChange={(e) => setPseudo(e.target.value)}
              placeholder="e.g. alex"
              maxLength={32}
              required
              autoFocus
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 bg-white"
            />
          </label>

          <button
            type="submit"
            disabled={submitting || !pseudo.trim()}
            className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Working…" : "Get my wallet & join"}
          </button>
        </form>

        {status && !error && (
          <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-xs font-mono break-all text-gray-900">
            {status}
          </div>
        )}
        {error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all text-red-900">
            {error}
          </div>
        )}

        <p className="mt-6 text-[10px] text-gray-400 text-center">
          🔒 Wallet stored in your browser. Devnet only.
        </p>
      </div>
    </main>
  );
}

type RegistryAccount = {
  registry: {
    fetch: (a: import("@solana/web3.js").PublicKey) => Promise<{
      marketCount: BN;
    }>;
  };
};

type MarketAcc = {
  market: {
    fetch: (a: PublicKey) => Promise<{
      resolved: boolean;
      winningOutcome: boolean;
      outcomeSet: boolean;
      resolutionTime: BN;
      yesMint: PublicKey;
      noMint: PublicKey;
    }>;
  };
};

async function fetchBal(
  connection: import("@solana/web3.js").Connection,
  ata: PublicKey,
): Promise<bigint> {
  try {
    const info = await connection.getTokenAccountBalance(ata);
    return BigInt(info.value.amount);
  } catch {
    return 0n;
  }
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

type PoolAccountFetch = {
  pool: {
    fetch: (a: PublicKey) => Promise<{
      yesReserve: PublicKey;
      noReserve: PublicKey;
      collateralReserve: PublicKey;
    }>;
  };
};

function ClaimBurnerScreen({
  vaultId,
  secretKey,
}: {
  vaultId: string;
  secretKey: string;
}) {
  const [pseudo, setPseudo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let publicKey: PublicKey | null = null;
  try {
    publicKey = keypairFromBase58(secretKey).publicKey;
  } catch {
    publicKey = null;
  }

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    if (!pseudo.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      saveBurner({
        secretKey,
        pseudo: pseudo.trim(),
        vaultId,
      });
      if (publicKey) {
        await registerPseudo(vaultId, publicKey.toBase58(), pseudo.trim());
      }
      // Strip ?key= from URL and reload so the page picks up the saved burner.
      const cleanUrl =
        window.location.origin + window.location.pathname;
      window.location.replace(cleanUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 max-w-md mx-auto px-6 py-12 w-full">
      <div className="rounded-lg border border-gray-200 p-6">
        <div className="text-center mb-6">
          <div className="text-4xl mb-2">🎁</div>
          <h1 className="text-xl font-semibold mb-1">You&apos;re invited</h1>
          <p className="text-sm text-gray-600">
            Someone made a 1v1 bet and pre-funded a $10 wallet for you.
          </p>
        </div>

        <form onSubmit={claim} className="space-y-4">
          <label className="block">
            <div className="text-sm font-medium mb-1">Pick a pseudo</div>
            <input
              type="text"
              value={pseudo}
              onChange={(e) => setPseudo(e.target.value)}
              placeholder="e.g. mathis"
              maxLength={32}
              required
              autoFocus
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <button
            type="submit"
            disabled={submitting || !pseudo.trim()}
            className="w-full rounded bg-black text-white py-2.5 text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
          >
            {submitting ? "Loading…" : "Claim wallet & continue"}
          </button>
          {publicKey && (
            <p className="text-[11px] text-gray-400 font-mono break-all text-center">
              wallet: {publicKey.toBase58().slice(0, 8)}…
              {publicKey.toBase58().slice(-8)}
            </p>
          )}
        </form>

        {error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs font-mono break-all">
            {error}
          </div>
        )}

        <p className="mt-6 text-[10px] text-gray-400 text-center">
          🔒 This wallet lives in your browser. No app install required. Devnet only.
        </p>
      </div>
    </main>
  );
}

type LeaderRow = {
  pubkey: string;
  pseudo: string | null;
  yesUnits: bigint;
  noUnits: bigint;
  committed: boolean;
  betUnits: bigint; // total $ they put in (commit + tracked buys)
};

type SerializedRow = {
  pubkey: string;
  pseudo: string | null;
  yesUnits: string;
  noUnits: string;
  committed: boolean;
  betUnits?: string;
};

function LeaderboardSection({
  program,
  vaultId,
  marketId,
  yesMint,
  noMint,
  resolved,
  winningOutcome,
  poolCollateralUnits,
}: {
  program: Program;
  vaultId: string;
  marketId: string;
  yesMint: PublicKey;
  noMint: PublicKey;
  resolved: boolean;
  winningOutcome: boolean;
  poolCollateralUnits: bigint;
}) {
  const [rows, setRows] = useState<LeaderRow[]>([]);
  const [snapshotCollateralUnits, setSnapshotCollateralUnits] =
    useState<bigint | null>(null);
  const [loading, setLoading] = useState(true);
  const intervalRef = React.useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  // Effective collateral: snapshot's frozen value (post-resolve) or live value.
  const effectiveCollateralUnits =
    snapshotCollateralUnits ?? poolCollateralUnits;

  useEffect(() => {
    let cancelled = false;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    async function load() {
      try {
        const conn = program.provider.connection;
        const pseudoMap = await fetchPseudos(vaultId);

        // Fetch the audience bet-tracking map (committer bets are on-chain).
        let trackedBets: Record<string, string> = {};
        try {
          const r = await fetch(`/api/bet-track?vault=${vaultId}`);
          if (r.ok) {
            const j = await r.json();
            trackedBets = j.bets ?? {};
          }
        } catch {
          /* best-effort */
        }

        // 1. All committers for this vault (creator + challenger)
        const vaultAddr = vaultPda(new BN(vaultId));
        const committers = await (
          program.account as never as CommitterListFetch
        ).committerPosition.all([
          {
            memcmp: {
              offset: 8, // after Anchor's 8-byte discriminator
              bytes: vaultAddr.toBase58(),
            },
          },
        ]);

        // Map of pubkey → committed bet amount (yes_amount + no_amount).
        // Also accumulate vault totals for fair-odds virtual balances.
        const committerBets = new Map<string, bigint>();
        let yesTotal = 0n;
        let noTotal = 0n;
        for (const c of committers) {
          const a = c.account as {
            user: PublicKey;
            yesAmount: BN;
            noAmount: BN;
          };
          const my = BigInt(a.yesAmount.toString()) +
            BigInt(a.noAmount.toString());
          committerBets.set(a.user.toBase58(), my);
          yesTotal += BigInt(a.yesAmount.toString());
          noTotal += BigInt(a.noAmount.toString());
        }
        const totalCommit = yesTotal + noTotal;

        // 2. Top YES + NO + LP holders. LP-only holders are bettors too
        // (the original committers, who keep LP shares after claim).
        const lpMintAddr = lpMintPda(poolPda(marketPda(new BN(marketId))));
        const [yesHolders, noHolders, lpHolders] = await Promise.all([
          conn.getTokenLargestAccounts(yesMint),
          conn.getTokenLargestAccounts(noMint),
          conn.getTokenLargestAccounts(lpMintAddr),
        ]);

        // Resolve token accounts to owners (one extra round-trip)
        const allTokenAccounts = [
          ...yesHolders.value.map((a) => ({ ...a, side: "yes" as const })),
          ...noHolders.value.map((a) => ({ ...a, side: "no" as const })),
          ...lpHolders.value.map((a) => ({ ...a, side: "lp" as const })),
        ].filter((a) => Number(a.amount) > 0);

        const ownerPromises = allTokenAccounts.map((a) =>
          conn.getParsedAccountInfo(a.address),
        );
        const ownerResults = await Promise.all(ownerPromises);

        const byOwner = new Map<
          string,
          { yes: bigint; no: bigint }
        >();
        ownerResults.forEach((info, i) => {
          const ta = allTokenAccounts[i];
          const data = info.value?.data;
          if (
            data &&
            "parsed" in data &&
            data.parsed &&
            data.parsed.info?.owner
          ) {
            const owner: string = data.parsed.info.owner;
            const cur = byOwner.get(owner) ?? { yes: 0n, no: 0n };
            const amt = BigInt(ta.amount);
            if (ta.side === "yes") cur.yes += amt;
            else if (ta.side === "no") cur.no += amt;
            // ta.side === "lp": just register the owner; no balance to track
            byOwner.set(owner, cur);
          }
        });

        // Committers always show their fair-odds VIRTUAL balance,
        // regardless of claim state. Why: on-chain balance is unstable
        // (drops to 0 when they claim+redeem), but virtual is fixed by
        // their commit and the vault totals. This makes the resolved
        // leaderboard immune to "I claimed and now show as $0".
        //   virtual_yes = yes_amount * (yes_total + no_total) / yes_total
        //   virtual_no  = no_amount  * (yes_total + no_total) / no_total
        const committerSet = new Set<string>();
        for (const c of committers) {
          const a = c.account as {
            user: PublicKey;
            yesAmount: BN;
            noAmount: BN;
            claimed: boolean;
          };
          const owner = a.user.toBase58();
          committerSet.add(owner);
          const myYes = BigInt(a.yesAmount.toString());
          const myNo = BigInt(a.noAmount.toString());
          let virtualYes = 0n;
          let virtualNo = 0n;
          if (totalCommit > 0n) {
            if (myYes > 0n && yesTotal > 0n) {
              virtualYes = (myYes * totalCommit) / yesTotal;
            }
            if (myNo > 0n && noTotal > 0n) {
              virtualNo = (myNo * totalCommit) / noTotal;
            }
          }
          // Override the on-chain entry with virtual to avoid the
          // "claimed then redeemed" confusion. Audience members are
          // not in this loop, so their on-chain balance stays.
          byOwner.set(owner, { yes: virtualYes, no: virtualNo });
        }

        // Filter out the vault PDA itself (holds LP tokens, not a player)
        // and other system accounts. Keep only owner-style addresses.
        // Also: only show players with a registered pseudo (cross-browser
        // identity). Anonymous wallets that never went through /create or
        // a /join screen are skipped.
        const vaultStr = vaultAddr.toBase58();
        const list: LeaderRow[] = [];
        byOwner.forEach((v, owner) => {
          if (owner === vaultStr) return;
          const pseudo = pseudoMap[owner];
          if (!pseudo) return;
          // Bet = commit (on-chain, for OG committers) + tracked AMM buys
          const commitBet = committerBets.get(owner) ?? 0n;
          const tracked = trackedBets[owner]
            ? BigInt(trackedBets[owner])
            : 0n;
          list.push({
            pubkey: owner,
            pseudo,
            yesUnits: v.yes,
            noUnits: v.no,
            committed: committerSet.has(owner),
            betUnits: commitBet + tracked,
          });
        });

        // Sort: winners first (descending winnings), then everyone else.
        list.sort((a, b) => {
          const aWin = winningOutcome ? a.yesUnits : a.noUnits;
          const bWin = winningOutcome ? b.yesUnits : b.noUnits;
          if (resolved) return Number(bWin - aWin);
          // pre-resolution: sort by total stake
          return Number(b.yesUnits + b.noUnits - (a.yesUnits + a.noUnits));
        });

        if (!cancelled) {
          setRows(list);
          setLoading(false);
        }

        // If resolved: snapshot the leaderboard so future viewers (and
        // subsequent renders, post-redemption) see the same final state.
        // First writer wins (server uses SETNX). Serialize bigints as
        // strings since JSON can't handle them.
        if (resolved) {
          const serializable = list.map((r) => ({
            pubkey: r.pubkey,
            pseudo: r.pseudo,
            yesUnits: r.yesUnits.toString(),
            noUnits: r.noUnits.toString(),
            committed: r.committed,
            betUnits: r.betUnits.toString(),
          }));
          fetch("/api/leaderboard-snapshot", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              vault: vaultId,
              rows: serializable,
              collateralUnits: poolCollateralUnits.toString(),
            }),
          }).catch(() => {});
        }
      } catch (e) {
        console.error("leaderboard load:", e);
        if (!cancelled) setLoading(false);
      }
    }

    // If resolved: try to load the frozen snapshot first. If it exists,
    // we use it and stop — no more on-chain reads, so redemptions don't
    // distort the final leaderboard.
    async function loadFromSnapshot(): Promise<boolean> {
      if (!resolved) return false;
      try {
        const res = await fetch(
          `/api/leaderboard-snapshot?vault=${vaultId}`,
        );
        if (!res.ok) return false;
        const json = await res.json();
        if (!json.snapshot) return false;
        // Support both shapes: array (legacy) or { rows, collateralUnits } (v2+)
        const raw = json.snapshot as SerializedRow[] | {
          rows: SerializedRow[];
          collateralUnits?: string;
        };
        const rowsRaw = Array.isArray(raw) ? raw : raw.rows;
        const collRaw = Array.isArray(raw)
          ? null
          : raw.collateralUnits ?? null;
        const snap = rowsRaw.map((r) => ({
          pubkey: r.pubkey,
          pseudo: r.pseudo,
          yesUnits: BigInt(r.yesUnits),
          noUnits: BigInt(r.noUnits),
          committed: r.committed,
          betUnits: r.betUnits ? BigInt(r.betUnits) : 0n,
        }));
        if (!cancelled) {
          setRows(snap);
          if (collRaw) setSnapshotCollateralUnits(BigInt(collRaw));
          setLoading(false);
        }
        return true;
      } catch {
        return false;
      }
    }

    (async () => {
      const fromSnap = await loadFromSnapshot();
      if (fromSnap) return; // frozen — no fetch, no polling
      load();
      if (!resolved) {
        const interval = setInterval(load, 5000);
        intervalRef.current = interval;
      }
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [program, vaultId, marketId, yesMint, noMint, resolved, winningOutcome]);

  if (loading) {
    return (
      <div className="rounded border border-gray-200 p-5 mb-6 text-xs text-gray-500">
        Loading leaderboard…
      </div>
    );
  }

  if (rows.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded border p-5 mb-6 ${resolved ? "border-yellow-300 bg-yellow-50" : "border-gray-200 bg-white"}`}
    >
      <h3 className="text-sm font-medium text-gray-900 mb-1">
        {resolved ? "🏆 Leaderboard" : "Leaderboard (live)"}
      </h3>
      <p className="text-xs text-gray-600 mb-4">
        {resolved
          ? `${winningOutcome ? "YES" : "NO"} won. Winners get $1 per winning token.`
          : "Updates every 5s. Pseudo registered when each player joins."}
      </p>

      {/* Header row */}
      {resolved && (
        <div className="grid grid-cols-[24px_1fr_70px_70px] gap-2 px-3 pb-2 text-[10px] uppercase tracking-wide text-gray-500 border-b border-gray-200 mb-2">
          <span>#</span>
          <span>Pseudo</span>
          <span className="text-right">Bet</span>
          <span className="text-right">Out</span>
        </div>
      )}

      {/* Compute pro-rata ratios so OUT reflects what the pool can
          actually pay. If circulating tokens of a side exceed pool
          collateral, payouts are scaled down (handled on-chain by
          redeem's pro-rata clause). */}
      {(() => null)()}
      <div className="space-y-1.5">
        {(() => {
          let totalYes = 0n;
          let totalNo = 0n;
          for (const r of rows) {
            totalYes += r.yesUnits;
            totalNo += r.noUnits;
          }
          const yesRatio =
            totalYes > 0n
              ? Math.min(
                  1,
                  Number(effectiveCollateralUnits) / Number(totalYes),
                )
              : 1;
          const noRatio =
            totalNo > 0n
              ? Math.min(
                  1,
                  Number(effectiveCollateralUnits) / Number(totalNo),
                )
              : 1;
          return rows.map((r, idx) => {
          const winUnits = winningOutcome ? r.yesUnits : r.noUnits;
          const loseUnits = winningOutcome ? r.noUnits : r.yesUnits;
          const winRatio = winningOutcome ? yesRatio : noRatio;
          const bet = unitsToDisplayUsd(r.betUnits);
          // Real payout = face value × pro-rata ratio
          const out = unitsToDisplayUsd(winUnits) * winRatio;
          const display = r.pseudo!;
          const isWinner = resolved && winUnits > 0n;
          const isLoser = resolved && winUnits === 0n && loseUnits > 0n;
          if (resolved) {
            return (
              <div
                key={r.pubkey}
                className={`grid grid-cols-[24px_1fr_70px_70px] gap-2 items-center rounded px-3 py-2 ${
                  isWinner
                    ? "bg-green-100 border border-green-200"
                    : isLoser
                      ? "bg-red-100 border border-red-200"
                      : "bg-gray-50"
                }`}
              >
                <span className="text-xs text-gray-400">{idx + 1}.</span>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-gray-900 truncate">
                    {display}
                  </span>
                  {r.committed && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                      1v1
                    </span>
                  )}
                </div>
                <span className="text-xs font-mono text-right text-gray-700">
                  {bet > 0 ? formatUsd(bet) : "—"}
                </span>
                <span
                  className={`text-sm font-mono font-semibold text-right ${
                    isWinner
                      ? "text-green-700"
                      : isLoser
                        ? "text-red-700"
                        : "text-gray-400"
                  }`}
                >
                  {isWinner
                    ? formatUsd(out)
                    : isLoser
                      ? `−${formatUsd(bet)}`
                      : formatUsd(out)}
                </span>
              </div>
            );
          }
          // Live (pre-resolution) row — show pro-rata-adjusted potential
          // payout for each side. These are what the player would
          // actually receive if that side wins right now.
          const ifYesUsd = unitsToDisplayUsd(r.yesUnits) * yesRatio;
          const ifNoUsd = unitsToDisplayUsd(r.noUnits) * noRatio;
          return (
            <div
              key={r.pubkey}
              className="flex items-center justify-between rounded px-3 py-2 bg-gray-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-gray-400 w-5">{idx + 1}.</span>
                <span className="text-sm font-medium text-gray-900 truncate">
                  {display}
                </span>
                {r.committed && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                    1v1
                  </span>
                )}
              </div>
              <div className="text-xs font-mono text-gray-700">
                {bet > 0 && (
                  <span className="text-gray-500">bet {formatUsd(bet)} · </span>
                )}
                {r.yesUnits > 0n && (
                  <span className="text-green-600">
                    if YES {formatUsd(ifYesUsd)}
                  </span>
                )}
                {r.yesUnits > 0n && r.noUnits > 0n && (
                  <span className="text-gray-400"> · </span>
                )}
                {r.noUnits > 0n && (
                  <span className="text-red-600">
                    if NO {formatUsd(ifNoUsd)}
                  </span>
                )}
                {r.yesUnits === 0n && r.noUnits === 0n && (
                  <span className="text-gray-400">—</span>
                )}
              </div>
            </div>
          );
        });
        })()}
      </div>
    </div>
  );
}

type CommitterListFetch = {
  committerPosition: {
    all: (
      filters: { memcmp: { offset: number; bytes: string } }[],
    ) => Promise<
      {
        publicKey: PublicKey;
        account: {
          vault: PublicKey;
          user: PublicKey;
          yesAmount: BN;
          noAmount: BN;
          claimed: boolean;
          refunded: boolean;
        };
      }[]
    >;
  };
};
