import {
  historyPartitionForProduct,
  historyRangeConfig,
  partitionMarketSnapshot,
  type CompactHistoryPartition,
  type CompactMarketSnapshot,
  type MarketHistoryIngest,
  type PricePoint,
} from "@sky-turbo/core";
import { createRemoteJWKSet, jwtVerify } from "jose";

type Env = {
  DB: D1Database;
  INGEST_SECRET: string;
  ALLOWED_ORIGIN: string;
  VERCEL_INGEST_URL: string;
  CLERK_ISSUER?: string;
  CLERK_JWKS_URL?: string;
};

type StateRow = { updated_at: number; payload: string };
type HistoryRow = { updated_at: number; payload: number[] };
type BlobRow = { updated_at: number; payload: number[] };
type HistoryBucketRow = { bucket: number; updated_at: number };

const MARKET_BODY_LIMIT = 1_900_000;
const IMPORT_BODY_LIMIT = 8_000_000;
const GZIP_ROW_LIMIT = 1_900_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function corsHeaders(env: Env): HeadersInit {
  return {
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, PUT, DELETE, POST, OPTIONS",
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    Vary: "Origin",
  };
}

function json(env: Env, data: unknown, status = 200): Response {
  return Response.json(
    { data },
    {
      status,
      headers: {
        ...corsHeaders(env),
        "Cache-Control": "no-store",
      },
    },
  );
}

function errorResponse(env: Env, message: string, status: number): Response {
  return Response.json(
    { error: { message } },
    {
      status,
      headers: {
        ...corsHeaders(env),
        "Cache-Control": "no-store",
      },
    },
  );
}

async function secretMatches(request: Request, expected: string): Promise<boolean> {
  const authorization = request.headers.get("Authorization") ?? "";
  const provided = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!provided || !expected) return false;
  const encoder = new TextEncoder();
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(providedHash);
  const right = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

async function readTextLimited(request: Request, maxBytes: number): Promise<string> {
  const declaredLength = Number(request.headers.get("Content-Length") ?? "0");
  if (declaredLength > maxBytes) throw new RangeError("Request body is too large");
  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new RangeError("Request body is too large");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(combined);
}

