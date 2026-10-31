import { expect, test } from "bun:test";
import { workspaceMonogram } from "./WorkspaceMonogram.tsx";

test("workspaceMonogram extracts 2 letters from various label styles", () => {
  expect(workspaceMonogram("orbit")).toBe("OR");
  expect(workspaceMonogram("herdr-plugins")).toBe("HP");
  expect(workspaceMonogram("auth_service")).toBe("AS");
  expect(workspaceMonogram("web-ui-client")).toBe("WU");
  expect(workspaceMonogram("api")).toBe("AP");
  expect(workspaceMonogram("X")).toBe("X");
  expect(workspaceMonogram("")).toBe("WS");
});
