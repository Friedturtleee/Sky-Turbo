import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../packages/core/data/npc-shop-data.json");
const githubHeaders = { "User-Agent": "Sky-Turbo NPC shop data sync" };
const repoBase = "https://raw.githubusercontent.com/SkyblockRepo/Repo/main/shops";
const bazaarUrl = "https://api.hypixel.net/v2/skyblock/bazaar";
const STANDARD_DAILY_LIMIT = 640;

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/(?:§|&)[0-9a-fk-or]/gi, "")
    .trim();
}

function fallbackName(productId) {
  return productId.replace(/:\d+$/, "").split("_").map((part) =>
    part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part,
  ).join(" ");
}

function canonicalNpcName(fileName, shopName) {
  // Rosetta's armor sets are separate shop-menu files. Their menu titles are
  // item categories, not NPC names.
  if (fileName.startsWith("NPC_ROSETTA_")) return "Rosetta";
  return cleanName(shopName) || fallbackName(fileName.replace(/^NPC_|\.json$/g, ""));
}

function stockLimit(lore) {
  const cleaned = String(lore ?? "").replace(/(?:§|&)[0-9a-fk-or]/gi, "");
  const match = cleaned.match(/Stock\s*\n[^\n]*?([\d,]+)\s*[^\n]*remaining/i);
  return match ? Number(match[1].replaceAll(",", "")) : undefined;
}

const shopFiles = await getJson(
  "https://api.github.com/repos/SkyblockRepo/Repo/contents/shops",
  githubHeaders,
);
const [itemResource, bazaarResource] = await Promise.all([
  getJson("https://api.hypixel.net/v2/resources/skyblock/items"),
  getJson(bazaarUrl),
]);
const names = new Map(itemResource.items.map((item) => [item.id, cleanName(item.name)]));
const bazaarProductIds = new Set(Object.keys(bazaarResource.products ?? {}));

const excludedFileParts = [
  "NPC_AUCTION_",
  "NPC_BANK",
  "NPC_BAZAAR_",
  "NPC_DANTE",
  "NPC_TECHNOSHOP",
  "NPC_WARREN",
  "CLAIM_REWARD",
  "SELECTOR",
  "ESSENCE_CRAFTING",
  "ATTRIBUTE_TRANSFER",
];
const selectedFiles = shopFiles.filter((file) =>
  file.type === "file" &&
  file.name.startsWith("NPC_") &&
  file.name.endsWith(".json") &&
  excludedFileParts.every((part) => !file.name.includes(part)),
);

const shops = [];
for (let index = 0; index < selectedFiles.length; index += 12) {
  const batch = selectedFiles.slice(index, index + 12);
  const loaded = await Promise.all(batch.map(async (file) => ({
    file,
    shop: await getJson(file.download_url),
  })));
  shops.push(...loaded);
}