async function readJsonLimited<T>(request: Request, maxBytes: number): Promise<T> {
  const text = await readTextLimited(request, maxBytes);
  return JSON.parse(text) as T;
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzipText(payload: number[]): Promise<string> {
  const compressed = Uint8Array.from(payload);
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(stream).text();
}

function compressedJsonResponse(env: Env, row: BlobRow): Response {
  const compressed = Uint8Array.from(row.payload);
  const body = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Response(body, {
    headers: {
      ...corsHeaders(env),
      "Cache-Control": "private, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
      "X-Updated-At": String(row.updated_at),
    },
  });
}

async function authenticate(request: Request, env: Env): Promise<string> {
  const authorization = request.headers.get("Authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
  if (!token || !env.CLERK_ISSUER || !env.CLERK_JWKS_URL) throw new Error("Unauthorized");
  const jwks = createRemoteJWKSet(new URL(env.CLERK_JWKS_URL));
  const { payload } = await jwtVerify(token, jwks, { issuer: env.CLERK_ISSUER });
  if (!payload.sub) throw new Error("Unauthorized");
  return payload.sub;
}

async function bookmarks(request: Request, env: Env, pathname: string): Promise<Response> {
  let userId: string;
  try {
    userId = await authenticate(request, env);
  } catch {
    return errorResponse(env, "Unauthorized", 401);
  }

  if (pathname === "/v1/me/bookmarks" && request.method === "GET") {
    const rows = await env.DB.prepare(
      "SELECT product_id FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC",
    )
      .bind(userId)
      .all<{ product_id: string }>();
    return json(env, { productIds: rows.results.map((row) => row.product_id) });
  }

  const prefix = "/v1/me/bookmarks/";
  const productId = decodeURIComponent(pathname.slice(prefix.length)).trim();
  if (!pathname.startsWith(prefix) || !productId) return errorResponse(env, "Not found", 404);
  if (!/^[A-Z0-9_:.-]{1,128}$/.test(productId)) return errorResponse(env, "Invalid product ID", 400);

  if (request.method === "PUT") {
    await env.DB.prepare(
      "INSERT INTO bookmarks (user_id, product_id, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    )
      .bind(userId, productId, Date.now())
      .run();
    return json(env, { productId, bookmarked: true });
  }

  if (request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM bookmarks WHERE user_id = ? AND product_id = ?")
      .bind(userId, productId)
      .run();
    return json(env, { productId, bookmarked: false });
  }

  return errorResponse(env, "Method not allowed", 405);
}

function isMarketIngest(value: unknown): value is MarketHistoryIngest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MarketHistoryIngest>;
  return Boolean(
    candidate.snapshot &&
      candidate.compact &&
      Number.isFinite(candidate.snapshot.updatedAt) &&
      candidate.snapshot.items &&
      Number.isFinite(candidate.compact.updatedAt) &&
      candidate.compact.items &&
      candidate.snapshot.updatedAt === candidate.compact.updatedAt,
  );
}

async function runBatches(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  for (let index = 0; index < statements.length; index += 50) {
    await db.batch(statements.slice(index, index + 50));
  }
}

async function persistMarketSnapshot(env: Env, ingest: MarketHistoryIngest): Promise<void> {
  const current = ingest.compact;
  const priorRow = await env.DB.prepare(
    "SELECT updated_at, payload FROM market_state WHERE key = 'latest_compact'",
  ).first<StateRow>();
  if (priorRow && current.updatedAt <= priorRow.updated_at) return;

  const statements: D1PreparedStatement[] = [];
  if (priorRow) {
    const prior = JSON.parse(priorRow.payload) as CompactMarketSnapshot;
    const tiers = [
      { name: "5m", bucketMs: 300_000 },
      { name: "1h", bucketMs: 3_600_000 },
      { name: "1d", bucketMs: DAY_MS },
    ] as const;
    const changedTiers = tiers.filter(
      (tier) => Math.floor(prior.updatedAt / tier.bucketMs) !== Math.floor(current.updatedAt / tier.bucketMs),
    );
    if (changedTiers.length > 0) {
      const partitions = partitionMarketSnapshot(prior);
      const compressedPartitions = await Promise.all(
        partitions.map(async (partition) => ({
          partition: partition.partition,
          payload: await gzip(JSON.stringify(partition)),
        })),
      );

      for (const tier of changedTiers) {
        const priorBucket = Math.floor(prior.updatedAt / tier.bucketMs);
        for (const partition of compressedPartitions) {
          statements.push(
            env.DB.prepare(
              `INSERT INTO market_history (tier, bucket, partition, updated_at, payload)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT (tier, bucket, partition) DO UPDATE SET
                 updated_at = excluded.updated_at,
                 payload = excluded.payload`,
            ).bind(tier.name, priorBucket, partition.partition, prior.updatedAt, partition.payload.buffer),
          );
        }
        if (tier.name === "5m") {
          const cutoffBucket = Math.floor((current.updatedAt - 8 * DAY_MS) / tier.bucketMs);
          statements.push(
            env.DB.prepare("DELETE FROM market_history WHERE tier = '5m' AND bucket < ?").bind(cutoffBucket),
          );
        } else if (tier.name === "1h") {
          const cutoffBucket = Math.floor((current.updatedAt - 93 * DAY_MS) / tier.bucketMs);
          statements.push(
            env.DB.prepare("DELETE FROM market_history WHERE tier = '1h' AND bucket < ?").bind(cutoffBucket),
          );
        }
      }
    }
  }

  statements.push(
    env.DB.prepare(
      `INSERT INTO market_state (key, updated_at, payload) VALUES ('latest_snapshot', ?, ?)
       ON CONFLICT (key) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload`,
    ).bind(ingest.snapshot.updatedAt, JSON.stringify(ingest.snapshot)),
    env.DB.prepare(
      `INSERT INTO market_state (key, updated_at, payload) VALUES ('latest_compact', ?, ?)
       ON CONFLICT (key) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload`,
    ).bind(current.updatedAt, JSON.stringify(current)),
  );
  await runBatches(env.DB, statements);
}

async function putImportedJson(
  request: Request,
  env: Env,
  table: "imported_history" | "imported_meta" | "imported_ah_history" | "imported_ah_meta" | "ah_flip_state",
  keyColumn: "product_id" | "key",
  key: string,
): Promise<Response> {
  let text: string;
  try {
    text = await readTextLimited(request, IMPORT_BODY_LIMIT);
    JSON.parse(text);
  } catch (error) {
    const status = error instanceof RangeError ? 413 : 400;
    return errorResponse(env, error instanceof Error ? error.message : "Invalid JSON", status);
  }
  const payload = await gzip(text);
  if (payload.byteLength > GZIP_ROW_LIMIT) return errorResponse(env, "Compressed history row is too large", 413);
  await env.DB.prepare(
    `INSERT INTO ${table} (${keyColumn}, updated_at, payload) VALUES (?, ?, ?)
     ON CONFLICT (${keyColumn}) DO UPDATE SET updated_at = excluded.updated_at, payload = excluded.payload`,
  )
    .bind(key, Date.now(), payload)
    .run();
  return json(env, { key, compressedBytes: payload.byteLength });
}

async function importedJson(
  request: Request,
  env: Env,
  table: "imported_history" | "imported_meta" | "imported_ah_history" | "imported_ah_meta" | "ah_flip_state",
  keyColumn: "product_id" | "key",
  key: string,
): Promise<Response> {
  if (!(await secretMatches(request, env.INGEST_SECRET))) return errorResponse(env, "Unauthorized", 401);
  if (request.method === "GET") {
    const row = await env.DB.prepare(
      `SELECT updated_at, payload FROM ${table} WHERE ${keyColumn} = ?`,
    )
      .bind(key)
      .first<BlobRow>();
    return row ? compressedJsonResponse(env, row) : errorResponse(env, "Not found", 404);
  }
  if (request.method === "PUT") return putImportedJson(request, env, table, keyColumn, key);
  return errorResponse(env, "Method not allowed", 405);
}

async function latestSnapshot(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT updated_at, payload FROM market_state WHERE key = 'latest_snapshot'",
  ).first<StateRow>();
  if (!row) return errorResponse(env, "No market snapshot stored", 404);
  return new Response(row.payload, {
    headers: {
      ...corsHeaders(env),
      "Cache-Control": "public, max-age=15, stale-while-revalidate=45",
      "Content-Type": "application/json; charset=utf-8",
      "X-Updated-At": String(row.updated_at),
    },
  });
}

async function latestAhFlips(env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    "SELECT updated_at, payload FROM ah_flip_state WHERE key = 'latest'",
  ).first<BlobRow>();
  if (!row) return errorResponse(env, "No AH Flip snapshot stored", 404);
  const response = compressedJsonResponse(env, row);
  response.headers.set("Cache-Control", "public, max-age=5, stale-while-revalidate=30");
  return response;
}

