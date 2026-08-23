import { gzipSync } from "node:zlib";
import { parse, simplify, writeUncompressed, type NBT } from "prismarine-nbt";
import upgradeDataJson from "../data/ah-upgrade-data.json";
import { calculateAhFlip } from "./ah-flips";
import type {
  AhFeatureCategory,
  AhFlipSnapshot,
  AhHistoryStats,
  AhHistorySummary,
  AhItemFeature,
  AhNbtEstimate,
  AhValuationInput,
  HypixelBazaarResponse,
} from "./types";

const AUCTIONS_URL = "https://api.hypixel.net/v2/skyblock/auctions";
const BAZAAR_URL = "https://api.hypixel.net/v2/skyblock/bazaar";
const COFL_ROUGH_URL = "https://sky.coflnet.com/api/prices/neu";
const COFL_NBT_URL = "https://sky.coflnet.com/api/price/nbt";
const DEFAULT_CANDIDATE_LIMIT = 700;
const DEFAULT_RESULT_LIMIT = 1_000;
const NBT_BATCH_SIZE = 40;
const NBT_REQUEST_INTERVAL_MS = 750;

type UnknownRecord = Record<string, unknown>;
type ReforgeData = { productId: string; name: string };
type UpgradeData = {
  reforgeStones: Record<string, ReforgeData>;
  dyes: Record<string, ReforgeData>;
};

const upgradeData = upgradeDataJson as UpgradeData;

export type HypixelAuction = {
  uuid: string;
  start: number;
  end: number;
  item_name: string;
  category: string;
  tier: string;
  starting_bid: number;
  item_bytes: string;
  bin?: boolean;
  claimed?: boolean;
};

type HypixelAuctionPage = {
  success: boolean;
  page: number;
  totalPages: number;
  totalAuctions: number;
  lastUpdated: number;
  auctions: HypixelAuction[];
};

type ParsedAuction = {
  auction: HypixelAuction;
  productId: string;
  quantity: number;
  extraAttributes: UnknownRecord;
};

type PricedAuction = ParsedAuction & {
  features: AhItemFeature[];
  unknownAttributeKeys: string[];
  componentEstimate: number;
  preliminaryProfit: number;
  history?: AhHistoryStats;
};

export type AhScanOptions = {
  history?: AhHistorySummary | null;
  maxPages?: number;
  candidateLimit?: number;
  resultLimit?: number;
  coflContact?: string;
  coflToken?: string;
  skipExactNbt?: boolean;
};

const ignoredExtraKeys = new Set([
  "id", "uuid", "timestamp", "originTag", "bossId", "spawnedFor", "dungeon_skill_req",
  "hideInfo", "hideRightClick", "noMove", "petSoulbound", "active",
]);

const scalarFeatureDefinitions: Record<string, {
  label: string;
  category: AhFeatureCategory;
  productId?: string;
  multiplier?: (value: number) => number;
}> = {
  art_of_war_count: { label: "The Art of War", category: "modifier", productId: "THE_ART_OF_WAR" },
  artOfWar: { label: "The Art of War", category: "modifier", productId: "THE_ART_OF_WAR" },
  art_of_peace_count: { label: "The Art of Peace", category: "modifier", productId: "THE_ART_OF_PEACE" },
  farming_for_dummies_count: { label: "Farming for Dummies", category: "modifier", productId: "FARMING_FOR_DUMMIES" },
  mana_disintegrator_count: { label: "Mana Disintegrator", category: "modifier", productId: "MANA_DISINTEGRATOR" },
  wood_singularity_count: { label: "Wood Singularity", category: "modifier", productId: "WOOD_SINGULARITY" },
  book_of_stats: { label: "Book of Stats", category: "counter", productId: "BOOK_OF_STATS" },
  bookworm_books: { label: "Bookworm's Favorite Book", category: "modifier", productId: "BOOKWORMS_FAVORITE_BOOK" },
  tuned_transmission: { label: "Transmission Tuner", category: "modifier", productId: "TRANSMISSION_TUNER" },
  ethermerge: { label: "Etherwarp Merger", category: "modifier", productId: "ETHERWARP_MERGER" },
  powder_coating: { label: "Divan's Powder Coating", category: "modifier", productId: "DIVANS_POWDER_COATING" },
  polarvoid: { label: "Polarvoid Book", category: "modifier", productId: "POLARVOID_BOOK" },
};

