import { describe, expect, it } from "bun:test";
import { handlePaneRequest } from "./pane-routes.ts";
import type { ScheduledPrompt, ScheduledPrompts } from "./scheduled-prompts.ts";

/** The store as the route sees it: the real one is tested in scheduled-prompts.test.ts. */
function fakeStore(rows: ScheduledPrompt[] = []): ScheduledPrompts & { cancelled: string[] } {
  const cancelled: string[] = [];
  return {
    cancelled,
    list: (paneId?: string) => paneId === undefined ? rows : rows.filter((row) => row.pane_id === paneId),
    add: ({ paneId, text, sendAt }) => text === "refuse"
      ? { error: "too_many" }
      : { id: "new", pane_id: paneId, text, send_at: sendAt, created_at: 0, failure: null, held: null },
    cancel: (id: string) => { cancelled.push(id); return id === "known"; },
    fire: async () => {},
    close: () => {},
  };
}

const call = async (path: string, init: RequestInit, store: ScheduledPrompts): Promise<Response> => {
  const url = new URL(`http://127.0.0.1${path}`);
  return (await handlePaneRequest(new Request(url, init), url, url.pathname, { scheduled: store }))!;
};

const row: ScheduledPrompt = { id: "known", pane_id: "p1", text: "run the tests", send_at: 2_000_000, created_at: 1_000_000, failure: null, held: null };

describe("/api/pane/schedule", () => {
  it("lists the rows of the pane it is asked about", async () => {
    const response = await call("/api/pane/schedule?pane_id=p1", {}, fakeStore([row]));
    expect(response.status).toBe(200);
    expect((await response.json() as { prompts: ScheduledPrompt[] }).prompts).toHaveLength(1);
  });

  it("takes a pane, its text and the moment, in epoch milliseconds", async () => {
    const response = await call("/api/pane/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane_id: "p1", text: "later", send_at: 2_000_000 }),
    }, fakeStore());
    expect(response.status).toBe(200);
    expect((await response.json() as { prompt: ScheduledPrompt }).prompt.text).toBe("later");
  });

  it("says what is missing rather than passing a guess on", async () => {
    const response = await call("/api/pane/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane_id: "p1", text: "later" }),
    }, fakeStore());
    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("missing_send_at");
  });

  it("passes a refusal of the store's back with its code", async () => {
    const response = await call("/api/pane/schedule", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pane_id: "p1", text: "refuse", send_at: 2_000_000 }),
    }, fakeStore());
    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("too_many");
  });

  it("cancels by id, and says so when there is no such row", async () => {
    const store = fakeStore([row]);
    const gone = await call("/api/pane/schedule?id=known", { method: "DELETE" }, store);
    expect(gone.status).toBe(200);
    expect(store.cancelled).toEqual(["known"]);
    const missing = await call("/api/pane/schedule?id=other", { method: "DELETE" }, store);
    expect(missing.status).toBe(404);
  });

  it("refuses a method it does not answer", async () => {
    const response = await call("/api/pane/schedule", { method: "PUT" }, fakeStore());
    expect(response.status).toBe(400);
  });

  it("says the server keeps no schedules when it has no store", async () => {
    const url = new URL("http://127.0.0.1/api/pane/schedule?pane_id=p1");
    const response = (await handlePaneRequest(new Request(url), url, url.pathname, {}))!;
    expect(response.status).toBe(404);
  });
});
