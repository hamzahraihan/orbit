import { describe, expect, it, spyOn } from "bun:test";
import { agentLaunch } from "./agent-launch.ts";
import * as herdr from "./herdr/client.ts";
import { HerdrError } from "./herdr/client.ts";

describe("agentLaunch busy pane retry", () => {
  it("retries on agent_pane_busy until 10s deadline then fails", async () => {
    const startSnapshot = spyOn(herdr, "sessionSnapshot").mockImplementation(async () => ({
      agents: [],
      panes: [],
      tabs: [],
      workspaces: [],
      layouts: [],
      protocol: 1,
      version: "test",
    }));

    const startAgent = spyOn(herdr, "agentStart");
    let callCount = 0;
    const start = Date.now();

    startAgent.mockImplementation(async () => {
      callCount++;
      // Throw agent_pane_busy for first ~150ms, then succeed
      if (Date.now() - start < 150) {
        throw new HerdrError("agent_pane_busy", "pane is busy");
      }
      return { type: "agent_started", agent: { name: "claude" } };
    });

    const result = await agentLaunch("pane-1", { kind: "claude" });

    // Should eventually succeed after retries
    expect(result).toEqual({ agent_started: true });
    expect(callCount).toBeGreaterThan(1);
    // Should respect the 10s deadline (but finish much earlier in this test)
    expect(Date.now() - start).toBeLessThan(11000);

    startSnapshot.mockRestore();
    startAgent.mockRestore();
  });

  it("fails when agent_pane_busy persists past 10s deadline", async () => {
    const startSnapshot = spyOn(herdr, "sessionSnapshot").mockImplementation(async () => ({
      agents: [],
      panes: [],
      tabs: [],
      workspaces: [],
      layouts: [],
      protocol: 1,
      version: "test",
    }));

    const startAgent = spyOn(herdr, "agentStart");
    let callCount = 0;

    startAgent.mockImplementation(async () => {
      callCount++;
      // Always throw agent_pane_busy
      throw new HerdrError("agent_pane_busy", "pane is busy");
    });

    const result = await agentLaunch("pane-1", { kind: "claude" });

    // Should fail after deadline
    expect(result).toEqual({
      agent_started: false,
      error: { code: "agent_pane_busy", message: "pane is busy" },
    });
    // Should have retried multiple times within ~10s (100ms intervals = ~100 attempts)
    expect(callCount).toBeGreaterThan(50);
    expect(callCount).toBeLessThan(150);

    startSnapshot.mockRestore();
    startAgent.mockRestore();
  });
});