async function liveProductHistory(env: Env, productId: string, range: string): Promise<Response> {
  const config = historyRangeConfig(range);
  const cutoff = Number.isFinite(config.duration) ? Date.now() - config.duration : 0;
  const cutoffBucket = Math.floor(cutoff / config.bucketMs);
  const partition = historyPartitionForProduct(productId);
  const rows = await env.DB.prepare(
    `SELECT updated_at, payload FROM market_history
     WHERE tier = ? AND partition = ? AND bucket >= ?
     ORDER BY bucket ASC`,
  )
    .bind(config.tier, partition, cutoffBucket)
    .all<HistoryRow>();

  const points: PricePoint[] = [];
  for (const row of rows.results) {
    const snapshot = JSON.parse(await gunzipText(row.payload)) as CompactHistoryPartition;
    const item = snapshot.items[productId];
    if (!item) continue;
    points.push({
      time: row.updated_at,
      price: item[0],
      buyOrderPrice: item[1],
      sellOrderPrice: item[2],
      volume: item[3],
      source: "hypixel",
    });
  }
  return new Response(JSON.stringify(points), {
    headers: {
      ...corsHeaders(env),
      "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function dailyHistory(env: Env): Promise<Response> {
  const cutoffBucket = Math.floor((Date.now() - 31 * DAY_MS) / DAY_MS);
  const rows = await env.DB.prepare(
    `SELECT payload FROM market_history
     WHERE tier = '1d' AND bucket >= ?
     ORDER BY bucket ASC, partition ASC`,
  )
    .bind(cutoffBucket)
    .all<{ payload: number[] }>();
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index === 0) controller.enqueue(encoder.encode("["));
      if (index < rows.results.length) {
        const payload = await gunzipText(rows.results[index]!.payload);
        controller.enqueue(encoder.encode(`${index === 0 ? "" : ","}${payload}`));
        index += 1;
        return;
      }
      controller.enqueue(encoder.encode("]"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders(env),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function historyAt24Hours(env: Env): Promise<Response> {
  const latest = await env.DB.prepare(
    "SELECT updated_at FROM market_state WHERE key = 'latest_compact'",
  ).first<{ updated_at: number }>();
  const referenceTime = latest?.updated_at ?? Date.now();
  const targetBucket = Math.floor((referenceTime - DAY_MS) / HOUR_MS);
  const nearest = await env.DB.prepare(
    `SELECT bucket, updated_at FROM market_history
     WHERE tier = '1h' AND bucket BETWEEN ? AND ?
     ORDER BY ABS(bucket - ?) ASC, partition ASC
     LIMIT 1`,
  )
    .bind(targetBucket - 2, targetBucket + 2, targetBucket)
    .first<HistoryBucketRow>();

  if (!nearest) {
    return new Response("[]", {
      headers: {
        ...corsHeaders(env),
        "Cache-Control": "public, max-age=60, stale-while-revalidate=120",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  }

  const rows = await env.DB.prepare(
    `SELECT payload FROM market_history
     WHERE tier = '1h' AND bucket = ?
     ORDER BY partition ASC`,
  )
    .bind(nearest.bucket)
    .all<{ payload: number[] }>();
  const encoder = new TextEncoder();
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (index === 0) controller.enqueue(encoder.encode("["));
      if (index < rows.results.length) {
        const payload = await gunzipText(rows.results[index]!.payload);
        controller.enqueue(encoder.encode(`${index === 0 ? "" : ","}${payload}`));
        index += 1;
        return;
      }
      controller.enqueue(encoder.encode("]"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      ...corsHeaders(env),
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
      "Content-Type": "application/json; charset=utf-8",
      "X-History-At": String(nearest.updated_at),
    },
  });
}

async function triggerIngestion(env: Env): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(env.VERCEL_INGEST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.INGEST_SECRET}` },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Vercel ingestion returned ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json(env, { status: "ok", storage: "d1-free" });
      }
      if (url.pathname === "/v1/storage/latest" && request.method === "GET") return latestSnapshot(env);
      if (url.pathname === "/v1/storage/ah-flips" && request.method === "GET") return latestAhFlips(env);
      if (url.pathname === "/v1/storage/history-daily" && request.method === "GET") return dailyHistory(env);
      if (url.pathname === "/v1/storage/history-24h" && request.method === "GET") return historyAt24Hours(env);

      const livePrefix = "/v1/storage/history-live/";
      if (url.pathname.startsWith(livePrefix) && request.method === "GET") {
        const productId = decodeURIComponent(url.pathname.slice(livePrefix.length));
        if (!/^[A-Z0-9_:.-]{1,128}$/.test(productId)) return errorResponse(env, "Invalid product ID", 400);
        return liveProductHistory(env, productId, url.searchParams.get("range") ?? "1d");
      }

      if (url.pathname === "/v1/internal/market-snapshot" && request.method === "POST") {
        if (!(await secretMatches(request, env.INGEST_SECRET))) return errorResponse(env, "Unauthorized", 401);
        let ingest: unknown;
        try {
          ingest = await readJsonLimited(request, MARKET_BODY_LIMIT);
        } catch (error) {
          return errorResponse(env, error instanceof Error ? error.message : "Invalid JSON", error instanceof RangeError ? 413 : 400);
        }
        if (!isMarketIngest(ingest)) return errorResponse(env, "Invalid market snapshot", 400);
        await persistMarketSnapshot(env, ingest);
        return json(env, { updatedAt: ingest.snapshot.updatedAt, stored: true });
      }

      if (url.pathname === "/v1/internal/ah-flips") {
        return importedJson(request, env, "ah_flip_state", "key", "latest");
      }

      const importedPrefix = "/v1/internal/history-import/";
      if (url.pathname.startsWith(importedPrefix)) {
        const productId = decodeURIComponent(url.pathname.slice(importedPrefix.length));
        if (!/^[A-Z0-9_:.-]{1,128}$/.test(productId)) return errorResponse(env, "Invalid product ID", 400);
        return importedJson(request, env, "imported_history", "product_id", productId);
      }

      const metaPrefix = "/v1/internal/history-import-meta/";
      if (url.pathname.startsWith(metaPrefix)) {
        const key = url.pathname.slice(metaPrefix.length);
        if (key !== "summary" && key !== "manifest") return errorResponse(env, "Invalid metadata key", 400);
        return importedJson(request, env, "imported_meta", "key", key);
      }

      const ahHistoryPrefix = "/v1/internal/ah-history-import/";
      if (url.pathname.startsWith(ahHistoryPrefix)) {
        const productId = decodeURIComponent(url.pathname.slice(ahHistoryPrefix.length));
        if (!/^[A-Z0-9_:.-]{1,128}$/.test(productId)) return errorResponse(env, "Invalid product ID", 400);
        return importedJson(request, env, "imported_ah_history", "product_id", productId);
      }

      const ahMetaPrefix = "/v1/internal/ah-history-import-meta/";
      if (url.pathname.startsWith(ahMetaPrefix)) {
        const key = url.pathname.slice(ahMetaPrefix.length);
        if (key !== "summary" && key !== "manifest") return errorResponse(env, "Invalid metadata key", 400);
        return importedJson(request, env, "imported_ah_meta", "key", key);
      }

      if (url.pathname === "/v1/me/bookmarks" || url.pathname.startsWith("/v1/me/bookmarks/")) {
        return bookmarks(request, env, url.pathname);
      }
      return errorResponse(env, "Not found", 404);
    } catch (error) {
      console.error("Worker request failed", { pathname: url.pathname, error });
      return errorResponse(env, "Internal server error", 500);
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(
      triggerIngestion(env).catch((error) => {
        console.error("Scheduled ingestion failed", error);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