const offers = [];
const audit = {
  sourceShopFiles: shopFiles.filter((file) => file.type === "file" && file.name.startsWith("NPC_") && file.name.endsWith(".json")).length,
  selectedShopFiles: selectedFiles.length,
  skippedNoCost: 0,
  skippedNonSingleOutput: 0,
  skippedUnsupportedCost: 0,
  skippedBazaarOffers: [],
};
for (const { file, shop } of shops) {
  for (const [slotId, slot] of Object.entries(shop.slots ?? {})) {
    const costs = Array.isArray(slot.cost) ? slot.cost : [];
    const outputs = Array.isArray(slot.output)
      ? slot.output.filter((output) => output.type === "ITEM" && output.item_id)
      : [];
    const unsupportedCostTypes = costs.filter((cost) => cost.type !== "COINS" && cost.type !== "ITEM").map((cost) => cost.type);
    if (outputs.length !== 1 || costs.length === 0 || unsupportedCostTypes.length > 0) {
      if (outputs.length !== 1) audit.skippedNonSingleOutput += 1;
      if (costs.length === 0) audit.skippedNoCost += 1;
      if (unsupportedCostTypes.length > 0) audit.skippedUnsupportedCost += 1;
      const bazaarOutput = outputs.find((output) => bazaarProductIds.has(output.item_id));
      if (bazaarOutput) audit.skippedBazaarOffers.push({
        file: file.name,
        slotId,
        productId: bazaarOutput.item_id,
        reason: costs.length === 0
          ? "no-cost"
          : outputs.length !== 1
            ? "non-single-output"
            : `unsupported-cost:${[...new Set(unsupportedCostTypes)].join(",")}`,
      });
      continue;
    }

    const output = outputs[0];
    const explicitStock = stockLimit(slot.lore);
    const dailyLimit = explicitStock ?? STANDARD_DAILY_LIMIT;
    offers.push({
      id: `${file.name.replace(/\.json$/, "")}:${slotId}`,
      npc: canonicalNpcName(file.name, shop.name),
      output: {
        productId: output.item_id,
        name: names.get(output.item_id) ?? fallbackName(output.item_id),
        amount: Number(output.amount ?? 1),
      },
      costs: costs.map((cost) => cost.type === "COINS"
        ? { kind: "coins", amount: Number(cost.amount) }
        : {
            kind: "item",
            productId: cost.item_id,
            name: names.get(cost.item_id) ?? fallbackName(cost.item_id),
            amount: Number(cost.amount ?? 1),
          }),
      ...(dailyLimit ? {
        dailyLimit,
        dailyLimitSource: explicitStock ? "shop-stock" : "standard-shop-limit",
        diazEligible: true,
      } : {}),
      source: {
        label: "SkyblockRepo / Hypixel Wiki",
        url: `${repoBase}/${encodeURIComponent(file.name).replaceAll("%2F", "/")}`,
      },
    });
  }
}

const kiaraSource = {
  label: "Hypixel SkyBlock Wiki · Kiara",
  url: "https://hypixel-skyblock.fandom.com/wiki/Kiara",
};
const kiaraOffers = [
  ["SHARD_VIPER", "Viper Shard", 100_000, 10],
  ["SHARD_CROCODILE", "Crocodile Shard", 300_000, 6],
  ["SHARD_EEL", "Eel Shard", 350_000, 6],
  ["SHARD_GECKO", "Gecko Shard", 600_000, 4],
];

for (const [productId, name, coins, dailyLimit] of kiaraOffers) {
  offers.push({
    id: `KIARA:${productId}`,
    npc: "Kiara",
    output: { productId, name, amount: 1 },
    costs: [{ kind: "coins", amount: coins }],
    dailyLimit,
    dailyLimitSource: "manual-wiki",
    diazEligible: false,
    conditionalDailyLimitBonus: 1,
    conditionalLimitRequirement: "解鎖 Kiara Abiphone Contact",
    requirement: "Galatea · North Reaches",
    source: kiaraSource,
  });
}

const agathaSource = {
  label: "Hypixel SkyBlock Wiki · Agatha",
  url: "https://hypixel-skyblock.fandom.com/wiki/Agatha",
};
const agathaOffers = [
  ["SHARD_CROW", "Crow Shard", 15, "Agatha Shop Milestone II"],
  ["SHARD_HERON", "Heron Shard", 15, "Agatha Shop Milestone IV"],
];

for (const [productId, name, coupons, requirement] of agathaOffers) {
  offers.push({
    id: `AGATHA:${productId}`,
    npc: "Agatha",
    output: { productId, name, amount: 1 },
    costs: [{ kind: "item", productId: "AGATHA_COUPON", name: "Agatha's Coupon", amount: coupons }],
    dailyLimit: STANDARD_DAILY_LIMIT,
    dailyLimitSource: "manual-wiki",
    diazEligible: true,
    requirement,
    source: agathaSource,
  });
}

