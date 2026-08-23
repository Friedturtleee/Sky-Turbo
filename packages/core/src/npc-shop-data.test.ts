import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { NpcShopData } from "./types";

const data = JSON.parse(readFileSync(
  fileURLToPath(new URL("../data/npc-shop-data.json", import.meta.url)),
  "utf8",
)) as NpcShopData;

describe("generated NPC shop data", () => {
  it("contains unique, finite, structurally valid offers", () => {
    expect(data.schemaVersion).toBe(2);
    expect(new Set(data.offers.map((offer) => offer.id)).size).toBe(data.offers.length);
    for (const offer of data.offers) {
      expect(offer.npc.trim().length).toBeGreaterThan(0);
      expect(offer.output.productId.trim().length).toBeGreaterThan(0);
      expect(offer.output.amount).toBeGreaterThan(0);
      expect(offer.costs.length).toBeGreaterThan(0);
      expect(offer.costs.every((cost) => Number.isFinite(cost.amount) && cost.amount > 0)).toBe(true);
      if (offer.dailyLimit !== undefined) {
        expect(Number.isInteger(offer.dailyLimit)).toBe(true);
        expect(offer.dailyLimit).toBeGreaterThan(0);
        expect(offer.dailyLimit).not.toBe(6_640);
      }
    }
  });

  it("pins Kiara's four special Shard stocks and Diaz exception", () => {
    const kiara = data.offers.filter((offer) => offer.npc === "Kiara");
    expect(Object.fromEntries(kiara.map((offer) => [offer.output.productId, offer.dailyLimit]))).toEqual({
      SHARD_CROCODILE: 6,
      SHARD_EEL: 6,
      SHARD_GECKO: 4,
      SHARD_VIPER: 10,
    });
    expect(kiara.every((offer) => offer.diazEligible === false)).toBe(true);
    expect(kiara.every((offer) => offer.conditionalDailyLimitBonus === 1)).toBe(true);
  });

  it("covers every documented NPC Shard resale offer", () => {
    const shardOffers = data.offers.filter((offer) => offer.output.productId.startsWith("SHARD_"));
    expect(Object.fromEntries(shardOffers.map((offer) => [offer.output.productId, offer.npc]))).toEqual({
      SHARD_CROW: "Agatha",
      SHARD_HERON: "Agatha",
      SHARD_CROCODILE: "Kiara",
      SHARD_EEL: "Kiara",
      SHARD_GECKO: "Kiara",
      SHARD_VIPER: "Kiara",
      SHARD_VULTURE: "Miria",
      SHARD_WOODPECKER: "Miria",
    });
  });

  it("includes the Galatea shops missing from the upstream repository", () => {
    expect(Object.fromEntries(["Amaury", "Alan", "Nemo", "Albert"].map((npc) => [
      npc,
      data.offers.filter((offer) => offer.npc === npc).length,
    ]))).toEqual({ Amaury: 6, Alan: 2, Nemo: 5, Albert: 2 });
    const respiration = data.offers.find((offer) => offer.id === "NEMO:ENCHANTMENT_RESPIRATION_4");
    expect(respiration?.costs).toEqual([
      { kind: "coins", amount: 4_000_000 },
      { kind: "item", productId: "SEA_LUMIES", name: "Sea Lumies", amount: 32 },
    ]);
  });

  it("uses the standard 640-item limit instead of leaking formatting codes", () => {
    const standard = data.offers.filter((offer) => offer.dailyLimitSource === "standard-shop-limit");
    expect(standard.length).toBeGreaterThan(250);
    expect(standard.every((offer) => offer.dailyLimit === 640 && offer.diazEligible)).toBe(true);
  });

  it("keeps Hypixel's legacy Cocoa Beans Bazaar ID while preserving the friendly name", () => {
    const cocoa = data.offers.filter((offer) => offer.output.name === "Cocoa Beans");
    expect(cocoa.length).toBeGreaterThan(0);
    expect(cocoa.every((offer) => offer.output.productId === "INK_SACK:3")).toBe(true);
  });

  it("audits Bazaar outputs skipped by the upstream parser", () => {
    expect(data.audit?.generatedOffers).toBe(data.offers.length);
    expect(data.audit?.skippedBazaarOffers).toEqual([{
      file: "NPC_ANITA.json",
      slotId: "item8",
      productId: "ENCHANTMENT_DELICATE_5",
      reason: "unsupported-cost:JACOB_MEDAL",
    }]);
  });
});