const recognizedCounters = new Map<string, string>([
  ["compact_blocks", "Compact blocks"],
  ["cultivating", "Cultivating crops"],
  ["expertise_kills", "Expertise kills"],
  ["champion_combat_xp", "Champion combat XP"],
  ["toxophilite_combat_xp", "Toxophilite combat XP"],
  ["eman_kills", "Enderman kills"],
  ["zombie_kills", "Zombie kills"],
  ["drill_fuel", "Drill fuel"],
  ["bottle_of_jyrre_seconds", "Bottle of Jyrre seconds"],
  ["ammo", "Ammo"],
]);

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function humanize(value: string): string {
  return value.split("_").filter(Boolean).map((part) =>
    `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`,
  ).join(" ");
}

function compactValue(value: unknown): string {
  if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 177)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 180 ? `${serialized.slice(0, 177)}…` : serialized;
  } catch {
    return String(value);
  }
}

async function fetchJson<T>(url: string, timeoutMs = 30_000, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      "User-Agent": "Sky-Turbo/0.1 ah-flip",
      ...init?.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return await response.json() as T;
}

async function fetchAuctionPage(page: number): Promise<HypixelAuctionPage> {
  const payload = await fetchJson<HypixelAuctionPage>(`${AUCTIONS_URL}?page=${page}`, 45_000);
  if (!payload.success || !Array.isArray(payload.auctions)) throw new Error(`Hypixel auction page ${page} was invalid`);
  return payload;
}

async function fetchAuctionSnapshot(maxPages?: number): Promise<{
  pages: HypixelAuctionPage[];
  partial: boolean;
}> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const first = await fetchAuctionPage(0);
    const pageCount = Math.max(1, Math.min(first.totalPages, maxPages ?? first.totalPages));
    const pages: HypixelAuctionPage[] = [first];
    let cursor = 1;
    const worker = async () => {
      while (cursor < pageCount) {
        const page = cursor++;
        const payload = await fetchAuctionPage(page);
        if (payload.lastUpdated !== first.lastUpdated || payload.totalPages !== first.totalPages) {
          throw new Error("Hypixel auction snapshot changed while pages were being fetched");
        }
        pages[page] = payload;
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(8, Math.max(0, pageCount - 1)) }, worker));
      const verification = await fetchAuctionPage(0);
      if (verification.lastUpdated !== first.lastUpdated || verification.totalPages !== first.totalPages) {
        throw new Error("Hypixel auction snapshot changed before verification");
      }
      return { pages, partial: pageCount < first.totalPages };
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error("Unable to fetch a consistent Hypixel auction snapshot");
}

function simplifiedStack(value: unknown): UnknownRecord | undefined {
  if (!isRecord(value)) return undefined;
  const list = value.i;
  return Array.isArray(list) && isRecord(list[0]) ? list[0] : undefined;
}

function deriveProductId(extra: UnknownRecord): string | undefined {
  const original = stringValue(extra.id);
  if (original === "PET") {
    const pet = stringValue(extra.petInfo);
    if (pet) {
      try {
        const parsed: unknown = JSON.parse(pet);
        if (isRecord(parsed) && stringValue(parsed.type)) return `PET_${stringValue(parsed.type)}`;
      } catch {
        return original;
      }
    }
  }
  if (original === "ENCHANTED_BOOK" && isRecord(extra.enchantments)) {
    const entries = Object.entries(extra.enchantments);
    if (entries.length === 1) {
      const [enchantment, level] = entries[0]!;
      const numericLevel = finiteNumber(level);
      if (numericLevel !== undefined) return `ENCHANTMENT_${enchantment.toUpperCase()}_${numericLevel}`;
    }
  }
  return original;
}

async function parseAuction(auction: HypixelAuction): Promise<ParsedAuction | null> {
  if (!auction.bin || auction.claimed || auction.end <= Date.now() || auction.starting_bid <= 0 || !auction.item_bytes) return null;
  try {
    const { parsed } = await parse(Buffer.from(auction.item_bytes, "base64"), "big");
    const simplified: unknown = simplify(parsed);
    const stack = simplifiedStack(simplified);
    const tag = stack && isRecord(stack.tag) ? stack.tag : undefined;
    const extra = tag && isRecord(tag.ExtraAttributes) ? tag.ExtraAttributes : undefined;
    const productId = extra ? deriveProductId(extra) : undefined;
    if (!extra || !productId) return null;
    const quantity = Math.max(1, Math.floor(finiteNumber(stack?.Count) ?? 1));
    return { auction, productId, quantity, extraAttributes: extra };
  } catch {
    return null;
  }
}

