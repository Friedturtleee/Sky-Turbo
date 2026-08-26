import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// This release preserves Fusion input order. Older data mirrored every pair,
// which introduced invalid reverse recipes for order-sensitive fusions such as
// Queen Ant + King Cobra -> Anteater.
const SKYSHARDS_COMMIT = "c94fc53e26b54fea59902c5eafb580babaac36be";
const SOURCE = `https://raw.githubusercontent.com/Campionnn/SkyShards/${SKYSHARDS_COMMIT}/public/fusion-data.json`;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "packages/core/data/fusion-data.json");
const metadataOutput = resolve(root, "packages/core/data/fusion-source.json");

const response = await fetch(SOURCE, { signal: AbortSignal.timeout(30_000) });
if (!response.ok) throw new Error(`SkyShards download failed: ${response.status}`);

const data = await response.json();
if (!data?.recipes || !data?.shards || Object.keys(data.shards).length < 100) {
  throw new Error("SkyShards payload did not match the expected schema");
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(data)}\n`, "utf8");
await writeFile(
  metadataOutput,
  `${JSON.stringify(
    {
      project: "Campionnn/SkyShards",
      license: "MIT",
      commit: SKYSHARDS_COMMIT,
      source: SOURCE,
      shardCount: Object.keys(data.shards).length,
      syncedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
  "utf8",
);

console.log(`Synced ${Object.keys(data.shards).length} shards from ${SKYSHARDS_COMMIT}.`);