const galateaMerchantSources = {
  Amaury: { label: "Hypixel SkyBlock Wiki · Amaury", url: "https://hypixel-skyblock.fandom.com/wiki/Amaury" },
  Alan: { label: "Hypixel SkyBlock Wiki · Alan", url: "https://hypixel-skyblock.fandom.com/wiki/Alan" },
  Nemo: { label: "Hypixel SkyBlock Wiki · Nemo", url: "https://hypixel-skyblock.fandom.com/wiki/Nemo" },
  Albert: { label: "Hypixel SkyBlock Wiki · Albert", url: "https://hypixel-skyblock.fandom.com/wiki/Albert" },
};
const galateaMerchantOffers = [
  ["Amaury", "SERIOUSLY_DAMAGED_AXE", "Seriously Damaged Axe", [["coins", 5_000]], undefined],
  ["Amaury", "DECENT_AXE", "Decent Axe", [["coins", 1_000_000], ["SERIOUSLY_DAMAGED_AXE", "Seriously Damaged Axe", 1]], undefined],
  ["Amaury", "CANOPY_HELMET", "Canopy Mask", [["coins", 120_000]], undefined],
  ["Amaury", "CANOPY_CHESTPLATE", "Canopy Shirt", [["coins", 140_000]], undefined],
  ["Amaury", "CANOPY_LEGGINGS", "Canopy Pants", [["coins", 130_000]], undefined],
  ["Amaury", "CANOPY_BOOTS", "Canopy Sandals", [["coins", 110_000]], undefined],
  ["Alan", "VENATOR_GENESIS", "Worn Huntaxe - Genesis", [["coins", 25_000]], undefined],
  ["Alan", "SILVA_DOMINUS", "Sharpened Huntaxe - Dominus", [["coins", 300_000], ["VENATOR_GENESIS", "Worn Huntaxe - Genesis", 1]], undefined],
  ["Nemo", "SNORKELING_HELMET", "Snorkeling Visor", [["coins", 50_000]], "Foraging Skill 16"],
  ["Nemo", "SNORKELING_CHESTPLATE", "Snorkeling Vest", [["coins", 50_000]], "Foraging Skill 16"],
  ["Nemo", "SNORKELING_LEGGINGS", "Snorkeling Pants", [["coins", 50_000]], "Foraging Skill 16"],
  ["Nemo", "SNORKELING_BOOTS", "Snorkeling Shoes", [["coins", 50_000]], "Foraging Skill 16"],
  ["Nemo", "ENCHANTMENT_RESPIRATION_4", "Enchanted Book (Respiration IV)", [["coins", 4_000_000], ["SEA_LUMIES", "Sea Lumies", 32]], undefined],
  ["Albert", "SMALL_POCKET_BLACK_HOLE", "Small Pocket Black Hole", [["coins", 100_000], ["FIG_LOG", "Fig Log", 64]], undefined],
  ["Albert", "MEDIUM_POCKET_BLACK_HOLE", "Medium Pocket Black Hole", [["coins", 1_000_000], ["ENCHANTED_MANGROVE_LOG", "Enchanted Mangrove Log", 64], ["ENCHANTED_OBSIDIAN", "Enchanted Obsidian", 64], ["SMALL_POCKET_BLACK_HOLE", "Small Pocket Black Hole", 1]], undefined],
];

for (const [npc, productId, name, rawCosts, requirement] of galateaMerchantOffers) {
  offers.push({
    id: `${npc.toUpperCase()}:${productId}`,
    npc,
    output: { productId, name, amount: 1 },
    costs: rawCosts.map((cost) => cost[0] === "coins"
      ? { kind: "coins", amount: cost[1] }
      : { kind: "item", productId: cost[0], name: cost[1], amount: cost[2] }),
    dailyLimit: STANDARD_DAILY_LIMIT,
    dailyLimitSource: "manual-wiki",
    diazEligible: true,
    ...(requirement ? { requirement } : {}),
    source: galateaMerchantSources[npc],
  });
}