function retentionFor(category: AhFeatureCategory): number {
  if (category === "gemstone" || category === "dye" || category === "skin") return 0.78;
  if (category === "enchantment") return 0.58;
  if (category === "reforge" || category === "stars" || category === "rarity") return 0.62;
  return 0.55;
}

function addPricedFeature(
  features: AhItemFeature[],
  priceMap: ReadonlyMap<string, number>,
  feature: AhItemFeature,
  quantity = 1,
): void {
  const price = feature.marketProductId ? priceMap.get(feature.marketProductId) : undefined;
  if (price !== undefined && Number.isFinite(price) && price > 0) {
    const replacementCost = price * Math.max(1, quantity);
    features.push({
      ...feature,
      replacementCost,
      estimatedContribution: replacementCost * retentionFor(feature.category),
    });
    return;
  }
  features.push(feature);
}

function extractFeatures(extra: UnknownRecord, priceMap: ReadonlyMap<string, number>, itemName: string): {
  features: AhItemFeature[];
  unknownAttributeKeys: string[];
} {
  const features: AhItemFeature[] = [];
  const handled = new Set<string>(ignoredExtraKeys);

  const modifier = stringValue(extra.modifier);
  if (modifier) {
    handled.add("modifier");
    const stone = upgradeData.reforgeStones[modifier.toLowerCase()];
    addPricedFeature(features, priceMap, {
      key: "modifier",
      label: `${humanize(modifier)} Reforge`,
      value: stone?.name ?? humanize(modifier),
      category: "reforge",
      recognized: true,
      ...(stone ? { marketProductId: stone.productId } : {}),
    });
  }

  const rarityUpgrades = finiteNumber(extra.rarity_upgrades);
  if (rarityUpgrades && rarityUpgrades > 0) {
    handled.add("rarity_upgrades");
    addPricedFeature(features, priceMap, {
      key: "rarity_upgrades",
      label: "Recombobulator 3000",
      value: `×${rarityUpgrades}`,
      category: "rarity",
      recognized: true,
      marketProductId: "RECOMBOBULATOR_3000",
    }, rarityUpgrades);
  }

  const potatoBooks = Math.max(0, Math.floor(finiteNumber(extra.hot_potato_count) ?? 0));
  if (potatoBooks > 0) {
    handled.add("hot_potato_count");
    const hot = Math.min(10, potatoBooks);
    const fuming = Math.max(0, potatoBooks - 10);
    if (hot > 0) addPricedFeature(features, priceMap, {
      key: "hot_potato_count",
      label: "Hot Potato Book",
      value: `×${hot}`,
      category: "potato-book",
      recognized: true,
      marketProductId: "HOT_POTATO_BOOK",
    }, hot);
    if (fuming > 0) addPricedFeature(features, priceMap, {
      key: "fuming_potato_count",
      label: "Fuming Potato Book",
      value: `×${fuming}`,
      category: "potato-book",
      recognized: true,
      marketProductId: "FUMING_POTATO_BOOK",
    }, fuming);
  }

  if (isRecord(extra.enchantments)) {
    handled.add("enchantments");
    for (const [enchantment, rawLevel] of Object.entries(extra.enchantments)) {
      const level = Math.max(1, Math.floor(finiteNumber(rawLevel) ?? 1));
      addPricedFeature(features, priceMap, {
        key: `enchantment:${enchantment}`,
        label: humanize(enchantment),
        value: `Lv ${level}`,
        category: "enchantment",
        recognized: true,
        marketProductId: `ENCHANTMENT_${enchantment.toUpperCase()}_${level}`,
      });
    }
  }

  if (isRecord(extra.gems)) {
    handled.add("gems");
    const unlocked = Array.isArray(extra.gems.unlocked_slots) ? extra.gems.unlocked_slots.map(String) : [];
    if (unlocked.length > 0) features.push({
      key: "gems:unlocked_slots",
      label: "Unlocked Gemstone Slots",
      value: unlocked.join(", "),
      category: "gemstone",
      recognized: true,
    });
    for (const [slot, rawQuality] of Object.entries(extra.gems)) {
      if (slot === "unlocked_slots" || slot.endsWith("_gem")) continue;
      const quality = stringValue(rawQuality)?.toUpperCase();
      const gemstone = slot.match(/^([A-Z]+)(?:_\d+)?$/i)?.[1]?.toUpperCase();
      if (!quality || !gemstone) continue;
      addPricedFeature(features, priceMap, {
        key: `gem:${slot}`,
        label: `${humanize(quality)} ${humanize(gemstone)} Gemstone`,
        value: slot,
        category: "gemstone",
        recognized: true,
        marketProductId: `${quality}_${gemstone}_GEM`,
      });
    }
  }

  const dye = stringValue(extra.dye_item);
  if (dye) {
    handled.add("dye_item");
    const dyeData = upgradeData.dyes[dye];
    addPricedFeature(features, priceMap, {
      key: "dye_item",
      label: dyeData?.name ?? humanize(dye),
      value: dye,
      category: "dye",
      recognized: true,
      marketProductId: dye,
    });
  } else if (stringValue(extra.color)) {
    handled.add("color");
    features.push({
      key: "legacy_color",
      label: "Armor Color / possible Exotic",
      value: stringValue(extra.color)!,
      category: "dye",
      recognized: false,
    });
  }

  const skin = stringValue(extra.skin);
  if (skin) {
    handled.add("skin");
    addPricedFeature(features, priceMap, {
      key: "skin",
      label: "Item Skin",
      value: skin,
      category: "skin",
      recognized: true,
      marketProductId: skin,
    });
  }

  if (isRecord(extra.runes)) {
    handled.add("runes");
    for (const [rune, level] of Object.entries(extra.runes)) features.push({
      key: `rune:${rune}`,
      label: `${humanize(rune)} Rune`,
      value: `Lv ${finiteNumber(level) ?? compactValue(level)}`,
      category: "skin",
      recognized: true,
    });
  }

  const upgradeLevel = Math.max(0, Math.floor(finiteNumber(extra.upgrade_level ?? extra.dungeon_item_level) ?? 0));
  if (upgradeLevel > 0) {
    handled.add("upgrade_level");
    handled.add("dungeon_item_level");
    features.push({
      key: "upgrade_level",
      label: "Item Stars",
      value: `${upgradeLevel} star`,
      category: "stars",
      recognized: true,
    });
    const masterStars = ["FIRST_MASTER_STAR", "SECOND_MASTER_STAR", "THIRD_MASTER_STAR", "FOURTH_MASTER_STAR", "FIFTH_MASTER_STAR"];
    for (let index = 0; index < Math.min(5, Math.max(0, upgradeLevel - 5)); index += 1) {
      addPricedFeature(features, priceMap, {
        key: `master_star:${index + 1}`,
        label: `${index + 1} Master Star`,
        value: masterStars[index]!,
        category: "stars",
        recognized: true,
        marketProductId: masterStars[index]!,
      });
    }
  }
  if (extra.dungeon_item !== undefined) {
    handled.add("dungeon_item");
    features.push({ key: "dungeon_item", label: "Dungeonized", value: "Yes", category: "stars", recognized: true });
  }

  const petInfo = stringValue(extra.petInfo);
  if (petInfo) {
    handled.add("petInfo");
    try {
      const parsed: unknown = JSON.parse(petInfo);
      if (isRecord(parsed)) {
        const type = stringValue(parsed.type) ?? "Unknown Pet";
        const tier = stringValue(parsed.tier) ?? "Unknown";
        const level = itemName.match(/\[Lvl\s+(\d+)]/i)?.[1];
        features.push({
          key: "petInfo",
          label: `${humanize(type)} Pet`,
          value: `${tier}${level ? ` · Lv ${level}` : ""}`,
          category: "pet",
          recognized: true,
        });
        const heldItem = stringValue(parsed.heldItem);
        if (heldItem) addPricedFeature(features, priceMap, {
          key: "pet:held_item",
          label: "Pet Item",
          value: heldItem,
          category: "pet",
          recognized: true,
          marketProductId: heldItem,
        });
        const petSkin = stringValue(parsed.skin);
        if (petSkin) addPricedFeature(features, priceMap, {
          key: "pet:skin",
          label: "Pet Skin",
          value: petSkin,
          category: "skin",
          recognized: true,
          marketProductId: petSkin,
        });
        const candyUsed = finiteNumber(parsed.candyUsed);
        if (candyUsed && candyUsed > 0) features.push({
          key: "pet:candy",
          label: "Pet Candy Used",
          value: String(candyUsed),
          category: "pet",
          recognized: true,
        });
      }
    } catch {
      features.push({ key: "petInfo", label: "Pet metadata", value: "Invalid JSON", category: "pet", recognized: false });
    }
  }

  if (isRecord(extra.attributes)) {
    handled.add("attributes");
    for (const [attribute, level] of Object.entries(extra.attributes)) features.push({
      key: `attribute:${attribute}`,
      label: humanize(attribute),
      value: `Lv ${finiteNumber(level) ?? compactValue(level)}`,
      category: "attribute",
      recognized: true,
    });
  }

  const abilityScrolls = Array.isArray(extra.ability_scroll) ? extra.ability_scroll.map(String) : [];
  if (abilityScrolls.length > 0) {
    handled.add("ability_scroll");
    for (const scroll of abilityScrolls) addPricedFeature(features, priceMap, {
      key: `ability_scroll:${scroll}`,
      label: humanize(scroll),
      value: scroll,
      category: "modifier",
      recognized: true,
      marketProductId: scroll,
    });
  }

  for (const [key, definition] of Object.entries(scalarFeatureDefinitions)) {
    const value = finiteNumber(extra[key]);
    if (value === undefined || value <= 0) continue;
    handled.add(key);
    const quantity = definition.multiplier ? definition.multiplier(value) : value;
    addPricedFeature(features, priceMap, {
      key,
      label: definition.label,
      value: `×${quantity}`,
      category: definition.category,
      recognized: true,
      ...(definition.productId ? { marketProductId: definition.productId } : {}),
    }, quantity);
  }

  for (const [key, label] of recognizedCounters) {
    if (extra[key] === undefined) continue;
    handled.add(key);
    features.push({ key, label, value: compactValue(extra[key]), category: "counter", recognized: true });
  }

  for (const key of Object.keys(extra)) {
    if (handled.has(key) || key.startsWith("uid")) continue;
    if (key.startsWith("drill_part_") || ["fuel_tank", "drill_engine", "upgrade_module", "hook", "line", "sinker"].includes(key)) {
      handled.add(key);
      const value = isRecord(extra[key]) ? stringValue(extra[key].part) ?? compactValue(extra[key]) : compactValue(extra[key]);
      features.push({ key, label: humanize(key), value, category: "drill-part", recognized: true });
      continue;
    }
  }

  const unknownAttributeKeys = Object.keys(extra).filter((key) => !handled.has(key) && !key.startsWith("uid"));
  for (const key of unknownAttributeKeys) features.push({
    key,
    label: humanize(key),
    value: compactValue(extra[key]),
    category: "unknown",
    recognized: false,
  });
  if (features.some((feature) => feature.key === "legacy_color")) unknownAttributeKeys.push("legacy_color");
  return { features, unknownAttributeKeys: [...new Set(unknownAttributeKeys)].sort() };
}

