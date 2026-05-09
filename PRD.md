# Product Requirements Document — 1v1 Bet → Open Market

## Overview

A trustless social-betting app on Solana. Two people open a 1v1 bet (YES or NO). The moment both sides have committed and the commit timer ends, the bet **escalates into a public prediction market** anyone can join: YES and NO outcome tokens trade on an on-chain AMM, audience members buy whichever side they believe, and the creator settles the outcome at a pre-set resolution time. Winning token holders redeem 1:1 against the vault.

The core insight: every social bet is a prediction market waiting to happen. Lock the 1v1, then open the doors.

---

## Problem Statement

Social bets between two people have no trustless infrastructure. The Balaji $1M BTC bet required manually constructing a multisig escrow, legal agreements, and a trusted third party. This app removes all of that — a 1v1 commit seeds a live prediction market, open to anyone, settled on-chain.

---

## Lifecycle

The vault moves through three phases:

```
┌─────────────┐  both commit + timer ends  ┌─────────────┐  resolution_time + creator resolves  ┌────────────────┐
│   COMMIT    │ ─────────────────────────► │   MARKET    │ ───────────────────────────────────► │  RESOLUTION    │
│  (private)  │                            │  (public)   │                                      │  (redeem)      │
└─────────────┘                            └─────────────┘                                      └────────────────┘
```

### Phase 1 — Commit (private 1v1)

- Creator opens a vault with `initialize_vault`: title, side (YES/NO), stake, commit duration (60s), market duration (1–60 min)
- Creator commits stake via `commit_yes` or `commit_no`
- App **auto-provisions a burner wallet** for the challenger: generates a fresh keypair, funds it with $10 USDG + 0.01 SOL from the creator's tx, embeds the secret in the QR URL
- Challenger scans QR → page loads burner wallet → takes the opposite side via `commit_yes` / `commit_no`
- Min commit: $2/side, $20 combined to be eligible to launch the market

### Phase 2 — Market (public AMM)

- Once both sides are committed AND `commit_end_time` has elapsed, anyone can call `launch_vault_market` — this initializes the pmAMM pool, mints YES_MINT and NO_MINT outcome tokens, and seeds liquidity
- New audience members scan the same QR → land on the market view
- First-time spectators tap one button → `/api/faucet` server-signs $5 USDG + 0.005 SOL to their wallet (one drop per pubkey)
- Spectators call `buy_outcome_tokens` to buy YES or NO at AMM-determined prices; live odds = ratio of pool reserves
- Fees: **1% LP fee** (to liquidity providers, ie. committers) + **1% platform fee** (routed to platform treasury) on every audience trade
- Market stays open until `resolution_time` (= now + commit_duration + market_duration)

### Phase 3 — Resolution

- Creator calls `resolve_market` declaring YES or NO
- Winning outcome token holders call `redeem` — burns their tokens, releases USDG 1:1 from the vault
- Committers call `claim_committer` to settle their original 1v1 positions
- Leaderboard snapshot persists pseudos + payouts via `/api/leaderboard-snapshot`

---

## Demo Scenario (Hackathon, ≤3 min)

Mathis on stage: *"I bet I can do 50 pushups. Asif says I can't."*

1. Mathis opens app, picks pseudo "mathis", enters title, picks **YES**, stakes $10, sets market duration 5 min, hits **Create**
2. App initializes vault, commits $10 YES, auto-provisions burner wallet ($10 USDG + 0.01 SOL), shows QR
3. Asif scans QR → page loads burner wallet pre-funded → he picks pseudo "asif", commits $10 NO. Market unlocks in 60s
4. Mathis posts the QR on the projector. Audience scans → faucet drops $5 USDG + 0.005 SOL into each spectator wallet
5. Audience members buy YES or NO. Live odds shift on screen as pools rebalance
6. Mathis does 50 pushups
7. Mathis calls `resolve_market` → YES wins. YES holders redeem; NO tokens are worthless. Leaderboard shows top winners

