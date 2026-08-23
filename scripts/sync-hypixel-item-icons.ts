import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { unzipSync } from "fflate";

const PACKS_URL = "https://api.hypixel.net/v2/resources/packs";
const ITEMS_URL = "https://api.hypixel.net/v2/resources/skyblock/items";
const BAZAAR_URL = "https://api.hypixel.net/v2/skyblock/bazaar";
const MOJANG_MANIFEST_URL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const SKYSHARDS_ARCHIVE_URL = "https://github.com/Campionnn/SkyShards/archive/refs/heads/master.zip";
const DEFAULT_PACK_FORMAT = 75;
const DEFAULT_MINECRAFT_VERSION = "1.21.5";
const PUBLIC_ROOT = resolve("apps/web/public");
const HYPIXEL_ROOT = resolve(PUBLIC_ROOT, "hypixel-skyblock-pack");
const MINECRAFT_ROOT = resolve(PUBLIC_ROOT, "minecraft-item-icons");
const HEADS_ROOT = resolve(PUBLIC_ROOT, "hypixel-item-heads");
const SKYSHARDS_ROOT = resolve(PUBLIC_ROOT, "skyshards");
const FUSION_DATA = resolve("packages/core/data/fusion-data.json");
const NPC_SHOP_DATA = resolve("packages/core/data/npc-shop-data.json");
const GENERATED_MAP = resolve("apps/web/lib/hypixel-item-textures.generated.ts");
const GENERIC_ICON = "/item-icons/fallback.svg";

type PackVersion = { packFormat: number; hash: string; url: string };
type PacksResponse = {
  success?: boolean;
  packs?: Array<{ id: string; lastUpdated: number; deployId: string; versions: PackVersion[] }>;
};
type ItemResource = {
  id?: string;
  item_model?: string;
  material?: string;
  durability?: number;
  skin?: { value?: string };
};
type ItemsResponse = { success?: boolean; lastUpdated?: number; items?: ItemResource[] };
type BazaarResponse = { success?: boolean; products?: Record<string, unknown> };
type Model = { parent?: string; textures?: Record<string, string> };
type MojangManifest = { versions?: Array<{ id: string; url: string }> };
type MojangVersion = { downloads?: { client?: { url: string; sha1: string; size: number } } };
type FusionData = { shards?: Record<string, { internal_id?: string }> };
type NpcShopData = {
  offers?: Array<{
    output?: { productId?: string };
    costs?: Array<{ kind?: string; productId?: string }>;
  }>;
};
type TextureMapValue = string | { src: string; kind: "skin" };
type TextureSource = "hypixelPack" | "skyShards" | "hypixelHead" | "minecraft" | "categoryFallback" | "genericFallback";

const LEGACY_MATERIAL_ALIASES: Readonly<Record<string, string>> = {
  CARROT_ITEM: "carrot", CARROT_STICK: "carrot_on_a_stick", COMMAND: "command_block",
  COOKED_FISH: "cooked_cod", DOUBLE_PLANT: "sunflower", ENDER_STONE: "end_stone",
  EXP_BOTTLE: "experience_bottle", EYE_OF_ENDER: "ender_eye", FIREWORK: "firework_rocket",
  GRILLED_PORK: "cooked_porkchop", HUGE_MUSHROOM_1: "brown_mushroom_block",
  HUGE_MUSHROOM_2: "red_mushroom_block", INK_SACK: "ink_sac", LOG: "oak_log",
  LOG_2: "acacia_log", MELON: "melon_slice", MELON_BLOCK: "melon", MYCEL: "mycelium",
  NETHER_BRICK_ITEM: "nether_brick", NETHER_STALK: "nether_wart", PORK: "porkchop",
  POTATO_ITEM: "potato", POTION: "glass_bottle", PRISMARINE_CRYSTALS: "prismarine_crystals",
  RAW_BEEF: "beef", RAW_CHICKEN: "chicken", RAW_FISH: "cod", RED_ROSE: "poppy",
  REDSTONE_LAMP_OFF: "redstone_lamp", SEEDS: "wheat_seeds", SNOW_BALL: "snowball",
  SPECKLED_MELON: "glistering_melon_slice", SUGAR_CANE: "sugar_cane", SULPHUR: "gunpowder",
  TRAP_DOOR: "oak_trapdoor", WATER_LILY: "lily_pad", WEB: "cobweb", WOOL: "white_wool",
  YELLOW_FLOWER: "dandelion",
};