async function fetchPriceMap(): Promise<Map<string, number>> {
  const [rough, bazaar] = await Promise.all([
    fetchJson<Record<string, unknown>>(COFL_ROUGH_URL, 20_000),
    fetchJson<HypixelBazaarResponse>(BAZAAR_URL, 20_000),
  ]);
  const prices = new Map<string, number>();
  for (const [productId, rawPrice] of Object.entries(rough)) {
    const price = finiteNumber(rawPrice);
    if (price && price > 0) prices.set(productId, price);
  }
  if (bazaar.success) {
    for (const [productId, product] of Object.entries(bazaar.products)) {
      const instantBuy = product.sell_summary[0]?.pricePerUnit ?? product.quick_status.buyPrice;
      if (Number.isFinite(instantBuy) && instantBuy > 0) prices.set(productId, instantBuy);
    }
  }
  return prices;
}

function priceAuction(
  parsed: ParsedAuction,
  priceMap: ReadonlyMap<string, number>,
  historySummary?: AhHistorySummary | null,
): PricedAuction {
  const { features, unknownAttributeKeys } = extractFeatures(parsed.extraAttributes, priceMap, parsed.auction.item_name);
  const history = historySummary?.items[parsed.productId];
  const baseReference = Math.max(priceMap.get(parsed.productId) ?? 0, history?.medianPrice ?? 0);
  const retainedBase = baseReference * (features.length > 0 ? 0.72 : 0.9) * parsed.quantity;
  const componentPremium = features.reduce((sum, feature) => sum + (feature.estimatedContribution ?? 0), 0);
  const componentEstimate = retainedBase + componentPremium;
  const preliminaryProfit = componentEstimate * 0.95 - parsed.auction.starting_bid;
  return {
    ...parsed,
    features,
    unknownAttributeKeys,
    componentEstimate,
    preliminaryProfit,
    ...(history ? { history } : {}),
  };
}

