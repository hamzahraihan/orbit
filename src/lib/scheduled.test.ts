import { describe, expect, it } from "bun:test";
import { ApiError } from "./api.ts";
import { failureNote, loadScheduled, pickedSendAt, presetSendAt, scheduleRefusal, scheduledWhen, type ScheduledPrompt } from "./scheduled.ts";

const t = (key: string, vars?: Record<string, string | number>): string =>
  Object.entries(vars ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), key);

describe("the moment a schedule means", () => {
  it("counts a preset's delay from now", () => {
    expect(presetSendAt(15 * 60_000, 1_000_000)).toBe(1_900_000);
    expect(presetSendAt(60 * 60_000, 1_000_000)).toBe(4_600_000);
  });

  it("means 9:00 tomorrow for the tomorrow preset, whatever the hour", () => {
    const lateTonight = new Date(2026, 10, 2, 23, 30).getTime();
    const at = new Date(presetSendAt("tomorrow", lateTonight));
    expect([at.getDate(), at.getHours(), at.getMinutes()]).toEqual([3, 9, 0]);
  });

  it("takes a typed clock as today, or tomorrow once today's has passed", () => {
    const morning = new Date(2026, 10, 2, 8, 0).getTime();
    expect(new Date(pickedSendAt("09:40", morning)!).getDate()).toBe(2);
    const evening = new Date(2026, 10, 2, 21, 0).getTime();
    expect(new Date(pickedSendAt("09:40", evening)!).getDate()).toBe(3);
    expect(pickedSendAt("", morning)).toBeNull();
    expect(pickedSendAt("24:00", morning)).toBeNull();
  });

  it("shows the clock time, and the whole moment as the tooltip", () => {
    const when = scheduledWhen(new Date(2026, 10, 2, 21, 40).getTime(), "en-US");
    expect(when.label).toMatch(/^(9:40|09:40)\s?PM$/);
    expect(when.full).toContain("2026");
  });

  it("says why a failed row failed, and nothing for a row that has not run", () => {
    expect(failureNote({ failure: "pane not found" }, t)).toBe("Couldn't send: pane not found");
    expect(failureNote({ failure: null }, t)).toBeNull();
  });
});

describe("a PC that keeps no schedules", () => {
  const row: ScheduledPrompt = { id: "s1", pane_id: "w1:p1", text: "hi", send_at: 1, created_at: 0, failure: null, held: null };

  it("reads as unsupported on a 404, and as failed on anything else", async () => {
    expect(await loadScheduled("local", "w1:p1", async () => [row])).toEqual({ kind: "rows", prompts: [row] });
    // an older remote bundle: server/index.ts answers an unknown path with this 404
    const stale = new ApiError("/api/machines/pc/pane/schedule", 404, "unknown endpoint /api/pane/schedule", "not_found");
    expect(await loadScheduled("pc", "w1:p1", async () => { throw stale; })).toEqual({ kind: "unsupported" });
    const offline = new ApiError("/api/machines/pc/pane/schedule", 503, "This PC is disconnected", "machine_offline");
    expect(await loadScheduled("pc", "w1:p1", async () => { throw offline; })).toEqual({ kind: "failed" });
  });

  it("is told to update rather than shown a raw endpoint error", () => {
    const stale = new ApiError("/api/machines/pc/pane/schedule", 404, "unknown endpoint /api/pane/schedule", "not_found");
    expect(scheduleRefusal(stale, t)).toBe("Update this PC to schedule a message.");
    // a refusal the server meant stays its own words
    const tooMany = new ApiError("/api/machines/pc/pane/schedule", 400, "this pane already has 20 messages lined up", "too_many");
    expect(scheduleRefusal(tooMany, t)).toBe("this pane already has 20 messages lined up");
    expect(scheduleRefusal(new TypeError("offline"), t)).toBe("Couldn't schedule that message");
  });
});
