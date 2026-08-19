import { describe, expect, it } from "vitest";
import { parseCompactNumber } from "./compact-number";

describe("parseCompactNumber", () => {
  it.each([
    ["100", 100],
    ["1k", 1_000],
    ["1.5K", 1_500],
    ["2m", 2_000_000],
    ["0.25M", 250_000],
    ["3B", 3_000_000_000],
    ["1,250k", 1_250_000],
    ["-2k", -2_000],
  ])("parses %s", (input, expected) => {
    expect(parseCompactNumber(input)).toBe(expected);
  });

  it.each(["", "k", "1t", "12kk", "hello"])("rejects %s", (input) => {
    expect(parseCompactNumber(input)).toBeUndefined();
  });
});