async function combinedInventoryNbt(auctions: PricedAuction[]): Promise<string> {
  const parsed = await Promise.all(auctions.map(async ({ auction }) =>
    (await parse(Buffer.from(auction.item_bytes, "base64"), "big")).parsed,
  ));
  const inventory = parsed[0];
  if (!inventory) throw new Error("Cannot construct an empty NBT inventory");
  const list = inventory.value.i;
  if (!list || list.type !== "list" || list.value.type !== "compound") throw new Error("Unexpected Hypixel item NBT structure");
  list.value.value = parsed.flatMap((entry) => {
    const candidate = entry.value.i;
    return candidate?.type === "list" && candidate.value.type === "compound" ? candidate.value.value : [];
  });
  return gzipSync(writeUncompressed(inventory as NBT, "big")).toString("base64");
}

function validNbtEstimate(value: unknown): AhNbtEstimate | undefined {
  if (!isRecord(value)) return undefined;
  const lbin = finiteNumber(value.lbin);
  const median = finiteNumber(value.median);
  const fastSell = finiteNumber(value.fastSell);
  const volume = finiteNumber(value.volume);
  if (lbin === undefined || median === undefined || fastSell === undefined || volume === undefined) return undefined;
  return {
    lbin,
    median,
    fastSell,
    volume,
    ...(stringValue(value.lbinLink) ? { lbinLink: stringValue(value.lbinLink) } : {}),
    ...(stringValue(value.lbinKey) ? { lbinKey: stringValue(value.lbinKey) } : {}),
    ...(stringValue(value.medianKey) ? { medianKey: stringValue(value.medianKey) } : {}),
    ...(stringValue(value.itemKey) ? { itemKey: stringValue(value.itemKey) } : {}),
  };
}

