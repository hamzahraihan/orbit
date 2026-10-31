import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Machine } from "../../shared/machines.ts";
import { SettingsProvider } from "../lib/settings.ts";
import { MachineSidebar } from "./MachineSidebar.tsx";

const machine = (extra: Partial<Machine> = {}): Machine => ({
  id: "local",
  name: "workstation",
  kind: "local",
  enabled: true,
  state: "connected",
  error: null,
  snapshot: null,
  ...extra,
});

function render(machines: Machine[]): string {
  return renderToStaticMarkup(
    createElement(SettingsProvider, {
      children: createElement(MachineSidebar, {
        machines,
        selectedMachineId: "local",
        selectedPaneId: null,
        actions: {
          selectPane: () => {},
          openNewSession: () => {},
          reconnect: () => Promise.resolve(),
        } as never,
        onSelect: () => {},
        onNew: () => {},
        onSetup: () => {},
      }),
    })
  );
}

describe("MachineSidebar", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "window");
  const savedLanguages = Object.getOwnPropertyDescriptor(navigator, "languages");
  beforeEach(() => {
    Object.defineProperty(globalThis, "window", { configurable: true, value: { matchMedia: () => ({ matches: false }) } });
    Object.defineProperty(navigator, "languages", { configurable: true, value: ["en"] });
  });
  afterEach(() => {
    if (saved) Object.defineProperty(globalThis, "window", saved);
    else Reflect.deleteProperty(globalThis, "window");
    if (savedLanguages) Object.defineProperty(navigator, "languages", savedLanguages);
    else Reflect.deleteProperty(navigator, "languages");
  });

  test("renders without error and draws machine monogram with status", () => {
    const html = render([machine({ name: "MacBook-Air", state: "connected" })]);
    expect(html).toContain("MacBook-Air");
    expect(html).toContain("workspace-monogram");
    expect(html).toContain("MA");
    expect(html).toContain('data-status="idle"');
  });

  test("draws status on connecting machine", () => {
    const html = render([machine({ name: "remote-srv", kind: "ssh", state: "connecting" })]);
    expect(html).toContain("remote-srv");
    expect(html).toContain("RS");
    expect(html).toContain('data-status="waiting"');
  });
});
