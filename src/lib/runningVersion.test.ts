import { describe, expect, test } from "bun:test";
import { runningHerdrVersion } from "./runningVersion.ts";

describe("runningHerdrVersion", () => {
  test("is the running server's, then the installed binary's", () => {
    expect(runningHerdrVersion({ server_version: "0.9.3", binary_version: "0.9.4" }, "0.9.0")).toBe("0.9.3");
    expect(runningHerdrVersion({ server_version: null, binary_version: "0.9.4" }, "0.9.0")).toBe("0.9.4");
  });

  test("is the health check's where the update status names none", () => {
    expect(runningHerdrVersion({ server_version: null, binary_version: null }, "0.9.0")).toBe("0.9.0");
    expect(runningHerdrVersion(null, "0.9.0")).toBe("0.9.0");
  });

  test("is nothing when herdr has not said", () => {
    expect(runningHerdrVersion(null, null)).toBeNull();
    expect(runningHerdrVersion({ server_version: null, binary_version: null }, null)).toBeNull();
  });
});