async function fetchNbtEstimates(
  candidates: PricedAuction[],
  contact: string,
  token?: string,
): Promise<Map<string, AhNbtEstimate>> {
  const estimates = new Map<string, AhNbtEstimate>();
  let lastRequestAt = Number.NEGATIVE_INFINITY;
  for (let offset = 0; offset < candidates.length; offset += NBT_BATCH_SIZE) {
    const batch = candidates.slice(offset, offset + NBT_BATCH_SIZE);
    const wait = lastRequestAt + NBT_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    try {
      const fullInventoryNbt = await combinedInventoryNbt(batch);
      const payload = await fetchJson<unknown[]>(COFL_NBT_URL, 45_000, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          chestName: "Sky Turbo AH valuation",
          fullInventoryNbt,
          position: { x: 0, y: 0, z: 0 },
          jsonNbt: null,
          senderContactId: contact,
          server: "hypixel",
        }),
      });
      for (let index = 0; index < batch.length; index += 1) {
        const estimate = validNbtEstimate(payload[index]);
        const candidate = batch[index];
        if (estimate && candidate) estimates.set(candidate.auction.uuid, estimate);
      }
    } catch {
      // The component fallback remains visible and is explicitly marked high risk.
    }
  }
  return estimates;
}

function selectCandidates(priced: PricedAuction[], limit: number): PricedAuction[] {
  const selected = new Map<string, PricedAuction>();
  const byProfit = [...priced].sort((left, right) => right.preliminaryProfit - left.preliminaryProfit);
  for (const candidate of byProfit.slice(0, Math.max(0, limit - 120))) selected.set(candidate.auction.uuid, candidate);
  const newestEnhanced = priced
    .filter((candidate) => candidate.features.length > 0)
    .sort((left, right) => right.auction.start - left.auction.start)
    .slice(0, 80);
  for (const candidate of newestEnhanced) selected.set(candidate.auction.uuid, candidate);
  const largestDiscount = [...priced].sort((left, right) => {
    const leftRatio = left.componentEstimate / left.auction.starting_bid;
    const rightRatio = right.componentEstimate / right.auction.starting_bid;
    return rightRatio - leftRatio;
  }).slice(0, 80);
  for (const candidate of largestDiscount) selected.set(candidate.auction.uuid, candidate);
  return [...selected.values()]
    .sort((left, right) => right.preliminaryProfit - left.preliminaryProfit)
    .slice(0, limit);
}

