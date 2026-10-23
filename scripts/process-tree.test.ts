import { describe, expect, it } from "bun:test";
import { endProcessTree, processAlive } from "./process-tree.ts";

describe.skipIf(process.platform !== "win32")("Windows process trees", () => {
  it("ends a tree whose leader has already exited", async () => {
    const leader = Bun.spawn(
      [process.execPath, "-e", `const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], { detached: true, stdio: ["ignore", "ignore", "ignore"] }); child.unref(); console.log(child.pid);`],
      { detached: true, stdin: "ignore", stdout: "pipe", stderr: "ignore" },
    );
    const childPid = Number((await new Response(leader.stdout).text()).trim());
    await leader.exited;
    try {
      expect(processAlive(childPid)).toBe(true);
      expect(await endProcessTree(leader.pid, "SIGTERM", { graceMs: 5_000 })).toBe(true);
      expect(processAlive(childPid)).toBe(false);
    } finally {
      try {
        process.kill(childPid, "SIGKILL");
      } catch { /* already gone */ }
    }
  });

  it("ends a live leader and its children", async () => {
    const leader = Bun.spawn(
      [process.execPath, "-e", `const child = Bun.spawn([process.execPath, "-e", "setTimeout(() => {}, 30000)"], { stdio: ["ignore", "ignore", "ignore"] }); child.unref(); console.log(child.pid); setTimeout(() => {}, 30000);`],
      { detached: true, stdin: "ignore", stdout: "pipe", stderr: "ignore" },
    );
    const reader = leader.stdout.getReader();
    const first = await reader.read();
    const childPid = Number(new TextDecoder().decode(first.value).trim());
    try {
      expect(processAlive(leader.pid)).toBe(true);
      expect(await endProcessTree(leader.pid, "SIGTERM", { graceMs: 5_000 })).toBe(true);
      await leader.exited;
      expect(processAlive(leader.pid)).toBe(false);
      expect(processAlive(childPid)).toBe(false);
    } finally {
      reader.releaseLock();
      try {
        process.kill(childPid, "SIGKILL");
      } catch { /* already gone */ }
    }
  });
});

describe.skipIf(process.platform === "win32")("POSIX process groups", () => {
  it("ends a detached process group", async () => {
    const leader = Bun.spawn(["sh", "-c", "printf ready; sleep 30"], { detached: true, stdin: "ignore", stdout: "pipe", stderr: "ignore" });
    const reader = leader.stdout.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("ready");
    reader.releaseLock();
    expect(processAlive(leader.pid)).toBe(true);
    expect(await endProcessTree(leader.pid, "SIGTERM", { graceMs: 5_000 })).toBe(true);
    await leader.exited;
    expect(processAlive(leader.pid)).toBe(false);
  });
});
