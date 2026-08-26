import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FusionData } from "./types";

const data = JSON.parse(readFileSync(
  fileURLToPath(new URL("../data/fusion-data.json", import.meta.url)),
  "utf8",
)) as FusionData;

describe("generated Shard Fusion data", () => {
  it("preserves input order instead of inventing reverse recipes", () => {
    for (const buckets of Object.values(data.recipes)) {
      for (const recipes of Object.values(buckets)) {
        const recipeKeys = new Set(recipes.map(([left, right]) => `${left}\0${right}`));
        for (const [left, right] of recipes) {
          if (left !== right) expect(recipeKeys.has(`${right}\0${left}`)).toBe(false);
        }
      }
    }
  });

  it("keeps Anteater's ordered special Fusion recipe", () => {
    expect(data.shards.R70?.name).toBe("Anteater");
    expect(data.recipes.R70?.["2"]).toEqual([["U79", "R54"]]);
    expect(data.shards.U79?.name).toBe("Queen Ant");
    expect(data.shards.R54?.name).toBe("King Cobra");
  });
});
