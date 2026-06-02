import { describe, it, expect } from "vitest";
import { parseElastic, type ElasticInput } from "../parsers/elastic.js";
import sample from "../samples/elastic.json" assert { type: "json" };

const input = sample as ElasticInput;

describe("parseElastic", () => {
  const result = parseElastic(input);

  it("normalizes the vendor and source count", () => {
    expect(result.vendor).toBe("elastic");
    expect(result.sources).toHaveLength(3);
  });

  it("coerces _cat string fields to numbers", () => {
    const logs = result.sources.find((s) => s.name === "logs-2026.05");
    expect(logs?.bytes).toBe(21_474_836_480);
    expect(logs?.events).toBe(12_500_000);
  });

  it("omits bytes/gbPerDay when store.size is absent", () => {
    const audit = result.sources.find((s) => s.name === "audit-2026.05");
    expect(audit?.bytes).toBeUndefined();
    expect(audit?.gbPerDay).toBeUndefined();
    expect(audit?.events).toBe(450_000);
  });

  it("aggregates totals across sources", () => {
    expect(result.totals?.bytes).toBe(26_843_545_600);
    expect(result.totals?.events).toBe(20_950_000);
  });

  it("is deterministic", () => {
    expect(parseElastic(input)).toEqual(result);
  });
});
