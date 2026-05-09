# Product Requirements Document — 1v1 Bet App

## Overview

A trustless 1v1 betting app on Solana where anyone can challenge another person to a bet, lock stakes in on-chain escrow, and settle the outcome. The core value proposition: the Balaji-style social bet (handshake + escrow) made instant, mobile-friendly, and publicly verifiable on-chain.

---

## Demo Scenario (Hackathon)

Creator walks on stage and says: *"I bet you can't do 10 pushups."*

1. Creator opens app, types the bet title, enters stake amount (0.1 SOL), hits **Create Bet**
2. A QR code appears on screen
3. Challenger in the audience scans the QR code, connects their wallet, deposits matching 0.1 SOL
4. Challenger does 10 pushups
5. Creator taps **"They won"** — 0.2 SOL is released to the challenger's wallet instantly on-chain

Total demo time: under 3 minutes.

---

## Problem Statement

Social bets between two people have no trustless infrastructure. The Balaji $1M BTC bet required manually constructing a multisig escrow, legal agreements, and a trusted third party. This app removes all of that — any two people can bet on anything with funds locked on-chain and released by the creator's declaration.

---

## MVP Scope (Hackathon Build)

### In Scope
- Create a bet (title + SOL stake)
- Generate a QR code linking the challenger to the bet
- Challenger joins and deposits matching SOL
- Creator settles by declaring a winner (themselves or the challenger)
- Funds released instantly from escrow to winner

### Out of Scope (v1)
- Dispute mechanism
- Automated settlers (Jupiter price feeds, hardware trackers, screen time) — shown as grayed-out future options in UI
- Embedded wallet onboarding
- Mobile native app
- Multiple challengers / spectator bets

---

## Settler Architecture (Vision)

Three categories of settlers are planned post-hackathon:

| Category | Examples | Settlement Method |
|---|---|---|
| **Manual** | Pushups, dares, physical challenges | Creator declares winner |
| **Jupiter / On-chain** | Token price in 60s, market cap threshold | Pyth/Switchboard oracle, fully automated |
| **Hardware** | Steps (Fitbit/Apple Health), heart rate, distance | Backend reads device API, signs settlement tx |
| **Screen Time** | Instagram hours, app usage | Backend reads Screen Time API, signs settlement tx |

Settlement can be triggered by:
- **Time** — a specific deadline (e.g., "by Friday 5pm")
- **Action** — a specific event (e.g., "when SOL hits $200", "when 10,000 steps logged")

---

## User Flow

### Bet Creator
1. Connect Phantom wallet
2. Enter bet title (free text)
3. Enter stake amount in SOL
4. Hit **Create Bet** → wallet prompts to deposit SOL into escrow PDA
5. QR code is generated and displayed (links to `/bet/[betId]`)
6. Share QR physically or via Twitter/DM
7. After the bet condition plays out, tap **"I won"** or **"They won"**
8. Transaction fires, escrow releases to winner

### Bet Challenger
1. Scan QR code → opens `/bet/[betId]` in mobile browser
2. See bet details (title, stake amount, creator)
3. Connect Phantom mobile wallet
4. Tap **Join Bet** → wallet prompts to deposit matching SOL
5. Wait for creator to settle
6. Receive SOL if declared winner

---

## Onboarding

- **Physical / IRL**: Creator shows QR code on phone or screen
- **Twitter**: Creator posts QR code image or bet link — challenger scans/clicks to join
- Challenger needs: Phantom mobile wallet + SOL on Solana devnet (hackathon) / mainnet (production)

---

## Smart Contract — Anchor/Rust

### State: `Bet` Account (PDA)

```
bet_id: u64
title: String
creator: Pubkey
challenger: Option<Pubkey>
stake_amount: u64          // lamports
status: BetStatus          // Open | Active | Settled
winner: Option<Pubkey>
created_at: i64
```

### Instructions

| Instruction | Caller | Action |
|---|---|---|
| `create_bet` | Creator | Initializes Bet PDA, deposits stake into escrow |
| `join_bet` | Challenger | Deposits matching stake, sets challenger pubkey, status → Active |
| `settle_bet` | Creator only | Declares winner pubkey, releases full escrow to winner |

### Security
- `settle_bet` is signer-gated to creator pubkey only
- Escrow held in PDA — no admin key, no upgrade authority needed for v1

---

## Frontend — Next.js

### Pages

| Route | Purpose |
|---|---|
| `/` | Landing / home |
| `/create` | Bet creation form → wallet connect → deposit → QR |
| `/bet/[betId]` | Challenger view — bet details → wallet connect → deposit |
| `/settle/[betId]` | Creator settle view — "I won" / "They won" buttons |

### Stack
- **Framework**: Next.js (deployed on Vercel)
- **Wallet**: `@solana/wallet-adapter` + Phantom
- **QR**: `qrcode.react` — generated client-side from bet PDA address
- **RPC**: Solana devnet (hackathon) / mainnet-beta (production)
- **Styling**: Tailwind CSS

---

## Team Split

| Builder | Owns |
|---|---|
| Builder 1 | Anchor smart contract — `create_bet`, `join_bet`, `settle_bet` |
| Builder 2 | Next.js frontend — `/create`, `/bet/[id]`, `/settle/[id]` |

Builder 2 mocks the contract interface locally and wires to devnet once Builder 1 deploys.

---

## Success Criteria (Hackathon Demo)

- [ ] Creator creates a bet on stage in under 30 seconds
- [ ] Challenger scans QR and joins in under 30 seconds
- [ ] Creator settles with one tap, funds move on-chain visibly
- [ ] No errors, no loading spinners > 3 seconds
- [ ] Judges understand the product without explanation
