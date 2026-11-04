import { describe, expect, it, spyOn } from "bun:test";
import { agentLaunch } from "./agent-launch.ts";
import * as herdr from "./herdr/client.ts";
import { HerdrError } from "./herdr/client.ts";

describe("agentLaunch name collision retry", () => {
  it("retries on agent_name_taken when name not explicit", async () => {
    const spy = spyOn(herdr, "agentStart");
    let callCount = 0;
    spy.mockImplementation(async (params: { name: string }) => {
      callCount++;
      if (callCount <= 2) {
        throw new HerdrError("agent_name_taken", "name taken");
      }
      return { type: "agent_started", agent: { name: params.name } };
    });

    const result = await agentLaunch("pane-1", { kind: "claude" });

    expect(result).toEqual({ agent_started: true });
    expect(callCount).toBe(3); // initial + 2 retries
    expect(spy).toHaveBeenCalledTimes(3);
    spy.mockRestore();
  });

  it("does not retry when name is explicitly given", async () => {
    const spy = spyOn(herdr, "agentStart");
    let callCount = 0;
    spy.mockImplementation(async (params: { name: string }) => {
      callCount++;
      throw new HerdrError("agent_name_taken", "name taken");
    });

    const result = await agentLaunch("pane-1", { kind: "claude", name: "my-claude" });

    expect(result).toEqual({
      agent_started: false,
      error: { code: "agent_name_taken", message: "name taken" },
    });
    expect(callCount).toBe(1); // no retry when name is given
    spy.mockRestore();
  });
});