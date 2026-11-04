import { describe, expect, it } from "bun:test";

import type { ConversationTurn, HerdrPane } from "../shared/protocol.ts";
import { searchConversations, searchTurns, snippetAround, turnMatch, turnProse } from "./conversation-search.ts";

const turn = (role: "user" | "assistant", text: string, ts: string | null = null): ConversationTurn => ({ role, ts, parts: [{ kind: "text", text }] });
const pane = (paneId: string, agent: string | null = "claude"): HerdrPane => ({
  pane_id: paneId,
  agent,
  agent_status: "ready",
  workspace_id: "w1",
  tab_id: "w1:t1",
  terminal_id: `t-${paneId}`,
  focused: false,
  revision: 1,
});

describe("conversation search", () => {
  it("searches what was said, never tool calls or reasoning", () => {
    const mixed: ConversationTurn = {
      role: "assistant",
      ts: null,
      parts: [
        { kind: "thinking", text: "maybe the export button" },
        { kind: "text", text: "Rate-limited the export button." },
        { kind: "tool", name: "Bash", summary: "rg export", input: "", output: "src/export.ts" },
      ],
    };
    expect(turnProse(mixed)).toBe("Rate-limited the export button.");
    expect(turnMatch(mixed, "export", "w1:p1", 0)?.snippet).toBe("Rate-limited the export button.");
    expect(turnMatch(mixed, "src/export.ts", "w1:p1", 0)).toBeNull();
    expect(turnMatch({ role: "assistant", ts: null, parts: [{ kind: "tool", name: "Bash", summary: "bun test", input: "", output: "ok" }] }, "bun", "w1:p1", 0)).toBeNull();
  });

  it("matches without case and reports the page and turn it came from", () => {
    const found = turnMatch(turn("user", "Make POST /payments idempotent.", "2026-11-03T10:00:00Z"), "post /PAYMENTS", "w1:p1", 4, 2);
    expect(found).toEqual({
      pane_id: "w1:p1",
      page: 2,
      turn: 4,
      role: "user",
      ts: "2026-11-03T10:00:00Z",
      snippet: "Make POST /payments idempotent.",
    });
  });

  it("keeps a line around the match, flattened, with … where it was cut", () => {
    const long = `${"a ".repeat(80)}the idempotency key${" b".repeat(80)}`;
    const at = long.indexOf("idempotency");
    const snippet = snippetAround(long, at, "idempotency".length);
    expect(snippet.startsWith("…")).toBe(true);
    expect(snippet.endsWith("…")).toBe(true);
    expect(snippet).toContain("the idempotency key");
    expect(snippet).not.toContain("\n");
    expect(snippet).not.toContain("  ");
    // a short turn is shown whole, without either ellipsis
    expect(snippetAround("short and sweet", 6, 3)).toBe("short and sweet");
  });

  it("takes the newest turns first, one match each, up to the pane's share", () => {
    const turns = [turn("user", "add a metric"), turn("assistant", "added the metric"), turn("user", "unrelated"), turn("assistant", "the metric again")];
    expect(searchTurns(turns, "metric", "w1:p1", 2)).toEqual([
      { pane_id: "w1:p1", page: 0, turn: 3, role: "assistant", ts: null, snippet: "the metric again" },
      { pane_id: "w1:p1", page: 0, turn: 1, role: "assistant", ts: null, snippet: "added the metric" },
    ]);
  });

  it("reads every chat pane, skips shells, and dates the matches newest first", async () => {
    const pages: Record<string, ConversationTurn[]> = {
      "w1:p1": [turn("user", "the export button twice", "2026-11-03T09:00:00Z")],
      "w1:p2": [turn("assistant", "export is guarded", "2026-11-03T11:00:00Z")],
    };
    const answer = await searchConversations({
      panes: [pane("w1:p1"), pane("w1:p2", "codex"), pane("w1:p3", null)],
      query: "export",
      limit: 12,
      read: async (paneId) => ({ turns: pages[paneId] ?? [] }),
    });
    expect(answer.matches.map((match) => match.pane_id)).toEqual(["w1:p2", "w1:p1"]);
    expect(answer.unavailable).toBe(0);
  });

  it("walks past the newest page for an older turn, numbering the page it came from", async () => {
    const pages = [
      { turns: [turn("user", "start")], cursor: "c1" },
      { turns: [turn("user", "nothing here")], cursor: "c2" },
      { turns: [turn("user", "the export from Monday"), turn("assistant", "export guarded")], cursor: null },
    ];
    const read = async (_paneId: string, before?: string) => {
      if (before === undefined) return pages[0]!;
      if (before === "c1") return pages[1]!;
      if (before === "c2") return pages[2]!;
      throw new Error(`unexpected cursor ${before}`);
    };
    const answer = await searchConversations({ panes: [pane("w1:p1")], query: "export", limit: 12, pages: 20, read });
    expect(answer.matches.map((match) => [match.page, match.turn, match.snippet])).toEqual([
      [2, 1, "export guarded"],
      [2, 0, "the export from Monday"],
    ]);
    expect(answer.unavailable).toBe(0);
  });

  it("opens one reader per pane and reuses it for every page of the walk", async () => {
    const opened: string[] = [];
    const reads: string[] = [];
    const timings: { pages: number; panes: number; elapsedMs: number }[] = [];
    const pages = [
      { turns: [turn("user", "start")], cursor: "c1" },
      { turns: [turn("user", "nothing here")], cursor: "c2" },
      { turns: [turn("user", "the export from Monday"), turn("assistant", "export guarded")], cursor: null },
    ];
    const answer = await searchConversations({
      panes: [pane("w1:p1"), pane("w1:p2", "codex")],
      query: "export",
      limit: 12,
      pages: 4,
      onTiming: (timing) => timings.push(timing),
      open: async (paneId) => {
        opened.push(paneId);
        return async (before?: string) => {
          reads.push(`${paneId}:${before ?? "newest"}`);
          return pages[before === undefined ? 0 : before === "c1" ? 1 : 2]!;
        };
      },
    });
    expect(opened.sort()).toEqual(["w1:p1", "w1:p2"]);
    expect(reads).toHaveLength(6);
    expect(timings).toHaveLength(1);
    expect(timings[0]).toMatchObject({ pages: 6, panes: 2 });
    expect(timings[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(answer.matches.map((match) => [match.pane_id, match.page])).toEqual([
      ["w1:p1", 2], ["w1:p1", 2], ["w1:p2", 2], ["w1:p2", 2],
    ]);
  });

  it("stops at the page limit, and at the newest page unless a deeper walk is asked for", async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return { turns: [turn("user", "nothing")], cursor: `c${reads}` };
    };
    await searchConversations({ panes: [pane("w1:p1")], query: "missing", limit: 12, pages: 3, read });
    expect(reads).toBe(3);
    reads = 0;
    await searchConversations({ panes: [pane("w1:p1")], query: "missing", limit: 12, read });
    expect(reads).toBe(1);
  });

  it("keeps the newer pages' matches when an older page cannot be read, without calling the pane unavailable", async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      if (reads === 2) throw new Error("history changed");
      return { turns: [turn("user", "export from the first page")], cursor: "c1" };
    };
    const answer = await searchConversations({ panes: [pane("w1:p1")], query: "export", limit: 12, pages: 20, read });
    expect(answer.matches.map((match) => match.snippet)).toEqual(["export from the first page"]);
    expect(answer.unavailable).toBe(0);
  });

  it("stops walking when the request that asked for it is aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let reads = 0;
    const answer = await searchConversations({
      panes: [pane("w1:p1")],
      query: "export",
      limit: 12,
      pages: 20,
      signal: controller.signal,
      read: async () => { reads += 1; return { turns: [turn("user", "export")], cursor: "c1" }; },
    });
    expect(reads).toBe(0);
    expect(answer.matches).toEqual([]);
  });

  it("counts a pane that cannot be read instead of failing the search", async () => {
    const answer = await searchConversations({
      panes: [pane("w1:p1"), pane("w1:p2")],
      query: "export",
      limit: 12,
      read: async (paneId) => {
        if (paneId === "w1:p2") throw new Error("no session yet");
        return { turns: [turn("user", "export", "2026-11-03T09:00:00Z")] };
      },
    });
    expect(answer.matches.map((match) => match.pane_id)).toEqual(["w1:p1"]);
    expect(answer.unavailable).toBe(1);
  });

  it("stops at the asked limit", async () => {
    const answer = await searchConversations({
      panes: ["w1:p1", "w1:p2", "w1:p3"].map((id) => pane(id)),
      query: "export",
      limit: 2,
      read: async (paneId) => ({ turns: [turn("user", `export from ${paneId}`, "2026-11-03T09:00:00Z")] }),
    });
    expect(answer.matches).toHaveLength(2);
  });
});
