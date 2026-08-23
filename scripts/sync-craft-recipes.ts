import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { unzipSync } from "fflate";

const REPOSITORY = "NotEnoughUpdates/NotEnoughUpdates-REPO";
const GITHUB_API = `https://api.github.com/repos/${REPOSITORY}`;
const ITEMS_API = "https://api.hypixel.net/v2/resources/skyblock/items";
const OUTPUT_PATH = resolve("packages/core/data/craft-data.json");
const AH_UPGRADES_OUTPUT_PATH = resolve("packages/core/data/ah-upgrade-data.json");
const LICENSE_PATH = resolve("packages/core/data/NotEnoughUpdates-REPO-LICENSE.txt");
const SLOT_KEYS = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3"] as const;

type NeuRecipe = Record<string, unknown> & {
  type?: string;
  count?: number;
  overrideOutputId?: string;
  crafttext?: string;
};
type NeuItem = {
  internalname?: string;
  displayname?: string;
  lore?: string[];
  crafttext?: string;
  recipe?: NeuRecipe;
  recipes?: NeuRecipe[];
};
type Ingredient = { productId: string; name: string; amount: number };

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "Sky-Turbo/0.1 craft-recipe-sync" },
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return await response.json() as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "User-Agent": "Sky-Turbo/0.1 craft-recipe-sync" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function cleanName(value: string | undefined): string {
  return String(value ?? "").replace(/§[0-9a-fk-or]/gi, "").trim();
}

function fallbackName(productId: string): string {
  return productId.replace(/:\d+$/, "").split("_").map((part) =>
    part ? `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}` : part,
  ).join(" ");
}

function parseIngredient(value: unknown): { productId: string; amount: number } | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim();
  const match = normalized.match(/^(.*):(-?\d+(?:\.\d+)?)$/);
  const productId = (match?.[1] ?? normalized).trim();
  const amount = match ? Number(match[2]) : 1;
  if (!productId || !Number.isFinite(amount) || amount <= 0) return undefined;
  return { productId, amount };
}

