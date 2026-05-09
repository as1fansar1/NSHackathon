import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeAccountInstruction,
  getAccount,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { AnchorProvider } from "@coral-xyz/anchor";

/**
 * Get or create an Associated Token Account for the given mint + owner.
 * Auto-detects Token-2022 vs classic SPL Token mints.
 */
export async function getOrCreateAta(
  provider: AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const mintInfo = await provider.connection.getAccountInfo(mint);
  const tokenProgramId =
    mintInfo?.owner?.toBase58() === TOKEN_2022_PROGRAM_ID.toBase58()
      ? TOKEN_2022_PROGRAM_ID
      : TOKEN_PROGRAM_ID;

  const ata = await getAssociatedTokenAddress(
    mint,
    owner,
    false,
    tokenProgramId,
  );

  try {
    await getAccount(provider.connection, ata, undefined, tokenProgramId);
    return ata;
  } catch {
    const tx = new Transaction().add(
      createAssociatedTokenAccountInstruction(
        provider.publicKey,
        ata,
        owner,
        mint,
        tokenProgramId,
      ),
    );
    await provider.sendAndConfirm(tx, [], { commitment: "confirmed" });
    return ata;
  }
}

/**
 * Create a fresh Token-2022 token account for USDG owned by `owner`.
 * USDG has extensions (TransferFee, ImmutableOwner, CpiGuard) that require 187 bytes.
 */
export async function createToken2022Account(
  provider: AnchorProvider,
  mint: PublicKey,
  owner: PublicKey,
): Promise<Keypair> {
  const keypair = Keypair.generate();

  // 187 = base 165 + TransferFeeAmount 13 + ImmutableOwner 4 + CpiGuard 5 (for USDG on devnet)
  const space = 187;
  const lamports =
    await provider.connection.getMinimumBalanceForRentExemption(space);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: provider.publicKey,
      newAccountPubkey: keypair.publicKey,
      space,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeAccountInstruction(
      keypair.publicKey,
      mint,
      owner,
      TOKEN_2022_PROGRAM_ID,
    ),
  );

  await provider.sendAndConfirm(tx, [keypair], { commitment: "confirmed" });
  return keypair;
}

export async function getUsdgBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  try {
    const ata = await getAssociatedTokenAddress(
      mint,
      owner,
      false,
      TOKEN_2022_PROGRAM_ID,
    );
    const acct = await getAccount(
      connection,
      ata,
      "confirmed",
      TOKEN_2022_PROGRAM_ID,
    );
    return acct.amount;
  } catch {
    return BigInt(0);
  }
}
