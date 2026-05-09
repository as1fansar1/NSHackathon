import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/kv";

/**
 * POST /api/pseudo  { vault: "123", pubkey: "...", pseudo: "alex" }
 * Stores the pseudo so it's visible from any browser viewing the bet.
 */
export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json(
      { error: "kv not configured" },
      { status: 503 },
    );
  }
  try {
    const body = await req.json();
    const vault = body?.vault;
    const pubkey = body?.pubkey;
    const pseudo = body?.pseudo;
    if (
      typeof vault !== "string" ||
      typeof pubkey !== "string" ||
      typeof pseudo !== "string"
    ) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const trimmed = pseudo.trim().slice(0, 32);
    if (!trimmed) {
      return NextResponse.json({ error: "empty pseudo" }, { status: 400 });
    }
    await redis.hset(`vault:${vault}`, { [pubkey]: trimmed });
    // Expire after 7 days — we don't need long-term persistence
    await redis.expire(`vault:${vault}`, 7 * 24 * 3600);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/pseudo?vault=123  →  { ok: true, pseudos: { pubkey: pseudo, ... } }
 */
export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ ok: true, pseudos: {} });
  }
  try {
    const vault = req.nextUrl.searchParams.get("vault");
    if (!vault) {
      return NextResponse.json({ error: "missing vault" }, { status: 400 });
    }
    const pseudos =
      (await redis.hgetall<Record<string, string>>(`vault:${vault}`)) ?? {};
    return NextResponse.json({ ok: true, pseudos });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