Total demo time: under 3 minutes. Audience joins with one tap, no prior wallet setup needed.

---

## MVP Scope

### In Scope
- 3-phase lifecycle (Commit → Market → Resolution) with on-chain enforcement of timing gates
- Token-2022 USDG on Solana devnet as the collateral
- Burner-wallet auto-provisioning so the challenger never needs a pre-funded wallet
- Server faucet that drops $5 USDG + 0.005 SOL to each new spectator (one-shot per pubkey)
- AMM-priced YES/NO outcome tokens with 1% LP fee + 1% platform fee
- Pseudo-handle leaderboard (off-chain Redis snapshot at resolution)
- QR code as the single onboarding surface across IRL and Twitter

### Out of Scope (v1)
- Dispute mechanism (resolution is single-signer creator)
- Automated settlers (price oracles, hardware, screen time) — vision-level only
- Embedded wallet onboarding (burner is the soft-form substitute)
- Mobile native app
- Liquidity provisioning by external LPs (only committers seed the pool)
- Multiple resolutions or partial settlements

---

## Settler Architecture (Vision, post-hackathon)

| Category | Examples | Settlement Method |
|---|---|---|
| **Manual** *(only one shipped)* | Pushups, dares, physical challenges | Creator declares winner |
| **Jupiter / On-chain** | Token price movement, market cap threshold | Automated via on-chain price feed |
| **Hardware** | Steps, heart rate, distance (Fitbit, Apple Health) | Backend reads device data, signs settlement tx |
| **Screen Time** | Instagram hours, app usage limits | Backend reads Screen Time API, signs settlement tx |

Settlement triggers: **Time** (specific deadline) or **Action** (specific event).

---

## Smart Contract — `pmAMM` (Anchor / Rust)

### Instructions exposed to the frontend (in lifecycle order)

| Instruction | Caller | Purpose |
|---|---|---|
| `initialize_vault` | Creator | Creates vault PDA, sets title + commit/resolution timers, links Token-2022 collateral vault |
| `commit_yes` / `commit_no` | Creator, Challenger | Locks stake on a side; mints `CommitterPosition` PDA |
| `launch_vault_market` | Anyone (post-commit) | Initializes pmAMM pool, mints YES/NO/LP mints, seeds liquidity from committer stakes |
| `buy_outcome_tokens` | Audience | Buys YES or NO at AMM price; charges 1% LP fee + 1% platform fee |
| `resolve_market` | Creator | Declares YES or NO winner |
| `claim_committer` | Committers | Withdraws committer's settled position |
| `redeem` | Outcome-token holders | Burns winning tokens for 1:1 USDG from vault |

### AMM primitives (in IDL, not exposed in demo UI)

`add_liquidity`, `remove_liquidity`, `swap`, `sell_outcome_tokens`, `refund_commit`, `create_market`, `initialize_pool`, `initialize_registry`, `set_registry_count`

### Account model (PDA seeds)

- `registry` — global registry of vaults
- `vault[vault_id]` — per-bet escrow + state
- `pool[vault]` — AMM pool for the vault
- `committer[vault, user]` — per-user commit position
- `yes_mint[vault]` / `no_mint[vault]` / `lp_mint[vault]` — outcome and LP token mints
- Token-2022 collateral vault holds USDG, owned by vault PDA

### Security
- `resolve_market` is signer-gated to vault.authority (creator) only
- `commit_*` enforced before `commit_end_time`; `launch_vault_market` enforced after
- `redeem` only post-resolution
- No admin key, no upgrade authority for v1

### Constants
- `PROGRAM_ID`: `EvWE8LGzzyZRDASKLnLBy9qZRuL8iaJYiPf2mRZh75yV`
- `USDG_MINT`: `4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7` (Token-2022 on devnet)
- `PLATFORM_TREASURY`: faucet keypair re-used (`HmECJ1Fww5PyxHybSkDTDgUwP4HGm1aXdrugDX57cH36`)
- `PLATFORM_FEE_BPS`: 100 (1%)
- `LP_FEE_BPS`: 100 (1%)
- `TOKEN_DECIMALS`: 6

