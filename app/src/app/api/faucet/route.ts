import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import bs58 from "bs58";

const USDG_MINT = new PublicKey(
  "4F6PM96JJxngmHnZLBh9n58RH4aTVNWvDs2nuwrT5BP7",
);
const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL ?? "https://api.devnet.solana.com";

// Hand-out per audience wallet
const SOL_PER_DROP = 0.005;
const USDG_DECIMALS = 6;
const USD_DROP_AMOUNT = 5; // display $5 per audience wallet
// 2x scaling: $1 display = 500_000 base units
const USDG_DROP_UNITS = USD_DROP_AMOUNT * 500_000;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const targetStr = body?.pubkey;
    if (typeof targetStr !== "string") {
      return NextResponse.json(
        { error: "missing pubkey" },
        { status: 400 },
      );
    }

    let target: PublicKey;
    try {
      target = new PublicKey(targetStr);
    } catch {
      return NextResponse.json(
        { error: "invalid pubkey" },
        { status: 400 },
      );
    }

    const secret = process.env.FAUCET_SECRET_KEY;
    if (!secret) {
      return NextResponse.json(
        { error: "faucet not configured" },
        { status: 500 },
      );
    }

    const faucetKp = Keypair.fromSecretKey(bs58.decode(secret));
    const connection = new Connection(RPC_URL, "confirmed");

    const faucetUsdgAta = await getAssociatedTokenAddress(
      USDG_MINT,
      faucetKp.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const targetUsdgAta = await getAssociatedTokenAddress(
      USDG_MINT,
      target,
      false,
      TOKEN_2022_PROGRAM_ID,
    );

    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: faucetKp.publicKey,
        toPubkey: target,
        lamports: Math.floor(SOL_PER_DROP * LAMPORTS_PER_SOL),
      }),
      createAssociatedTokenAccountIdempotentInstruction(
        faucetKp.publicKey,
        targetUsdgAta,
        target,
        USDG_MINT,
        TOKEN_2022_PROGRAM_ID,
      ),
      createTransferCheckedInstruction(
        faucetUsdgAta,
        USDG_MINT,
        targetUsdgAta,
        faucetKp.publicKey,
        BigInt(USDG_DROP_UNITS),
        USDG_DECIMALS,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    );

    const sig = await sendAndConfirmTransaction(connection, tx, [faucetKp], {
      commitment: "confirmed",
    });

    return NextResponse.json({ ok: true, sig });
  } catch (e) {
    console.error("faucet error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
