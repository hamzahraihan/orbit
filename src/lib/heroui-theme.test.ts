import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const src = join(import.meta.dir, "..");
const bridge = readFileSync(join(src, "lib", "heroui-theme.css"), "utf8");
const orbit = readFileSync(join(src, "styles.css"), "utf8");

/** Every --name: value; declaration in a stylesheet, comments removed. */
function declarations(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (match[1] && match[2] !== undefined) found.set(match[1], match[2].trim());
  }
  return found;
}

const bridged = declarations(bridge);
const orbitTokens = declarations(orbit);

describe("HeroUI token bridge", () => {
  it("never declares a token as a reference to itself", () => {
    for (const [name, value] of bridged) {
      expect(value).not.toBe(`var(${name})`);
    }
  });

  it("leaves Orbit's shared accent and border names alone", () => {
    // A bridge declaration here is a cycle: the same custom property resolving itself.
    expect(bridged.has("--accent")).toBe(false);
    expect(bridged.has("--border")).toBe(false);
  });

  it("only references tokens that Orbit or the bridge declares", () => {
    const declared = new Set([...orbitTokens.keys(), ...bridged.keys()]);
    for (const [name, value] of bridged) {
      for (const match of value.matchAll(/var\((--[\w-]+)\)/g)) {
        if (match[1]) expect({ name, token: match[1], declared: declared.has(match[1]) }).toEqual({ name, token: match[1], declared: true });
      }
    }
  });

  it("keeps a focused field on its own surface and names the accent as its border", () => {
    expect(bridged.get("--field-focus")).toBe("var(--bg-input)");
    expect(bridged.get("--field-border-focus")).toBe("var(--accent)");
  });
});
