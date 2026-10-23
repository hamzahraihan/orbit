import { describe, expect, it } from "bun:test";
import { isOrphan, isTestArtifact, isTestSession, planCleanup, type CleanupRow } from "./clean-processes.ts";

const row = (pid: number, parent: number, commandLine = "", image?: string): CleanupRow => ({ pid, parent, commandLine, ...(image ? { image } : {}) });

describe("isTestArtifact", () => {
  it("matches this project's test and check processes", () => {
    for (const command of [
      'bun.exe C:\\work\\orbit\\scripts\\check.ts run bun test',
      "bun scripts/ci-browser.sh",
      "bun scripts/ci-tests.ts unit",
      "bun scripts/demo-build.ts C:\\Temp\\herdr-demo",
      "node C:\\work\\orbit\\server\\pty\\pty-host.mjs",
      "bun scripts/ui-regression.ts",
      "bun scripts/sidebar-activity-demo-regression.ts",
      "bun scripts/chat-browser-qa.ts",
      'chrome.exe --user-data-dir=C:\\Temp\\playwright_chromiumdev_profile-abc --headless --remote-debugging-pipe',
    ]) expect(isTestArtifact(command)).toBe(true);
  });

  it("leaves a dev server, the app and the cleanup itself alone", () => {
    for (const command of [
      "bun run dev",
      "bun run server",
      "bun.exe C:\\work\\orbit\\server\\index.ts",
      "bun.exe C:\\work\\orbit\\server\\managed.ts",
      "bun scripts/clean-processes.ts",
      'chrome.exe --user-data-dir=C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data',
      "herdr server",
    ]) expect(isTestArtifact(command)).toBe(false);
  });
});

describe("isOrphan", () => {
  it("follows the parent chain Windows keeps after a parent exits", () => {
    const rows = [row(10, 20), row(20, 30), row(30, 0)];
    expect(isOrphan(rows, 10, true)).toBe(false);
    expect(isOrphan([row(10, 20), row(20, 30)], 10, true)).toBe(true);
    expect(isOrphan([row(10, 99)], 10, true)).toBe(true);
  });

  it("stops at a live process that owns the run, not at its own dead ancestor", () => {
    // explorer's launcher ended long ago (Windows keeps the number), but explorer owns the pane
    const rows = [row(10, 20, "bun scripts/ui-regression.ts", "bun.exe"), row(20, 30, "", "herdr.exe"), row(30, 40, "", "explorer.exe"), row(40, 99, "", "wininit.exe")];
    expect(isOrphan(rows, 10, true)).toBe(false);
  });

  it("treats a POSIX process reparented to init as lost", () => {
    expect(isOrphan([row(10, 1), row(1, 0)], 10, false)).toBe(true);
    expect(isOrphan([row(10, 20), row(20, 1), row(1, 0)], 10, false)).toBe(true);
    expect(isOrphan([row(10, 20), row(20, 0)], 10, false)).toBe(false);
  });
});

describe("planCleanup", () => {
  it("kills an orphaned run and its descendants, and leaves a live run alone", () => {
    const live = planCleanup([row(process.ppid, 0, "", "omp.exe"), row(20, process.ppid, "bun scripts/ci-browser.sh", "bun.exe")]);
    expect(live.active).toBe(true);
    expect(live.orphans).toEqual([]);

    // POSIX reparents a lost process to init; Windows keeps the dead parent's number
    const lostParent = process.platform === "win32" ? 99 : 1;
    const orphaned = planCleanup([
      row(20, lostParent, "bun scripts/ci-browser.sh"),
      row(21, 20, "bun scripts/ui-regression.ts"),
      row(22, 21, "bun helper.ts"),
    ]);
    expect(orphaned.active).toBe(false);
    expect(orphaned.orphans.map((entry) => entry.pid)).toEqual([20, 21, 22]);
  });

  it("never plans to kill itself or its ancestors", () => {
    const self = planCleanup([row(process.pid, 0, "bun scripts/check.ts"), row(process.ppid, process.pid, "bun scripts/ci-browser.sh")]);
    expect(self.orphans.map((entry) => entry.pid)).not.toContain(process.pid);
    expect(self.orphans.map((entry) => entry.pid)).not.toContain(process.ppid);
  });
});

describe("isTestSession", () => {
  it("names only this project's test sessions", () => {
    for (const name of ["herdr-web-ui-test", "herdr-web-ui-test-4", "herdr-web-ui-demo", "herdr-web-ui-task4-check", "orbit-docs-1", "orbit-recheck", "check-abcdef", "check-abcdef-2"]) {
      expect(isTestSession(name)).toBe(true);
    }
    for (const name of ["default", "herdr-web-ui-work", "orbit", "check-not-a-run"]) expect(isTestSession(name)).toBe(false);
  });
});