const MATERIAL_VARIANTS: Readonly<Record<string, Readonly<Record<number, string>>>> = {
  COAL: { 1: "charcoal" },
  COOKED_FISH: { 1: "cooked_salmon" },
  DOUBLE_PLANT: { 0: "sunflower", 1: "lilac", 2: "tall_grass", 3: "large_fern", 4: "rose_bush", 5: "peony" },
  INK_SACK: {
    0: "ink_sac", 1: "red_dye", 2: "green_dye", 3: "cocoa_beans", 4: "lapis_lazuli",
    5: "purple_dye", 6: "cyan_dye", 7: "light_gray_dye", 8: "gray_dye", 9: "pink_dye",
    10: "lime_dye", 11: "yellow_dye", 12: "light_blue_dye", 13: "magenta_dye",
    14: "orange_dye", 15: "bone_meal",
  },
  LOG: { 0: "oak_log", 1: "spruce_log", 2: "birch_log", 3: "jungle_log" },
  LOG_2: { 0: "acacia_log", 1: "dark_oak_log" },
  QUARTZ_BLOCK: { 1: "chiseled_quartz_block" },
  RAW_FISH: { 0: "cod", 1: "salmon", 2: "tropical_fish", 3: "pufferfish" },
  RED_ROSE: { 0: "poppy", 1: "blue_orchid", 2: "allium", 3: "azure_bluet", 4: "red_tulip", 5: "orange_tulip", 6: "white_tulip", 7: "pink_tulip", 8: "oxeye_daisy" },
  SAND: { 1: "red_sand" },
  SPONGE: { 1: "wet_sponge" },
  WOOL: { 0: "white_wool", 1: "orange_wool", 2: "magenta_wool", 3: "light_blue_wool", 4: "yellow_wool", 5: "lime_wool", 6: "pink_wool", 7: "gray_wool", 8: "light_gray_wool", 9: "cyan_wool", 10: "purple_wool", 11: "blue_wool", 12: "brown_wool", 13: "green_wool", 14: "red_wool", 15: "black_wool" },
};

function argumentValue(name: string, fallback: string): string {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
}

