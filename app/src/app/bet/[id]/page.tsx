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
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import BN from "bn.js";
import { QRCodeSVG } from "qrcode.react";
import { Program } from "@coral-xyz/anchor";
import { useProgram } from "@/lib/use-program";
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
  const [market, setMarket] = useState<MarketData | null>(null);
  const [userYesUnits, setUserYesUnits] = useState<bigint>(0n);
  const [userNoUnits, setUserNoUnits] = useState<bigint>(0n);
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
        </div>
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
  const { publicKey } = useWallet();
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  const { publicKey } = useWallet();
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
  const { publicKey } = useWallet();
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
  const { publicKey } = useWallet();
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
