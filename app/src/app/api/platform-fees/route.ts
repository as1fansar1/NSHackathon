import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/kv";

/**
 * Platform-side fees collected on each audience bet (1% added on top
 * of the on-chain pmAMM 1% LP fee). Tracked off-chain via Redis.
 *
 * POST { vault, units } → INCRBY (units in USDG base units)
 * GET ?vault=X         → returns { total: string }
 */
const TTL_SECONDS = 30 * 24 * 3600;

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ ok: true, stored: false });
  try {
    const body = await req.json();
    const vault = body?.vault;
    const units = body?.units;
    if (
      typeof vault !== "string" ||
      (typeof units !== "string" && typeof units !== "number")
    ) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const n = Number(units);
    if (!Number.isFinite(n) || n <= 0) {
      return NextResponse.json({ error: "bad units" }, { status: 400 });
    }
    const key = `vault:${vault}:platform_fees`;
    await redis.incrby(key, Math.floor(n));
    await redis.expire(key, TTL_SECONDS);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) return NextResponse.json({ ok: true, total: "0" });
  try {
    const vault = req.nextUrl.searchParams.get("vault");
    if (!vault) {
      return NextResponse.json({ error: "missing vault" }, { status: 400 });
    }
    const v = await redis.get<number | string>(
      `vault:${vault}:platform_fees`,
    );
    return NextResponse.json({ ok: true, total: v ? v.toString() : "0" });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
