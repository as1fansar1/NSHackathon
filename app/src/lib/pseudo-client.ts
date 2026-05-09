/**
 * Client helpers for the cross-browser pseudo registry.
 * Falls back to no-op if /api/pseudo isn't backed by a KV store.
 */

export async function registerPseudo(
  vaultId: string,
  pubkey: string,
  pseudo: string,
): Promise<void> {
  try {
    await fetch("/api/pseudo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault: vaultId, pubkey, pseudo }),
    });
  } catch {
    // best-effort
  }
}

export async function fetchPseudos(
  vaultId: string,
): Promise<Record<string, string>> {
  try {
    const res = await fetch(`/api/pseudo?vault=${vaultId}`);
    if (!res.ok) return {};
    const json = await res.json();
    return json.pseudos ?? {};
  } catch {
    return {};
  }
}
