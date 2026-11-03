import { describe, expect, it } from "bun:test";

import { forgetRecentSearch, loadRecentSearches, RECENT_SEARCHES_KEY, RECENT_SEARCHES_SHOWN, rememberRecentSearch } from "./recentSearches.ts";

function read(value: unknown): (key: string) => string | null {
  return (key) => key === RECENT_SEARCHES_KEY ? JSON.stringify(value) : null;
}

describe("loadRecentSearches", () => {
  it("keeps the stored order and drops what is not a search", () => {
    expect(loadRecentSearches(read(["export guard", 42, null, "  payments  ", "x", "", "retry", { query: "no" }]))).toEqual([
      "export guard",
      "payments",
      "retry",
    ]);
  });

  it("drops repeats without case and stops at the palette's count", () => {
    expect(loadRecentSearches(read(["Export", "export", "EXPORT", "a", "export guard"]))).toEqual(["Export", "export guard"]);
    const many = ["one", "two", "three", "four", "five", "six", "seven"];
    expect(loadRecentSearches(read(many))).toHaveLength(RECENT_SEARCHES_SHOWN);
    expect(loadRecentSearches(read(many))).toEqual(many.slice(0, RECENT_SEARCHES_SHOWN));
  });

  it("treats malformed or missing storage as no history", () => {
    expect(loadRecentSearches(() => null)).toEqual([]);
    expect(loadRecentSearches(() => "not json")).toEqual([]);
    expect(loadRecentSearches(() => "{}")).toEqual([]);
    expect(loadRecentSearches(() => { throw new Error("blocked"); })).toEqual([]);
  });
});

describe("forgetRecentSearch", () => {
  it("removes the search by its words, not their case, and keeps the rest in order", () => {
    expect(forgetRecentSearch("Payments", ["retry", "payments", "export"])).toEqual(["retry", "export"]);
    expect(forgetRecentSearch("  export  ", ["retry", "export"])).toEqual(["retry"]);
  });

  it("leaves a list that does not hold it alone", () => {
    expect(forgetRecentSearch("export", ["retry", "payments"])).toEqual(["retry", "payments"]);
    expect(forgetRecentSearch("export", [])).toEqual([]);
  });
});

describe("rememberRecentSearch", () => {
  it("puts the newest search first and moves a repeat up", () => {
    expect(rememberRecentSearch("retry flag", ["payments", "retry flag", "export"])).toEqual(["retry flag", "payments", "export"]);
    expect(rememberRecentSearch("  Export  ", ["payments"])).toEqual(["Export", "payments"]);
  });

  it("ignores a query too short to search for and caps the list", () => {
    expect(rememberRecentSearch(" e ", ["payments"])).toEqual(["payments"]);
    const many = ["one", "two", "three", "four", "five"];
    expect(rememberRecentSearch("six", many)).toEqual(["six", "one", "two", "three", "four"]);
  });
});
