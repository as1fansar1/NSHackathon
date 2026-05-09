# Product Requirements Document — 1v1 Bet → Open Market

## Overview

A trustless betting app on Solana that **starts as a 1v1 social bet** (Balaji-style handshake + escrow) and **automatically opens up to a public prediction market** once the two original parties have committed.

The core value proposition: instant, mobile-friendly, publicly verifiable social bets that turn into community markets — no manual market maker, no centralized oracle for initial odds.

Built on top of the **pm-AMM Commitment Vault** primitive ([Paradigm pm-AMM paper](https://www.paradigm.xyz/2024/11/pm-amm)) — already deployed on Solana devnet, no new smart contract required.

---

## Demo Scenario (Hackathon)

Creator walks on stage and says: *"I bet you can't do 10 pushups."*

1. Creator opens app, types the bet title, picks a side (YES = "they will"), enters stake (e.g. \$100), hits **Create Bet**
2. A QR code appears on screen
3. Challenger in the audience scans the QR, connects their wallet, deposits matching \$100 on the opposite side (NO)
4. Commit phase ends (configurable, e.g. 1 min) → anyone (audience, app, automation) calls **Launch Market** → a pm-AMM pool opens at 50/50 odds
5. **Other audience members can now bet** YES or NO at live AMM prices
6. Challenger does 10 pushups
7. Creator taps **"They won"** → market resolves YES → all YES holders redeem 1:1 for USDG

Total demo time: under 4 minutes, with audience participation in the middle.

---

## Problem Statement

Two existing approaches both fail:

1. **Manual social bets** (Balaji \$1M BTC) — require multisig escrows, legal agreements, trusted third parties. Doesn't scale.
2. **Prediction markets** (Polymarket, Kalshi) — require curators, listing reviews, designated market makers. Cold-start problem: no markets unless someone fronts liquidity.

**Our wedge**: the original 2 parties of a 1v1 bet *are* the market makers. Their stake ratio sets the implied probability. The pm-AMM Commitment Vault primitive turns this insight into a permissionless mechanism.

---

## MVP Scope (Hackathon Build)

### In Scope
- Create a bet (title + commit phase duration + market duration + creator's side + stake)
- Generate a QR code linking the challenger to the bet
- Challenger joins and deposits matching stake on the opposite side
- After commit phase: anyone can launch the pm-AMM market
- Public users can buy/sell YES/NO at AMM prices
- Creator settles by declaring a winner (manual)
- Funds released instantly from market reserves to winning token holders

### Out of Scope (v1)
- Dispute mechanism
- Automated oracle settlers (Pyth/Switchboard) — listed as future settler types in UI
- Embedded wallet onboarding
- Mobile native app
- Multi-outcome bets (binary YES/NO only — pm-AMM constraint)

---

## Settler Architecture (Vision)

Three categories of settlers planned post-hackathon:

| Category | Examples | Settlement Method |
|---|---|---|
| **Manual** (v1) | Pushups, dares, physical challenges | Creator declares winner via `resolve_market` |
| **Oracle / Price** | Token price thresholds | Pyth/Switchboard feed wraps `resolve_market` authority |
| **Hardware** | Steps, heart rate, distance | Backend reads device API, signs `resolve_market` |
| **Screen Time / Apps** | Instagram hours, app usage | Backend reads OS APIs, signs `resolve_market` |

For v1, only **Manual** is shipped. Other categories shown grayed-out in the create flow to telegraph the roadmap.

---

## Currency & Display

We use **USDG (Token-2022)** on Solana devnet (faucet: [faucet.paxos.com](https://faucet.paxos.com)). USDG is what the underlying pm-AMM program operates on.

**Display scaling — 100,000×.** Real on-chain USDG is scarce in dev, so the UI shows amounts scaled up:
- \$100 displayed = 0.001 USDG real (just above the on-chain `MINIMUM_LIQUIDITY` of 1000 base units)
- \$100,000 displayed = 1 USDG real
- A user with 1 USDG has \$100k of "demo balance" to bet with

This is purely a UI convention — the on-chain math, escrow, and settlements are in real USDG.

---

## User Flow

### Creator
1. Connect Phantom wallet (devnet, USDG funded via Paxos faucet)
2. Enter bet title (free text)
3. Pick a side: **YES** (this will happen) or **NO** (this won't happen)
4. Enter stake amount (display \$)
5. Pick durations: commit phase (default 60s) + market phase after launch (default 5 min)
6. Hit **Create Bet** → 2 wallet signatures: open vault, then commit on chosen side
7. QR code displayed (links to `/bet/[vaultId]`)
8. Share physically or via socials
9. After challenger joins and commit phase ends: tap **Launch Market** (or wait for keeper)
10. After market expires: tap **YES wins** or **NO wins** to resolve

### Challenger
1. Scan QR → opens `/bet/[vaultId]` on mobile
2. See bet details (title, creator's side & stake, time left)
3. Connect Phantom mobile wallet
4. Tap **Match Bet** → wallet prompts to commit matching stake on opposite side
5. Wait for commit phase to end and market to launch
6. After resolution: tap **Claim Winnings** if their side won

### Public Bettor (after launch)
1. Visits `/bet/[vaultId]` (or browses recent bets at `/`)
2. Sees live AMM prices for YES and NO
3. Connects wallet, picks YES or NO, picks amount
4. Tx mints a complete YES+NO pair from collateral, then swaps into the chosen side at AMM price
5. After resolution: redeems winning tokens 1:1 for USDG

---

## Onboarding

- **Physical / IRL**: Creator shows QR code on phone or screen
- **Twitter / DM**: Creator posts QR or bet link — challenger scans/clicks to join
- Challenger needs: Phantom mobile wallet + USDG on Solana devnet (faucet linked from app)

---

## Smart Contract — pm-AMM (existing, devnet)

**No new smart contract is being shipped**. We integrate against the existing pm-AMM program by [@EwanBorgPad](https://github.com/EwanBorgPad/pmAMM):

- **Program ID**: `EvWE8LGzzyZRDASKLnLBy9qZRuL8iaJYiPf2mRZh75yV`
- **Collateral mint (USDG, Token-2022)**: `4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7`
- **Network**: Solana devnet

### Instructions used

| Instruction | Caller | Maps to PRD step |
|---|---|---|
| `initialize_vault` | Creator | "Create Bet" — opens commit phase |
| `commit_yes` / `commit_no` | Creator + Challenger | Stake on a side |
| `launch_vault_market` | Anyone (permissionless) | "Launch Market" — opens public trading |
| `claim_committer` | Creator + Challenger | Receive outcome tokens after launch |
| `refund_commit` | Creator + Challenger | If commit threshold not met |
| `buy_outcome_tokens` | Public bettor | Mint 1 YES + 1 NO from 1 USDG |
| `swap` | Public bettor | YES↔NO swap at AMM price |
| `sell_outcome_tokens` | Public bettor | Burn 1 YES + 1 NO → 1 USDG |
| `resolve_market` | Creator (authority) | "I won" / "They won" |
| `redeem` | Holders of winning tokens | Claim winnings 1:1 |

### Security
- `resolve_market` is signer-gated to the bet creator (the vault's authority)
- Escrow held in pool PDA — no admin key, no upgrade authority dependency for the bet flow

---

## Frontend — Next.js

### Pages

| Route | Purpose |
|---|---|
| `/` | Landing — list active bets, "Create" CTA, wallet balance |
| `/create` | Bet creation form → wallet → vault open + creator's commit |
| `/bet/[vaultId]` | Lifecycle page — handles all states based on vault/market data: commit phase, post-commit / pre-launch, live market, resolved, redeem |

### Stack
- **Framework**: Next.js 16 + React 19 + Tailwind v4 + TypeScript
- **Wallet**: `@solana/wallet-adapter-react` + Phantom + Solflare
- **Anchor client**: `@coral-xyz/anchor` (existing pm-AMM IDL)
- **QR**: `qrcode.react` — generated client-side from vault PDA
- **RPC**: Solana devnet
- **Deploy**: Vercel

---

## Team Split

| Builder | Owns |
|---|---|
| Builder 1 (contract / integration) | pm-AMM Anchor client wrapper, account derivations (PDAs), `lib/` helpers, transaction composition (compound mint+swap), settler architecture skeleton |
| Builder 2 (frontend) | `/`, `/create`, `/bet/[id]` pages, QR code, wallet UX, mobile responsive, design system |

We're using an existing pm-AMM program — no Rust/Anchor toolchain or contract deploy needed.

---

## Success Criteria (Hackathon Demo)

- [ ] Creator creates a bet on stage in under 30 seconds
- [ ] Challenger scans QR, joins, and commits in under 30 seconds
- [ ] Audience members can place additional YES/NO bets at AMM prices in real time
- [ ] Creator settles with one tap, winning holders can redeem on-chain
- [ ] No errors, no loading spinners > 3 seconds
- [ ] Judges understand the product without explanation
