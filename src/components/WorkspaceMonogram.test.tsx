import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { workspaceMonogram } from "./WorkspaceMonogram.tsx";
import { WorkspaceMonogram } from "./WorkspaceMonogram.tsx";

test("workspaceMonogram extracts 2 letters from various label styles", () => {
  expect(workspaceMonogram("orbit")).toBe("OR");
  expect(workspaceMonogram("herdr-plugins")).toBe("HP");
  expect(workspaceMonogram("auth_service")).toBe("AS");
  expect(workspaceMonogram("web-ui-client")).toBe("WU");
  expect(workspaceMonogram("api")).toBe("AP");
  expect(workspaceMonogram("X")).toBe("X");
  expect(workspaceMonogram("")).toBe("WS");
});

test("WorkspaceMonogram colors stroke and text by agent status", () => {
  const working = renderToStaticMarkup(<WorkspaceMonogram label="auth-service" status="working" />);
  const blocked = renderToStaticMarkup(<WorkspaceMonogram label="auth-service" status="blocked" />);
  expect(working).toContain("workspace-monogram--working");
  expect(working).toContain('aria-busy="true"');
  expect(blocked).toContain("workspace-monogram--blocked");
  expect(blocked).not.toContain('aria-busy="true"');
  const idle = renderToStaticMarkup(<WorkspaceMonogram label="orbit" status="idle" />);
  expect(idle).toContain("workspace-monogram--idle");
});
