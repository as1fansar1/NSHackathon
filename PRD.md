# Product Requirements Document — The Daily Wager

## Overview

A social prediction market on Solana. Any two people can create a challenge — the moment both sides agree and lock funds, the market opens for everyone. Participants join either side, odds evolve in real time as liquidity flows in, and the creator settles the outcome on-chain.

The core insight: every real-world challenge (a dare, a fitness bet, a price call) is a prediction market waiting to happen. The Daily Wager provides the rails.

---

## Problem Statement

Social bets between two people have no trustless infrastructure. The Balaji $1M BTC bet required manually constructing a multisig escrow, legal agreements, and a trusted third party. This app removes all of that — a 1v1 challenge seeds a live prediction market, open to anyone, settled on-chain.

---

## Demo Scenario (Hackathon)

Creator walks on stage: *"I bet you can't do 10 pushups."*

1. Creator opens app, types the challenge, enters stake amount, hits **Create**
2. A QR code appears on screen
3. Challenger scans the QR — deposits matching USDG to accept the challenge. **Market opens.**
4. Creator shares the QR with the audience — anyone can scan, pick a side, and enter the market
5. Live odds shift on screen as participants join
6. Challenger does 10 pushups
7. Creator taps **"They won"** — USDG releases to the challenger and all winning participants instantly on-chain

Total demo time: under 3 minutes.

---

## MVP Scope (Hackathon Build)

### In Scope
- Create a challenge (title + USDG stake amount)
- Generate a single QR code for the challenge
- **Phase 1 — Challenge**: First scan → challenger accepts and deposits matching USDG. Market is now open.
- **Phase 2 — Market**: All subsequent participants pick a side (Creator or Challenger) and deposit any amount. Odds update in real time.
- Creator settles by declaring a winner — USDG releases pro-rata to all winning participants
- Currency: USDG on Solana devnet

### Out of Scope (v1)
- Dispute mechanism
- Automated settlers (Jupiter price feeds, hardware trackers, screen time) — shown as grayed-out future options in UI
- Embedded wallet onboarding
- Mobile native app

---

## Settler Architecture (Vision)

Three categories of settlers are planned post-hackathon:

| Category | Examples | Settlement Method |
|---|---|---|
| **Manual** | Pushups, dares, physical challenges | Creator declares winner |
| **Jupiter / On-chain** | Token price movement, market cap threshold | Automated via on-chain price feed |
| **Hardware** | Steps, heart rate, distance (Fitbit, Apple Health) | Backend reads device data |
| **Screen Time** | Instagram hours, app usage limits | Backend reads Screen Time API |

Settlement can be triggered by:
- **Time** — a specific deadline (e.g., "by Friday 5pm")
- **Action** — a specific event (e.g., "when SOL hits $200", "when 10,000 steps logged")

---

## User Flow

### Challenge Creator
1. Connect wallet
2. Enter challenge title (free text)
3. Enter stake amount in USDG
4. Hit **Create Challenge** → deposit USDG into escrow
5. QR code generated — share physically or post to Twitter/DM
6. Once challenger accepts, market opens automatically
7. After the challenge plays out, tap **"I won"** or **"They won"**
8. USDG releases to all winning participants

### Challenger (first QR scan — market closed)
1. Scan QR → lands on challenge page
2. See challenge details (title, stake, creator)
3. Connect wallet
4. Tap **Accept Challenge** → deposit matching USDG
5. Market opens — QR now live for all participants
6. Complete the challenge
7. Receive USDG if declared winner

### Market Participant (subsequent QR scans — market open)
1. Scan QR → lands on market page
2. See live odds — total USDG on each side, implied probability
3. Connect wallet
4. Pick a side: **Back Creator** or **Back Challenger**
5. Enter amount → deposit USDG
6. Odds update in real time across all connected screens
7. Receive pro-rata payout from losing pool if their side wins

---

## Market Mechanics

- **Parimutuel model** — odds are determined by the ratio of total USDG on each side
- Odds update in real time as participants join
- Winner's pool = total losing pool (minus house fee) distributed pro-rata by stake
- House fee: TBD (suggested 1–2%)

---

## Onboarding

- **Physical / IRL**: Creator shows QR on phone or projected screen — audience scans to join market
- **Twitter**: Creator posts QR or challenge link — anyone online can participate
- Users need: Phantom mobile wallet + USDG on Solana devnet (hackathon) / mainnet (production)

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing / home |
| `/create` | Challenge creation form → deposit → QR |
| `/challenge/[id]` | Dynamic page — shows Accept Challenge view (market closed) or Live Market view (market open) based on state |
| `/settle/[id]` | Creator settle view — "I won" / "They won" buttons |

---

## Team Split

| Builder | Owns |
|---|---|
| Mathis | Smart contract + real-time data layer |
| Asif | Frontend — all pages, wallet connect, real-time odds UI |

---

## Success Criteria (Hackathon Demo)

- [ ] Creator creates a challenge on stage in under 30 seconds
- [ ] Challenger scans QR and accepts in under 30 seconds — market opens
- [ ] Audience participants join via same QR — odds shift visibly in real time
- [ ] Creator settles with one tap — USDG moves on-chain instantly
- [ ] Judges understand the product without explanation
