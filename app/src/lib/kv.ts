import { Redis } from "@upstash/redis";

let client: Redis | null = null;

/**
 * Returns a Redis client if env vars are configured, else null.
 * Uses Vercel KV (Upstash-backed) — auto-injected when a KV store is
 * connected to the project: KV_REST_API_URL + KV_REST_API_TOKEN.
 */
export function getRedis(): Redis | null {
  if (client) return client;
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  client = new Redis({ url, token });
  return client;
}

export const KV_AVAILABLE = !!process.env.KV_REST_API_URL;
