import { describe, expect, it } from "bun:test";
import type { Terminal } from "@xterm/xterm";
import { attachTerminalWheel } from "./terminalWheel.ts";
import { HERDR_MOUSE_SCROLL_LINES } from "./wheelSteps.ts";

function fakeTerminal(options: { mouseTrackingMode?: string; hasSelection?: boolean } = {}) {
  let handler: ((event: WheelEvent) => boolean) | null = null;
  let clearedSelection = false;
  return {
    modes: { mouseTrackingMode: options.mouseTrackingMode ?? "none" },
    hasSelection: () => options.hasSelection ?? false,
    clearSelection: () => { clearedSelection = true; },
    get clearedSelection() { return clearedSelection; },
    attachCustomWheelEventHandler: (fn: (event: WheelEvent) => boolean) => {
      handler = fn;
    },
    triggerWheel: (event: Partial<WheelEvent>) => {
      if (!handler) throw new Error("No wheel handler attached");
      return handler({
        deltaY: 0,
        deltaX: 0,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        metaKey: false,
        isTrusted: true,
        preventDefault: () => {},
        ...event,
      } as WheelEvent);
    },
  };
}

describe("attachTerminalWheel", () => {
  it("allows selecting drag to consume the wheel first", () => {
    const term = fakeTerminal();
    let dragCalled = false;
    attachTerminalWheel(
      term as unknown as Terminal,
      { current: { speed: 1, omoQuestion: false } },
      {
        drag: () => { dragCalled = true; return true; },
        observing: () => false,
        scroll: () => {},
      },
    );
    const handled = term.triggerWheel({ deltaY: -100 });
    expect(dragCalled).toBe(true);
    expect(handled).toBe(false);
  });

  it("suppresses shared scroll when observing (read-only observer)", () => {
    const term = fakeTerminal();
    let scrollCalls = 0;
    attachTerminalWheel(
      term as unknown as Terminal,
      { current: { speed: 1, omoQuestion: false } },
      {
        drag: () => false,
        observing: () => true,
        scroll: () => { scrollCalls++; },
      },
    );
    const handled = term.triggerWheel({ deltaY: -100 });
    expect(handled).toBe(false);
    expect(scrollCalls).toBe(0);
  });

  it("scrolls native history when mouse reporting is none (interactive shell/logs)", () => {
    const term = fakeTerminal({ mouseTrackingMode: "none" });
    const scrolls: number[] = [];
    let prevented = false;
    attachTerminalWheel(
      term as unknown as Terminal,
      { current: { speed: 2, omoQuestion: false } },
      {
        drag: () => false,
        observing: () => false,
        scroll: (lines) => { scrolls.push(lines); },
      },
    );
    // Scrolling up (negative deltaY) should scroll up into history (positive lines)
    const handledUp = term.triggerWheel({ deltaY: -120, preventDefault: () => { prevented = true; } });
    expect(prevented).toBe(true);
    expect(handledUp).toBe(false);
    expect(scrolls).toEqual([HERDR_MOUSE_SCROLL_LINES * 2]);

    // Scrolling down (positive deltaY) should scroll down towards bottom (negative lines)
    const handledDown = term.triggerWheel({ deltaY: 120 });
    expect(handledDown).toBe(false);
    expect(scrolls).toEqual([HERDR_MOUSE_SCROLL_LINES * 2, -HERDR_MOUSE_SCROLL_LINES * 2]);
  });

  it("scrolls native history when an OmO question is open even if mouse reporting is enabled", () => {
    const term = fakeTerminal({ mouseTrackingMode: "vt200" });
    const scrolls: number[] = [];
    attachTerminalWheel(
      term as unknown as Terminal,
      { current: { speed: 1, omoQuestion: true } },
      {
        drag: () => false,
        observing: () => false,
        scroll: (lines) => { scrolls.push(lines); },
      },
    );
    const handled = term.triggerWheel({ deltaY: -120 });
    expect(handled).toBe(false);
    expect(scrolls).toEqual([HERDR_MOUSE_SCROLL_LINES]);
  });

  it("forwards wheel reports when mouse reporting is active and no OmO question is open", () => {
    const term = fakeTerminal({ mouseTrackingMode: "vt200" });
    let scrollCalls = 0;
    attachTerminalWheel(
      term as unknown as Terminal,
      { current: { speed: 1, omoQuestion: false } },
      {
        drag: () => false,
        observing: () => false,
        scroll: () => { scrollCalls++; },
      },
    );
    const handled = term.triggerWheel({ deltaY: -120 });
    expect(handled).toBe(true);
    expect(scrollCalls).toBe(0);
  });

  it("ignores Ctrl+wheel (trackpad pinch-to-zoom) without scrolling history", () => {
    const term = fakeTerminal({ mouseTrackingMode: "none" });
    let scrollCalls = 0;
    attachTerminalWheel(
      term as unknown as Terminal,
      { current: { speed: 1, omoQuestion: false } },
      {
        drag: () => false,
        observing: () => false,
        scroll: () => { scrollCalls++; },
      },
    );
    const handled = term.triggerWheel({ deltaY: -120, ctrlKey: true });
    expect(handled).toBe(false);
    expect(scrollCalls).toBe(0);
  });
});