function requestedPackFormat(): number {
  const parsed = Number(argumentValue("pack-format", String(DEFAULT_PACK_FORMAT)));
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error("--pack-format must be a positive integer");
  return parsed;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "Sky-Turbo/0.1 item-texture-sync" } });
  if (!response.ok) throw new Error(`Request failed (${response.status}) for ${url}`);
  return await response.json() as T;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { headers: { "User-Agent": "Sky-Turbo/0.1 item-texture-sync" } });
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${url}`);
  return new Uint8Array(await response.arrayBuffer());
}

function verifySha1(bytes: Uint8Array, expected: string, label: string): void {
  const actual = createHash("sha1").update(bytes).digest("hex");
  if (actual !== expected.toLowerCase()) throw new Error(`${label} SHA-1 mismatch: expected ${expected}, received ${actual}`);
}

function splitResourceLocation(value: string, fallbackNamespace = "minecraft"): [string, string] {
  const separator = value.indexOf(":");
  return separator === -1 ? [fallbackNamespace, value] : [value.slice(0, separator), value.slice(separator + 1)];
}

function entry(entries: Record<string, Uint8Array>, path: string): Uint8Array | undefined {
  return entries[path.replaceAll("\\", "/")];
}

function entryEndingWith(entries: Record<string, Uint8Array>, suffix: string): Uint8Array | undefined {
  const normalized = suffix.replaceAll("\\", "/");
  const key = Object.keys(entries).find((candidate) => candidate.endsWith(normalized));
  return key ? entries[key] : undefined;
}

function readJsonEntry<T>(entries: Record<string, Uint8Array>, path: string): T | undefined {
  const bytes = entry(entries, path);
  return bytes ? JSON.parse(new TextDecoder().decode(bytes)) as T : undefined;
}

function resolveModelTextures(entries: Record<string, Uint8Array>, modelReference: string, seen = new Set<string>()): Record<string, string> | undefined {
  if (seen.has(modelReference)) return undefined;
  seen.add(modelReference);
  const [namespace, modelPath] = splitResourceLocation(modelReference);
  const model = readJsonEntry<Model>(entries, `assets/${namespace}/models/${modelPath}.json`);
  if (!model) return undefined;
  const parentTextures = model.parent ? resolveModelTextures(entries, model.parent, seen) : undefined;
  return { ...parentTextures, ...model.textures };
}

function firstItemModelReference(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = firstItemModelReference(child);
      if (found) return found;
    }
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.model === "string" && typeof record.type === "string" && record.type.endsWith(":model")) return record.model;
  if (typeof record.base === "string") return record.base;
  for (const child of Object.values(record)) {
    const found = firstItemModelReference(child);
    if (found) return found;
  }
  return undefined;
}

function primaryTexture(textures: Record<string, string> | undefined): string | undefined {
  if (!textures) return undefined;
  let candidate = textures.layer0 ?? textures.particle ?? Object.values(textures)[0];
  const visited = new Set<string>();
  while (candidate?.startsWith("#")) {
    const key = candidate.slice(1);
    if (visited.has(key)) return undefined;
    visited.add(key);
    candidate = textures[key];
  }
  return candidate;
}

function resolvedTextureReference(entries: Record<string, Uint8Array>, reference: string): string | undefined {
  const direct = primaryTexture(resolveModelTextures(entries, reference));
  if (direct) return direct;
  const [namespace, itemPath] = splitResourceLocation(reference);
  const definition = readJsonEntry<{ model?: unknown }>(entries, `assets/${namespace}/items/${itemPath}.json`);
  const modelReference = firstItemModelReference(definition?.model);
  if (modelReference) {
    const fromDefinition = primaryTexture(resolveModelTextures(entries, modelReference));
    if (fromDefinition) return fromDefinition;
  }
  return primaryTexture(resolveModelTextures(entries, `${namespace}:item/${itemPath}`));
}

function assertSafeOutputPath(path: string): void {
  const relativePath = relative(PUBLIC_ROOT, path);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === "..") throw new Error(`Refusing to replace unsafe output directory: ${path}`);
}

async function prepareOutputDirectory(path: string): Promise<void> {
  assertSafeOutputPath(path);
  await rm(path, { recursive: true, force: true });
  await mkdir(path, { recursive: true });
}

async function emitResolvedTexture(entries: Record<string, Uint8Array>, reference: string, outputRoot: string, publicPrefix: string, copied: Set<string>): Promise<string | undefined> {
  const textureReference = resolvedTextureReference(entries, reference);
  if (!textureReference) return undefined;
  const [namespace, texturePath] = splitResourceLocation(textureReference);
  const texture = entry(entries, `assets/${namespace}/textures/${texturePath}.png`);
  if (!texture) return undefined;
  const outputRelative = `${namespace}/${texturePath}.png`;
  const outputPath = resolve(outputRoot, outputRelative);
  if (!outputPath.startsWith(`${outputRoot}${sep}`)) throw new Error(`Unsafe texture path: ${textureReference}`);
  if (!copied.has(outputRelative)) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, texture);
    copied.add(outputRelative);
  }
  return `${publicPrefix}/${outputRelative.replaceAll("\\", "/")}`;
}

function minecraftItemId(item: ItemResource): string | undefined {
  if (!item.material) return undefined;
  const variant = item.durability === undefined ? undefined : MATERIAL_VARIANTS[item.material]?.[item.durability];
  return variant ?? LEGACY_MATERIAL_ALIASES[item.material] ?? item.material.toLowerCase();
}

function decodeSkinUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(value, "base64").toString("utf8")) as { textures?: { SKIN?: { url?: string } } };
    if (!payload.textures?.SKIN?.url) return undefined;
    const url = new URL(payload.textures.SKIN.url);
    if (url.hostname !== "textures.minecraft.net") return undefined;
    url.protocol = "https:";
    return url.toString();
  } catch {
    return undefined;
  }
}

async function mapWithConcurrency<T>(values: T[], concurrency: number, action: (value: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      await action(values[index]!);
    }
  }));
}

async function main(): Promise<void> {
  const desiredFormat = requestedPackFormat();
  const minecraftVersion = argumentValue("minecraft-version", DEFAULT_MINECRAFT_VERSION);
  const [packsPayload, itemsPayload, bazaarPayload, mojangManifest, skyShardsArchive, fusionSource, npcShopSource] = await Promise.all([
    fetchJson<PacksResponse>(PACKS_URL), fetchJson<ItemsResponse>(ITEMS_URL), fetchJson<BazaarResponse>(BAZAAR_URL),
    fetchJson<MojangManifest>(MOJANG_MANIFEST_URL), fetchBytes(SKYSHARDS_ARCHIVE_URL), readFile(FUSION_DATA, "utf8"), readFile(NPC_SHOP_DATA, "utf8"),
  ]);
  if (!packsPayload.success || !packsPayload.packs) throw new Error("Hypixel packs response is invalid");
  if (!itemsPayload.success || !itemsPayload.items) throw new Error("Hypixel items response is invalid");
  if (!bazaarPayload.success || !bazaarPayload.products) throw new Error("Hypixel Bazaar response is invalid");

  const pack = packsPayload.packs.find((candidate) => candidate.id === "SkyBlock");
  if (!pack) throw new Error("Hypixel did not return the SkyBlock resource pack");
  const selected = pack.versions.find((version) => version.packFormat === desiredFormat)
    ?? [...pack.versions].sort((left, right) => left.packFormat - right.packFormat)[0];
  if (!selected) throw new Error("SkyBlock resource pack has no downloadable versions");
  const version = mojangManifest.versions?.find((candidate) => candidate.id === minecraftVersion);
  if (!version) throw new Error(`Minecraft ${minecraftVersion} is absent from Mojang's version manifest`);
  const client = (await fetchJson<MojangVersion>(version.url)).downloads?.client;
  if (!client) throw new Error(`Minecraft ${minecraftVersion} has no client download`);

  console.log(`Downloading SkyBlock pack ${pack.deployId}, Minecraft ${minecraftVersion}, and SkyShards icons...`);
  const [hypixelArchive, minecraftArchive] = await Promise.all([fetchBytes(selected.url), fetchBytes(client.url)]);
  verifySha1(hypixelArchive, selected.hash, "SkyBlock resource pack");
  verifySha1(minecraftArchive, client.sha1, `Minecraft ${minecraftVersion} client`);
  const hypixelEntries = unzipSync(hypixelArchive);
  const minecraftEntries = unzipSync(minecraftArchive, { filter: (file) => file.name.startsWith("assets/minecraft/items/") || file.name.startsWith("assets/minecraft/models/") || file.name.startsWith("assets/minecraft/textures/") });
  const skyShardsEntries = unzipSync(skyShardsArchive);
  const fusionData = JSON.parse(fusionSource) as FusionData;
  const npcShopData = JSON.parse(npcShopSource) as NpcShopData;
  await Promise.all([HYPIXEL_ROOT, MINECRAFT_ROOT, HEADS_ROOT, SKYSHARDS_ROOT].map(prepareOutputDirectory));

  const mapping: Record<string, TextureMapValue> = {};
  const sources: Record<string, TextureSource> = {};
  const sourceCounts: Record<TextureSource, number> = { hypixelPack: 0, skyShards: 0, hypixelHead: 0, minecraft: 0, categoryFallback: 0, genericFallback: 0 };
  const assign = (productId: string, value: TextureMapValue, source: TextureSource): void => {
    if (mapping[productId]) return;
    mapping[productId] = value;
    sources[productId] = source;
    sourceCounts[source] += 1;
  };
  const bazaarProductIds = new Set(Object.keys(bazaarPayload.products));
  const targetProductIds = new Set(bazaarProductIds);
  for (const offer of npcShopData.offers ?? []) {
    if (offer.output?.productId) targetProductIds.add(offer.output.productId);
    for (const cost of offer.costs ?? []) {
      if (cost.kind === "item" && cost.productId) targetProductIds.add(cost.productId);
    }
  }
  const targetItems = itemsPayload.items.filter((item) => item.id && targetProductIds.has(item.id));
  const hypixelCopied = new Set<string>();
  const minecraftCopied = new Set<string>();
  let unresolvedPackModels = 0;

  for (const item of targetItems) {
    if (!item.id || !item.item_model) continue;
    const texture = await emitResolvedTexture(hypixelEntries, item.item_model, HYPIXEL_ROOT, "/hypixel-skyblock-pack", hypixelCopied);
    if (texture) assign(item.id, texture, "hypixelPack");
    else unresolvedPackModels += 1;
  }

  const skinProducts = new Map<string, string[]>();
  for (const item of targetItems) {
    if (!item.id || mapping[item.id]) continue;
    const skinUrl = decodeSkinUrl(item.skin?.value);
    if (skinUrl) skinProducts.set(skinUrl, [...(skinProducts.get(skinUrl) ?? []), item.id]);
  }
  let failedHeads = 0;
  let copiedHeads = 0;
  await mapWithConcurrency([...skinProducts.entries()], 12, async ([skinUrl, productIds]) => {
    try {
      const bytes = await fetchBytes(skinUrl);
      const fileName = `${createHash("sha1").update(skinUrl).digest("hex")}.png`;
      await writeFile(resolve(HEADS_ROOT, fileName), bytes);
      copiedHeads += 1;
      for (const productId of productIds) assign(productId, { src: `/hypixel-item-heads/${fileName}`, kind: "skin" }, "hypixelHead");
    } catch (error) {
      failedHeads += productIds.length;
      console.warn(`Head download failed for ${productIds.join(", ")}: ${error instanceof Error ? error.message : error}`);
    }
  });

  for (const item of targetItems) {
    if (!item.id || mapping[item.id]) continue;
    let texture = item.item_model
      ? await emitResolvedTexture(minecraftEntries, item.item_model, MINECRAFT_ROOT, "/minecraft-item-icons", minecraftCopied)
      : undefined;
    const materialId = minecraftItemId(item);
    if (!texture && materialId) texture = await emitResolvedTexture(minecraftEntries, `minecraft:${materialId}`, MINECRAFT_ROOT, "/minecraft-item-icons", minecraftCopied);
    if (texture) assign(item.id, texture, "minecraft");
  }

  let copiedShardIcons = 0;
  for (const [code, shard] of Object.entries(fusionData.shards ?? {})) {
    if (!shard.internal_id || !targetProductIds.has(shard.internal_id) || mapping[shard.internal_id]) continue;
    const icon = entryEndingWith(skyShardsEntries, `/public/shardIcons/${code}.png`);
    if (!icon) continue;
    await writeFile(resolve(SKYSHARDS_ROOT, `${code}.png`), icon);
    assign(shard.internal_id, `/skyshards/${code}.png`, "skyShards");
    copiedShardIcons += 1;
  }

  const categoryIcons = {
    enchantment: await emitResolvedTexture(minecraftEntries, "minecraft:enchanted_book", MINECRAFT_ROOT, "/minecraft-item-icons", minecraftCopied),
    essence: await emitResolvedTexture(minecraftEntries, "minecraft:amethyst_shard", MINECRAFT_ROOT, "/minecraft-item-icons", minecraftCopied),
    cookie: await emitResolvedTexture(minecraftEntries, "minecraft:cookie", MINECRAFT_ROOT, "/minecraft-item-icons", minecraftCopied),
    hollow: await emitResolvedTexture(minecraftEntries, "minecraft:carved_pumpkin", MINECRAFT_ROOT, "/minecraft-item-icons", minecraftCopied),
  };
  for (const productId of targetProductIds) {
    if (mapping[productId]) continue;
    const categoryTexture = productId.startsWith("ENCHANTMENT_") ? categoryIcons.enchantment
      : productId.startsWith("ESSENCE_") ? categoryIcons.essence
        : productId === "BAZAAR_COOKIE" ? categoryIcons.cookie
          : productId === "SLEEPY_HOLLOW" ? categoryIcons.hollow : undefined;
    if (categoryTexture) assign(productId, categoryTexture, "categoryFallback");
    else assign(productId, GENERIC_ICON, "genericFallback");
  }

  const hypixelLicense = entry(hypixelEntries, "LICENSE");
  if (!hypixelLicense) throw new Error("The resource pack did not include its LICENSE file");
  await writeFile(resolve(HYPIXEL_ROOT, "LICENSE.txt"), hypixelLicense);
  const skyShardsLicense = entryEndingWith(skyShardsEntries, "/LICENSE");
  if (!skyShardsLicense) throw new Error("SkyShards archive did not include its LICENSE file");
  await writeFile(resolve(SKYSHARDS_ROOT, "LICENSE.txt"), skyShardsLicense);
  const genericFallbackProducts = Object.entries(sources).filter(([, source]) => source === "genericFallback").map(([productId]) => productId).sort();
  await writeFile(resolve(HYPIXEL_ROOT, "metadata.json"), `${JSON.stringify({
    sources: {
      hypixel: PACKS_URL,
      minecraft: { manifest: MOJANG_MANIFEST_URL, version: minecraftVersion, clientSha1: client.sha1 },
      skyShards: { archive: SKYSHARDS_ARCHIVE_URL, sha1: createHash("sha1").update(skyShardsArchive).digest("hex") },
      playerHeads: ITEMS_URL,
    },
    packId: pack.id, deployId: pack.deployId, packFormat: selected.packFormat, sha1: selected.hash,
    lastUpdated: pack.lastUpdated, itemsLastUpdated: itemsPayload.lastUpdated,
    bazaarProducts: bazaarProductIds.size, targetProducts: targetProductIds.size, mappedItems: Object.keys(mapping).length, sourceCounts,
    copiedTextures: { hypixel: hypixelCopied.size, minecraft: minecraftCopied.size, skyShards: copiedShardIcons, playerHeads: copiedHeads },
    unresolvedPackModels, failedHeads, genericFallbackProducts,
  }, null, 2)}\n`);

  const orderedMapping = Object.fromEntries(Object.entries(mapping).sort(([left], [right]) => left.localeCompare(right)));
  await mkdir(dirname(GENERATED_MAP), { recursive: true });
  await writeFile(GENERATED_MAP,
    `// Generated by pnpm sync:item-icons. Do not edit manually.\n` +
    `export type HypixelItemTexture = string | Readonly<{ src: string; kind: "skin" }>;\n` +
    `export const HYPIXEL_ITEM_TEXTURES: Readonly<Record<string, HypixelItemTexture>> = ${JSON.stringify(orderedMapping, null, 2)};\n`,
  );
  console.log(`Mapped ${Object.keys(mapping).length}/${targetProductIds.size} Bazaar + NPC products.`);
  console.log(`Sources: ${Object.entries(sourceCounts).map(([source, count]) => `${source}=${count}`).join(", ")}`);
  if (genericFallbackProducts.length) console.log(`Generic fallback: ${genericFallbackProducts.join(", ")}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
