import { AnchorProvider, Program, Idl } from "@coral-xyz/anchor";
import { Connection } from "@solana/web3.js";
import idlJson from "./pm_amm_idl.json";

export type AnchorWallet = AnchorProvider["wallet"];

export function getProvider(connection: Connection, wallet: AnchorWallet) {
  return new AnchorProvider(connection, wallet, { commitment: "confirmed" });
}

export function getProgram(connection: Connection, wallet: AnchorWallet) {
  const provider = getProvider(connection, wallet);
  return new Program(idlJson as Idl, provider);
}

export const PM_AMM_IDL = idlJson as Idl;