async function main(): Promise<void> {
  const [repository, itemsPayload] = await Promise.all([
    fetchJson<{ default_branch: string }>(GITHUB_API),
    fetchJson<{ success?: boolean; items?: Array<{ id: string; name?: string }> }>(ITEMS_API),
  ]);
  if (!itemsPayload.success || !itemsPayload.items) throw new Error("Hypixel item resource response is invalid");
  const branch = repository.default_branch || "master";
  const commit = await fetchJson<{ sha: string }>(`${GITHUB_API}/commits/${encodeURIComponent(branch)}`);
  const archiveUrl = `https://github.com/${REPOSITORY}/archive/${commit.sha}.zip`;
  const archive = unzipSync(await fetchBytes(archiveUrl));
  const decoder = new TextDecoder();
  const itemEntries = Object.entries(archive).filter(([path]) => /\/items\/[^/]+\.json$/i.test(path));
  if (itemEntries.length === 0) throw new Error("NEU archive did not contain item JSON files");

  const neuItems: Array<{ sourceFile: string; item: NeuItem }> = [];
  for (const [path, bytes] of itemEntries) {
    try {
      neuItems.push({ sourceFile: path.split("/").at(-1)!, item: JSON.parse(decoder.decode(bytes)) as NeuItem });
    } catch (error) {
      console.warn(`Skipping invalid NEU JSON ${path}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const names = new Map(itemsPayload.items.map((item) => [item.id, cleanName(item.name)]));
  for (const { item } of neuItems) {
    if (item.internalname && !names.has(item.internalname)) names.set(item.internalname, cleanName(item.displayname));
  }

  const reforgeStones: Record<string, { productId: string; name: string }> = {};
  const dyes: Record<string, { productId: string; name: string }> = {};
  for (const { item } of neuItems) {
    if (!item.internalname) continue;
    const name = names.get(item.internalname) || cleanName(item.displayname) || fallbackName(item.internalname);
    if (item.internalname.startsWith("DYE_")) dyes[item.internalname] = { productId: item.internalname, name };
    for (const loreLine of item.lore ?? []) {
      const match = cleanName(loreLine).match(/Applies the\s+(.+?)\s+reforge when/i);
      if (!match?.[1]) continue;
      const modifier = match[1].trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      if (modifier && !reforgeStones[modifier]) reforgeStones[modifier] = { productId: item.internalname, name };
    }
  }

  const recipes = [];
  const warnings = new Set<string>();
  for (const { sourceFile, item } of neuItems) {
    if (!item.internalname) continue;
    const candidates = [
      ...(item.recipe && typeof item.recipe === "object" ? [item.recipe] : []),
      ...(Array.isArray(item.recipes) ? item.recipes : []),
    ];
    for (let recipeIndex = 0; recipeIndex < candidates.length; recipeIndex += 1) {
      const recipe = candidates[recipeIndex]!;
      if (recipe.type !== undefined && recipe.type !== "crafting") continue;
      const outputProductId = typeof recipe.overrideOutputId === "string" && recipe.overrideOutputId.trim()
        ? recipe.overrideOutputId.trim()
        : item.internalname;
      const outputAmount = Number(recipe.count ?? 1);
      if (!Number.isFinite(outputAmount) || outputAmount <= 0) continue;

      const grid = SLOT_KEYS.map((slot) => {
        const parsed = parseIngredient(recipe[slot]);
        return parsed ? { slot, ...parsed } : null;
      });
      const occupied = grid.filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      if (occupied.length === 0) continue;
      const aggregated = new Map<string, number>();
      for (const ingredient of occupied) {
        aggregated.set(ingredient.productId, (aggregated.get(ingredient.productId) ?? 0) + ingredient.amount);
        if (!names.get(ingredient.productId)) warnings.add(ingredient.productId);
      }
      const ingredients: Ingredient[] = [...aggregated.entries()].map(([productId, amount]) => ({
        productId,
        name: names.get(productId) || fallbackName(productId),
        amount,
      })).sort((left, right) => left.productId.localeCompare(right.productId));
      const fingerprint = JSON.stringify([outputProductId, outputAmount, ingredients.map(({ productId, amount }) => [productId, amount])]);
      const hash = createHash("sha1").update(`${sourceFile}\0${recipeIndex}\0${fingerprint}`).digest("hex").slice(0, 12);
      recipes.push({
        id: `${outputProductId}:${hash}`,
        type: "crafting" as const,
        output: {
          productId: outputProductId,
          name: names.get(outputProductId) || cleanName(item.displayname) || fallbackName(outputProductId),
          amount: outputAmount,
        },
        ingredients,
        ...(cleanName(recipe.crafttext ?? item.crafttext) ? { requirement: cleanName(recipe.crafttext ?? item.crafttext) } : {}),
        source: {
          label: "NotEnoughUpdates Recipe Repository",
          url: `https://github.com/${REPOSITORY}/blob/${commit.sha}/items/${encodeURIComponent(sourceFile)}`,
          file: sourceFile,
        },
      });
    }
  }

  const deduplicated = [...new Map(recipes.map((recipe) => [
    JSON.stringify([recipe.output, recipe.ingredients]),
    recipe,
  ])).values()].sort((left, right) =>
    left.output.name.localeCompare(right.output.name) || left.id.localeCompare(right.id),
  );
  const licenseEntry = Object.entries(archive).find(([path]) => /\/LICENSE$/i.test(path));
  if (!licenseEntry) throw new Error("NEU archive did not contain its MIT LICENSE");

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await Promise.all([
    writeFile(OUTPUT_PATH, `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: {
        project: REPOSITORY,
        commit: commit.sha,
        branch,
        archiveUrl,
        license: "MIT",
      },
      warnings: [...warnings].sort(),
      recipes: deduplicated,
    }, null, 2)}\n`),
    writeFile(AH_UPGRADES_OUTPUT_PATH, `${JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      source: {
        project: REPOSITORY,
        commit: commit.sha,
        branch,
        archiveUrl,
        license: "MIT",
      },
      reforgeStones,
      dyes,
    }, null, 2)}\n`),
    writeFile(LICENSE_PATH, licenseEntry[1]),
  ]);
  console.log(`Wrote ${deduplicated.length} crafting recipes from NEU commit ${commit.sha}.`);
  if (warnings.size) console.log(`${warnings.size} ingredient IDs were absent from current item metadata.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
