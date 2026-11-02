import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createScheduledPrompts, HOLD_LIMIT_MS, MAX_SCHEDULED, MAX_SCHEDULED_AHEAD_MS } from "./scheduled-prompts.ts";

function store(options: { now?: number; send?: (paneId: string, text: string) => Promise<void>; stateDir?: string } = {}) {
  const stateDir = options.stateDir ?? mkdtempSync(join(tmpdir(), "herdr-scheduled-"));
  const sent: Array<[string, string]> = [];
  const prompts = createScheduledPrompts({
    stateDir,
    now: () => options.now ?? 1_000_000,
    send: options.send ?? (async (paneId, text) => { sent.push([paneId, text]); }),
  });
  return { prompts, sent, stateDir };
}

const NOW = 1_000_000;

describe("scheduled prompts", () => {
  it("keeps a row per pane and hands it back in the order it will fire", () => {
    const { prompts } = store();
    const later = prompts.add({ paneId: "p1", text: "second", sendAt: NOW + 60_000 });
    const sooner = prompts.add({ paneId: "p1", text: "first", sendAt: NOW + 30_000 });
    expect("error" in later || "error" in sooner).toBe(false);
    expect(prompts.list("p1").map((row) => row.text)).toEqual(["first", "second"]);
    expect(prompts.list("other")).toEqual([]);
    prompts.close();
  });

  it("types a due message into its pane once, then forgets it", async () => {
    const { prompts, sent } = store();
    prompts.add({ paneId: "p1", text: "run the tests", sendAt: NOW + 60_000 });
    await prompts.fire(NOW + 60_001);
    expect(sent).toEqual([["p1", "run the tests"]]);
    expect(prompts.list("p1")).toEqual([]);
    // the same moment fired again sends nothing: a message never goes out twice
    await prompts.fire(NOW + 120_000);
    expect(sent).toHaveLength(1);
    prompts.close();
  });

  it("leaves a message that is not due yet alone", async () => {
    const { prompts, sent } = store();
    prompts.add({ paneId: "p1", text: "later", sendAt: NOW + 60_000 });
    await prompts.fire(NOW + 59_999);
    expect(sent).toEqual([]);
    expect(prompts.list("p1")).toHaveLength(1);
    prompts.close();
  });

  it("keeps a failed send with herdr's reason, so the text is not lost and is never retried", async () => {
    const stateDir = mkdtempSync(join(tmpdir(), "herdr-scheduled-"));
    let attempts = 0;
    const prompts = createScheduledPrompts({
      stateDir,
      now: () => NOW,
      send: async () => { attempts += 1; throw new Error("pane not found"); },
    });
    prompts.add({ paneId: "p1", text: "hello", sendAt: NOW + 10_000 });
    await prompts.fire(NOW + 10_000);
    const [row] = prompts.list("p1");
    expect(row?.failure).toBe("pane not found");
    await prompts.fire(NOW + 60_000);
    expect(attempts).toBe(1);
    prompts.close();
  });

  it("refuses an empty text, a past time, one too far ahead, and a full pane", () => {
    const { prompts } = store();
    expect(prompts.add({ paneId: "p1", text: "   ", sendAt: NOW + 1000 })).toEqual({ error: "empty_text" });
    expect(prompts.add({ paneId: "p1", text: "x", sendAt: NOW - 120_000 })).toEqual({ error: "send_at_in_past" });
    expect(prompts.add({ paneId: "p1", text: "x", sendAt: NOW + MAX_SCHEDULED_AHEAD_MS + 1 })).toEqual({ error: "send_at_too_far" });
    for (let index = 0; index < MAX_SCHEDULED; index += 1) prompts.add({ paneId: "p1", text: `m${index}`, sendAt: NOW + 60_000 });
    expect(prompts.add({ paneId: "p1", text: "one more", sendAt: NOW + 60_000 })).toEqual({ error: "too_many" });
    prompts.close();
  });

  it("leaves a message held, with its reason, while the agent's input box holds a draft", async () => {
    const sent: string[] = [];
    let held: string | null = "the agent's input box holds a draft";
    const prompts = createScheduledPrompts({
      stateDir: mkdtempSync(join(tmpdir(), "herdr-scheduled-")),
      now: () => NOW,
      send: async (_paneId, text) => { sent.push(text); },
      hold: async () => held,
    });
    prompts.add({ paneId: "p1", text: "run the tests", sendAt: NOW + 10_000 });
    await prompts.fire(NOW + 10_000);
    expect(sent).toEqual([]);
    expect(prompts.list("p1")[0]?.held).toEqual({ reason: "the agent's input box holds a draft", since: NOW + 10_000 });
    // the box is cleared: the next look types it, and the held mark goes with the row
    held = null;
    await prompts.fire(NOW + 70_000);
    expect(sent).toEqual(["run the tests"]);
    expect(prompts.list("p1")).toEqual([]);
    prompts.close();
  });

  it("stops holding eventually, with a row that says why it never went out", async () => {
    const sent: string[] = [];
    const prompts = createScheduledPrompts({
      stateDir: mkdtempSync(join(tmpdir(), "herdr-scheduled-")),
      now: () => NOW,
      send: async (_paneId, text) => { sent.push(text); },
      hold: async () => "the agent is waiting for an answer",
    });
    prompts.add({ paneId: "p1", text: "hello", sendAt: NOW + 10_000 });
    await prompts.fire(NOW + 10_000);
    await prompts.fire(NOW + 10_000 + HOLD_LIMIT_MS);
    expect(sent).toEqual([]);
    const [row] = prompts.list("p1");
    expect(row?.held).toBeNull();
    expect(row?.failure).toBe("10 minutes late: the agent is waiting for an answer");
    prompts.close();
  });

  it("cancels a row and persists what is left", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "herdr-scheduled-"));
    const first = store({ stateDir });
    const kept = first.prompts.add({ paneId: "p1", text: "keep", sendAt: NOW + 60_000 });
    const dropped = first.prompts.add({ paneId: "p1", text: "drop", sendAt: NOW + 90_000 });
    if ("error" in kept || "error" in dropped) throw new Error("the store refused a schedule");
    expect(first.prompts.cancel(dropped.id)).toBe(true);
    expect(first.prompts.cancel(dropped.id)).toBe(false);
    first.prompts.close();

    expect(existsSync(join(stateDir, "scheduled-prompts.json"))).toBe(true);
    const reopened = store({ stateDir });
    expect(reopened.prompts.list("p1").map((row) => row.text)).toEqual(["keep"]);
    reopened.prompts.close();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("survives a half-written file, keeping the rows it can read", () => {
    const stateDir = mkdtempSync(join(tmpdir(), "herdr-scheduled-"));
    const first = store({ stateDir });
    first.prompts.add({ paneId: "p1", text: "keep", sendAt: NOW + 60_000 });
    first.prompts.close();
    const path = join(stateDir, "scheduled-prompts.json");
    const stored = JSON.parse(readFileSync(path, "utf8")) as { prompts: unknown[] };
    stored.prompts.push({ id: "broken", send_at: "soon" });
    writeFileSync(path, JSON.stringify(stored));
    const reopened = store({ stateDir });
    expect(reopened.prompts.list("p1")).toHaveLength(1);
    reopened.prompts.close();
    rmSync(stateDir, { recursive: true, force: true });
  });
});