export class AhAuctionScanner {
  private readonly parsedCache = new Map<string, ParsedAuction | null>();

  async latestUpdatedAt(): Promise<number> {
    return (await fetchAuctionPage(0)).lastUpdated;
  }

  async scan(options: AhScanOptions = {}): Promise<AhFlipSnapshot> {
    const [{ pages, partial }, priceMap] = await Promise.all([
      fetchAuctionSnapshot(options.maxPages),
      fetchPriceMap(),
    ]);
    const first = pages[0]!;
    const auctions = pages.flatMap((page) => page.auctions).filter((auction) => auction.bin && !auction.claimed);
    const liveIds = new Set(auctions.map((auction) => auction.uuid));
    let cursor = 0;
    const parsed: ParsedAuction[] = [];
    const parseWorker = async () => {
      while (cursor < auctions.length) {
        const auction = auctions[cursor++];
        if (!auction) return;
        let value = this.parsedCache.get(auction.uuid);
        if (value === undefined) {
          value = await parseAuction(auction);
          this.parsedCache.set(auction.uuid, value);
        }
        if (value) parsed.push({ ...value, auction });
      }
    };
    await Promise.all(Array.from({ length: Math.min(16, auctions.length) }, parseWorker));
    if (!partial) {
      for (const auctionId of this.parsedCache.keys()) if (!liveIds.has(auctionId)) this.parsedCache.delete(auctionId);
    }

    const priced = parsed.map((auction) => priceAuction(auction, priceMap, options.history));
    const candidates = selectCandidates(priced, options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT);
    const estimates = options.skipExactNbt
      ? new Map<string, AhNbtEstimate>()
      : await fetchNbtEstimates(candidates, options.coflContact ?? "Sky-Turbo", options.coflToken);
    const flips = candidates.flatMap((candidate) => {
      const valuation: AhValuationInput = {
        auctionId: candidate.auction.uuid,
        productId: candidate.productId,
        name: candidate.auction.item_name,
        category: candidate.auction.category,
        tier: candidate.auction.tier,
        quantity: candidate.quantity,
        listingPrice: candidate.auction.starting_bid,
        start: candidate.auction.start,
        end: candidate.auction.end,
        componentEstimate: candidate.componentEstimate,
        features: candidate.features,
        unknownAttributeKeys: candidate.unknownAttributeKeys,
        ...(estimates.get(candidate.auction.uuid) ? { nbtEstimate: estimates.get(candidate.auction.uuid) } : {}),
        ...(candidate.history ? { history: candidate.history } : {}),
      };
      const flip = calculateAhFlip(valuation);
      return flip && flip.profit > 0 ? [flip] : [];
    }).sort((left, right) => right.profit - left.profit).slice(0, options.resultLimit ?? DEFAULT_RESULT_LIMIT);

    return {
      schemaVersion: 1,
      source: "hypixel-auctions+skycofl",
      generatedAt: Date.now(),
      auctionUpdatedAt: first.lastUpdated,
      totalPages: first.totalPages,
      totalAuctions: first.totalAuctions,
      parsedAuctions: parsed.length,
      candidateAuctions: candidates.length,
      evaluatedAuctions: estimates.size,
      skippedAuctions: auctions.length - parsed.length,
      partial,
      ...(options.history?.generatedAt ? { historyGeneratedAt: options.history.generatedAt } : {}),
      flips,
    };
  }
}
