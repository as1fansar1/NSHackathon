/**
 * Burner wallets — for the QR-scan demo flow.
 *
 * When the creator builds a bet, the app generates a fresh Solana Keypair,
 * funds it with $10 USDG from the creator's wallet, and embeds the secret
 * key in the QR URL (`/bet/[id]?key=<base58>`).
 *
 * The challenger scans → app imports the key → user picks a pseudo →
 * burner stored in localStorage keyed by vault_id. From then on the burner
 * signs all txs for that bet.
 *
 * SECURITY: the URL contains a private key. Anyone seeing the QR can drain
 * the $10 USDG. This is fine for hackathon devnet demos. Don't ship to
 * mainnet without replacing with a server-side claim flow.
 */
import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export type BurnerRecord = {
  secretKey: string; // base58
  pseudo: string;
  vaultId: string;
};

const KEY_PREFIX = "burner_";

export function storageKey(vaultId: string): string {
  return `${KEY_PREFIX}${vaultId}`;
}

export function loadBurner(vaultId: string): BurnerRecord | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(storageKey(vaultId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BurnerRecord;
  } catch {
    return null;
  }
}

export function saveBurner(record: BurnerRecord): void {
  localStorage.setItem(storageKey(record.vaultId), JSON.stringify(record));
}

export function clearBurner(vaultId: string): void {
  localStorage.removeItem(storageKey(vaultId));
}

export function keypairFromBase58(secret: string): Keypair {
  return Keypair.fromSecretKey(bs58.decode(secret));
}

export function keypairToBase58(kp: Keypair): string {
  return bs58.encode(kp.secretKey);
}

/** Generate a fresh Keypair for a burner wallet. */
export function generateBurner(): Keypair {
  return Keypair.generate();
}
