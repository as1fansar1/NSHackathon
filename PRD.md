# Product Requirements Document — 1v1 Bet App

## Overview

A trustless 1v1 betting app on Solana where anyone can challenge another person to a bet, lock stakes in on-chain escrow, and settle the outcome. The core value proposition: the Balaji-style social bet (handshake + escrow) made instant, mobile-friendly, and publicly verifiable on-chain.

Spectators can also bet on the outcome in real time — backing either side as the challenge unfolds.

---

## Problem Statement

Social bets between two people have no trustless infrastructure. The Balaji $1M BTC bet required manually constructing a multisig escrow, legal agreements, and a trusted third party. This app removes all of that — any two people can bet on anything with funds locked on-chain and released by the creator's declaration. Spectators turn every bet into a live market.

---

## Demo Scenario (Hackathon)

Creator walks on stage: *"I bet you can't do 10 pushups."*

1. Creator opens app, types the bet title, enters stake amount, hits **Create Bet**
2. A QR code appears on screen
3. Planted challenger in the audience scans the QR — lands on the bet page, deposits matching USDG to join as challenger
4. The audience sees real-time odds shift as spectators scan the same QR and pick a side
5. Challenger does 10 pushups
6. Creator taps **"They won"** — USDG is released to the challenger and winning spectators instantly on-chain

Total demo time: under 3 minutes.

---

## MVP Scope (Hackathon Build)

### In Scope
- Create a bet (title + USDG stake amount)
- Generate a single QR code for the bet
- First scan → challenger slot (deposit matching stake)
- Subsequent scans → spectator view (pick a side, any amount)
- Real-time odds display as spectators join
- Creator settles by declaring a winner — funds release to winner and winning spectators
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

### Bet Creator
1. Connect wallet
2. Enter bet title (free text)
3. Enter stake amount in USDG
4. Hit **Create Bet** → deposit USDG into escrow
5. QR code is generated and displayed
6. Share QR physically on stage, or post to Twitter/DM
7. After the bet condition plays out, tap **"I won"** or **"They won"**
8. Funds release to winner and winning spectators

### Bet Challenger (first QR scan)
1. Scan QR code → lands on bet page
2. See bet details (title, stake amount, creator, current spectator odds)
3. Connect wallet
4. Tap **Join as Challenger** → deposit matching USDG
5. Complete the challenge
6. Receive USDG if declared winner

### Spectator (subsequent QR scans)
1. Scan the same QR code → lands on bet page (challenger slot already filled)
2. See live odds — how much USDG is on each side
3. Connect wallet
4. Pick a side: **Back Creator** or **Back Challenger**
5. Enter amount and confirm deposit
6. Odds update in real time as others bet
7. Receive pro-rata payout from losing side if their pick wins

---

## Onboarding

- **Physical / IRL**: Creator shows QR code on phone or projected screen
- **Twitter**: Creator posts QR code image or bet link — anyone can scan/click to join or spectate
- Users need: Phantom mobile wallet + USDG on Solana devnet (hackathon) / mainnet (production)

---

## Pages

| Route | Purpose |
|---|---|
| `/` | Landing / home |
| `/create` | Bet creation form → deposit → QR |
| `/bet/[betId]` | Unified bet page — challenger join view OR spectator view depending on bet state |
| `/settle/[betId]` | Creator settle view — "I won" / "They won" buttons |

---

## Team Split

| Builder | Owns |
|---|---|
| Mathis | Smart contract + real-time data layer |
| Builder 2 | Frontend — all pages, wallet connect, real-time odds UI |

---

## Success Criteria (Hackathon Demo)

- [ ] Creator creates a bet on stage in under 30 seconds
- [ ] Challenger scans QR and joins in under 30 seconds
- [ ] Spectators join via same QR — odds update visibly in real time
- [ ] Creator settles with one tap — USDG moves on-chain instantly
- [ ] Judges understand the product without explanation