const miriaSource = {
  label: "Hypixel SkyBlock Wiki · Miria",
  url: "https://hypixelskyblock.minecraft.wiki/w/Miria",
};
const miriaOffers = [
  ["TORRHUS_TALISMAN", "Torrhus Talisman", [["MIRIA_COUPON", "Miria's Coupon", 30]]],
  ["EXTREMELY_MILD_ADHESIVE", "Extremely Mild Adhesive", [["MIRIA_COUPON", "Miria's Coupon", 100]]],
  ["SHARD_WOODPECKER", "Woodpecker Shard", [["MIRIA_COUPON", "Miria's Coupon", 15]]],
  ["SMALL_SLOTH_CLAW", "Small Sloth Claw", [["MIRIA_COUPON", "Miria's Coupon", 30]]],
  ["MEDIUM_SLOTH_CLAW", "Medium Sloth Claw", [["MIRIA_COUPON", "Miria's Coupon", 40]]],
  ["TORRHUS_RING", "Torrhus Ring", [["MIRIA_COUPON", "Miria's Coupon", 30], ["TORRHUS_TALISMAN", "Torrhus Talisman", 1]]],
  ["RUBBER_SNORKEL", "Rubber Snorkel", [["MIRIA_COUPON", "Miria's Coupon", 125]]],
  ["SHARD_VULTURE", "Vulture Shard", [["MIRIA_COUPON", "Miria's Coupon", 25]]],
  ["LARGE_SLOTH_CLAW", "Large Sloth Claw", [["MIRIA_COUPON", "Miria's Coupon", 50]]],
  ["WINDING_IVY", "Winding Ivy", [["MIRIA_COUPON", "Miria's Coupon", 250]]],
  ["TORRHUS_ARTIFACT", "Torrhus Artifact", [["MIRIA_COUPON", "Miria's Coupon", 30], ["TORRHUS_RING", "Torrhus Ring", 1]]],
  ["GIANT_SLOTH_CLAW", "Giant Sloth Claw", [["MIRIA_COUPON", "Miria's Coupon", 60]]],
  ["VIAL_OF_SPRING_WATER", "Vial of Spring Water", [["MIRIA_PRIZE", "Miria's Prize", 10]]],
];

for (const [productId, name, itemCosts] of miriaOffers) {
  offers.push({
    id: `MIRIA:${productId}`,
    npc: "Miria",
    output: { productId, name, amount: 1 },
    costs: itemCosts.map(([costId, costName, amount]) => ({
      kind: "item",
      productId: costId,
      name: costName,
      amount,
    })),
    dailyLimit: STANDARD_DAILY_LIMIT,
    dailyLimitSource: "manual-wiki",
    diazEligible: true,
    requirement: "需達到對應 Miria Shop Milestone",
    source: miriaSource,
  });
}

const deduplicated = [...new Map(offers.map((offer) => [
  JSON.stringify([offer.npc, offer.output, offer.costs]),
  offer,
])).values()].sort((left, right) =>
  left.npc.localeCompare(right.npc) || left.output.name.localeCompare(right.output.name),
);

const invalidRosettaOffer = deduplicated.find((offer) =>
  offer.id.startsWith("NPC_ROSETTA_") && offer.npc !== "Rosetta",
);
if (invalidRosettaOffer) {
  throw new Error(`Rosetta menu was assigned to ${invalidRosettaOffer.npc}`);
}

const invalidLimit = deduplicated.find((offer) =>
  offer.dailyLimit !== undefined && (!Number.isInteger(offer.dailyLimit) || offer.dailyLimit < 1),
);
if (invalidLimit) throw new Error(`Invalid daily limit for ${invalidLimit.id}: ${invalidLimit.dailyLimit}`);
const colorCodeLimit = deduplicated.find((offer) => offer.dailyLimit === 6_640);
if (colorCodeLimit) throw new Error(`Formatting code leaked into daily limit for ${colorCodeLimit.id}`);
if (deduplicated.filter((offer) => offer.npc === "Kiara").length !== 4) {
  throw new Error("Kiara shop must contain exactly four Shard offers");
}
if (deduplicated.filter((offer) => offer.npc === "Agatha" && offer.output.productId.startsWith("SHARD_")).length !== 2) {
  throw new Error("Agatha shop must contain Crow and Heron Shard offers");
}
for (const [npc, expected] of [["Amaury", 6], ["Alan", 2], ["Nemo", 5], ["Albert", 2]]) {
  const actual = deduplicated.filter((offer) => offer.npc === npc).length;
  if (actual !== expected) throw new Error(`${npc} shop must contain ${expected} offers, found ${actual}`);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sources: [
    "https://github.com/SkyblockRepo/Repo/tree/main/shops",
    "https://api.hypixel.net/v2/resources/skyblock/items",
    bazaarUrl,
    miriaSource.url,
    kiaraSource.url,
    agathaSource.url,
    ...Object.values(galateaMerchantSources).map((source) => source.url),
  ],
  audit: {
    ...audit,
    generatedOffers: deduplicated.length,
  },
  offers: deduplicated,
}, null, 2)}\n`);

console.log(`Wrote ${deduplicated.length} NPC shop offers to ${outputPath}`);
