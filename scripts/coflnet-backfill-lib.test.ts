import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeCoflnetPayload,
  parseCoflnetTimestamp,
  retryAfterMilliseconds,
  SpacedRateLimiter,
} from "./coflnet-backfill-lib";

describe("SkyCofl backfill helpers", () => {
  it("parses SkyCofl's offset-less timestamps as UTC", () => {
    assert.equal(parseCoflnetTimestamp("2026-08-19T01:10:21.953"), Date.parse("2026-08-19T01:10:21.953Z"));
  });

  it("maps Coflnet buy/sell fields to Sky Turbo order semantics", () => {
    assert.deepEqual(normalizeCoflnetPayload([{
      buy: 110,
      sell: 90,
      buyVolume: 4,
      sellVolume: 6,
      timestamp: "2026-08-19T00:00:00",
    }]), [[Date.parse("2026-08-19T00:00:00Z"), 100, 90, 110, 10]]);
  });

  it("understands Retry-After seconds and enforces the 90/min ceiling", () => {
    assert.equal(retryAfterMilliseconds("3"), 3_000);
    assert.equal(new SpacedRateLimiter(90).intervalMs, 667);
    assert.throws(() => new SpacedRateLimiter(91), /1 to 90/);
  });
});