---

## UI scaling trick

The frontend shows `$` figures that are **2× the real USDG amount**. A "$10" stake is 5 USDG on-chain. This is so `$10/side` and `$20 combined` hit the on-chain `MIN_COMMIT` threshold while looking natural to a demo audience. All token displays use `unitsToDisplayUsd` / `displayUsdToUnits` helpers for the conversion.

---

## Frontend — Next.js

### Pages

| Route | Purpose |
|---|---|
| `/` | Landing — wallet connect, balance display (SOL / real USDG / display $), CTA to `/create` |
| `/create` | Bet creation form → wallet sign → `initialize_vault` + `commit_*` + burner provisioning → redirect to `/bet/[id]` |
| `/bet/[id]` | Dynamic — switches between Commit, Market, and Resolution views based on vault state. Handles burner-wallet load (when QR carries `?b=…`), faucet onboarding, AMM trade UI, live odds, resolution UI |

### Stack
- **Framework**: Next.js (canary — see `app/AGENTS.md` for breaking-change note)
- **Wallet**: `@solana/wallet-adapter` + Phantom; burner keypair lifted via `lib/burner-wallet.ts` and `lib/active-wallet.ts`
- **Token**: SPL Token-2022 helpers in `lib/spl-helpers.ts`
- **Program**: `lib/program.ts` + `lib/use-program.ts` + `pm_amm_idl.json`
- **PDAs**: `lib/pda.ts`
- **QR**: `qrcode.react`, generated client-side from vault PDA
- **Styling**: Tailwind CSS

---

## Backend — API routes (Next.js, Redis-backed)

| Route | Purpose |
|---|---|
| `POST /api/faucet` | Server-signs $5 USDG + 0.005 SOL transfer to a spectator wallet (one drop per pubkey) |
| `POST /api/bet-track` | INCRBY tracker of cumulative $ each non-committer has bet per vault (committers' stakes are on-chain so excluded). 30-day TTL |
| `GET /api/bet-track?vault=…` | Returns `{ bets: { pubkey: units } }` for leaderboard preview |
| `POST /api/pseudo` | Registers pseudo ↔ pubkey for the leaderboard |
| `POST /api/leaderboard-snapshot` | Persists final pseudo + payout list at resolution |
| `GET /api/platform-fees` | Returns total platform-fee accrual for the demo dashboard |

KV layer: `lib/kv.ts` (Redis). Faucet keypair: stored as base58 in `FAUCET_SECRET_KEY` env var, doubles as platform treasury.

---

## Onboarding

| Audience | Path | Wallet |
|---|---|---|
| Creator | `/create` form, signs txs | Phantom (must hold devnet SOL + USDG) |
| Challenger | Scans creator's QR with burner-wallet seed | Burner keypair (auto-provisioned, no setup) |
| Audience spectators | Scan public market QR | Their own Phantom **or** auto-funded via `/api/faucet` |

USDG faucet: [faucet.paxos.com](https://faucet.paxos.com/). SOL faucet: [faucet.solana.com](https://faucet.solana.com).

---

## Team Split

| Builder | Owns |
|---|---|
| Mathis | Anchor program (pmAMM), real-time data layer, devnet deployment |
| Asif | Next.js frontend, all API routes, faucet + leaderboard infra, burner-wallet flow |

---

## Success Criteria (Hackathon Demo)

- [ ] Creator creates a bet on stage in under 30 seconds
- [ ] Challenger scans QR and commits opposite side in under 30 seconds with no wallet setup
- [ ] Audience spectators join via faucet in one tap and place bets within 10 seconds
- [ ] Live odds shift visibly on the projector as audience trades execute
- [ ] Creator resolves with one tap; winning spectators redeem and see USDG land in their wallet
- [ ] Leaderboard renders pseudos + payouts at resolution
- [ ] No errors, no loading spinners > 3 seconds
- [ ] Judges understand the product without explanation
