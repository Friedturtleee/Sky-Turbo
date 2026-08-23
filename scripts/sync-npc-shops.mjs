import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const outputPath = resolve(scriptDirectory, "../packages/core/data/npc-shop-data.json");
const githubHeaders = { "User-Agent": "Sky-Turbo NPC shop data sync" };
const repoBase = "https://raw.githubusercontent.com/SkyblockRepo/Repo/main/shops";

async function getJson(url, headers = {}) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return response.json();
}

function cleanName(value) {
  return String(value ?? "")
    .replace(/§[0-9a-fk-or]/gi, "")
    .trim();
}

function fallbackName(productId) {
  return productId.replace(/:\d+$/, "").split("_").map((part) =>
    part ? `${part[0].toUpperCase()}${part.slice(1).toLowerCase()}` : part,
  ).join(" ");
}

function stockLimit(lore) {
  const match = String(lore ?? "").match(/Stock\s*\n[^\n]*?([\d,]+)\s*[^\n]*remaining/i);
  return match ? Number(match[1].replaceAll(",", "")) : undefined;
}

const shopFiles = await getJson(
  "https://api.github.com/repos/SkyblockRepo/Repo/contents/shops",
  githubHeaders,
);
const itemResource = await getJson("https://api.hypixel.net/v2/resources/skyblock/items");
const names = new Map(itemResource.items.map((item) => [item.id, cleanName(item.name)]));

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
for (const { file, shop } of shops) {
  for (const [slotId, slot] of Object.entries(shop.slots ?? {})) {
    const costs = Array.isArray(slot.cost) ? slot.cost : [];
    const outputs = Array.isArray(slot.output)
      ? slot.output.filter((output) => output.type === "ITEM" && output.item_id)
      : [];
    if (
      outputs.length !== 1 ||
      costs.length === 0 ||
      costs.some((cost) => cost.type !== "COINS" && cost.type !== "ITEM")
    ) continue;

    const output = outputs[0];
    offers.push({
      id: `${file.name.replace(/\.json$/, "")}:${slotId}`,
      npc: cleanName(shop.name) || fallbackName(file.name.replace(/^NPC_|\.json$/g, "")),
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
      ...(stockLimit(slot.lore) ? { dailyLimit: stockLimit(slot.lore) } : {}),
      source: {
        label: "SkyblockRepo / Hypixel Wiki",
        url: `${repoBase}/${encodeURIComponent(file.name).replaceAll("%2F", "/")}`,
      },
    });
  }
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

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sources: [
    "https://github.com/SkyblockRepo/Repo/tree/main/shops",
    "https://api.hypixel.net/v2/resources/skyblock/items",
    miriaSource.url,
  ],
  offers: deduplicated,
}, null, 2)}\n`);

console.log(`Wrote ${deduplicated.length} NPC shop offers to ${outputPath}`);
