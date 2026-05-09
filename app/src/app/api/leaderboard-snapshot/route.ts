import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/kv";

/**
 * Snapshot the leaderboard at resolution time so winners' balances are
 * frozen *before* anyone redeems. First writer wins (idempotent).
 *
 * POST { vault: "id", rows: [...] } → stores if absent
 * GET  ?vault=id                    → returns { snapshot: rows | null }
 */

const TTL_SECONDS = 30 * 24 * 3600; // 30 days

export async function POST(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ ok: true, stored: false }); // no-op
  }
  try {
    const body = await req.json();
    const vault = body?.vault;
    const rows = body?.rows;
    if (typeof vault !== "string" || !Array.isArray(rows)) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
    const key = `vault:${vault}:snapshot:v2`;
    // setnx returns 1 if set, 0 if already exists
    const set = await redis.setnx(key, JSON.stringify(rows));
    if (set) {
      await redis.expire(key, TTL_SECONDS);
    }
    return NextResponse.json({ ok: true, stored: set === 1 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  const redis = getRedis();
  if (!redis) {
    return NextResponse.json({ ok: true, snapshot: null });
  }
  try {
    const vault = req.nextUrl.searchParams.get("vault");
    if (!vault) {
      return NextResponse.json({ error: "missing vault" }, { status: 400 });
    }
    const raw = await redis.get<string>(`vault:${vault}:snapshot:v2`);
    if (!raw) {
      return NextResponse.json({ ok: true, snapshot: null });
    }
    // Upstash already deserializes JSON if it was stored as JSON, but
    // we explicitly stringified, so handle both.
    const snapshot =
      typeof raw === "string" ? JSON.parse(raw) : (raw as unknown);
    return NextResponse.json({ ok: true, snapshot });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
