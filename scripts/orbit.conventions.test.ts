import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, files, lineOf, read, repo, stripComments } from "./source-scan.ts";

/**
 * Orbit's own rules, added as features were removed. Upstream's rules live in
 * scripts/conventions.test.ts (repo-wide), server/conventions.test.ts and src/conventions.test.ts.
 * Each `it` here names a service Orbit does not talk to, so a removed feature
 * cannot come back through a merge or a cherry-picked upstream commit.
 */

/** Every source file that ships: not tests. */
const SOURCES = [...files("{src,server,shared,scripts}/**/*.{ts,tsx,mjs,cjs,js}"), "vite.config.ts"];

/** Every match of `pattern` in each file's code (comments removed), as `file:line: text`. */
function matches(fileList: string[], pattern: RegExp): { file: string; at: string; index: number; code: string }[] {
  return fileList.flatMap((file) => {
    const code = stripComments(read(file));
    return [...code.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))].map((match) => {
      const line = lineOf(code, match.index);
      return { file, index: match.index, code, at: `${file}:${line}: ${code.split("\n")[line - 1]!.trim().slice(0, 160)}` };
    });
  });
}

/** The modules Orbit removed, and the files that must not come back. */
function absent(removed: string[]): string[] {
  return removed.filter((file) => existsSync(join(repo, file)));
}

describe("Orbit's removed features", () => {
  it("sends nothing to the telemetry worker", () => {
    const offenders = matches(SOURCES.filter((file) => !file.endsWith(".test.ts")), /herdr-web-ui-telemetry\.devswha\.workers\.dev/).map((match) => match.at);
    fail(offenders, "Orbit removed the anonymous usage counts: no source file may name the telemetry worker.");
    expect(offenders).toEqual([]);
  });
});
