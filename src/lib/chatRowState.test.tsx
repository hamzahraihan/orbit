import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createElement, type ReactElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ChatDetails, ChatRowMemoryContext, useChatRowToggle, type ChatRowMemory } from "./chatRowState.tsx";

const memory = (): ChatRowMemory => ({ toggles: new Map(), outputs: new Map() });

/** a row whose only state is the fold the reader (or the setting) left it in */
function Row({ initial }: { initial: boolean | null }) {
  const [open, setOpen] = useChatRowToggle("row", initial);
  return createElement("button", { "data-open": String(open), onClick: () => setOpen(!(open === true)) });
}

function row(store: ChatRowMemory, initial: boolean | null) {
  return <ChatRowMemoryContext.Provider value={store}><Row initial={initial} /></ChatRowMemoryContext.Provider>;
}

const shown = (renderer: ReactTestRenderer): string => renderer.root.findByType("button").props["data-open"] as string;

/** react-test-renderer's `create` renders on mount: act flushes what the hook reads then */
function render(element: ReactElement): ReactTestRenderer {
  let mounted: ReactTestRenderer | undefined;
  act(() => { mounted = create(element); });
  if (mounted === undefined) throw new Error("create returned no renderer");
  return mounted;
}

describe("a chat row's fold", () => {
  beforeEach(() => Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(() => Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", undefined));

  it("follows a default that changes under it, until the reader chooses for itself", () => {
    const store = memory();
    const renderer = render(row(store, false));
    expect(shown(renderer)).toBe("false");
    // the setting turns on: a row already drawn follows, not only one mounted after it
    act(() => renderer.update(row(store, true)));
    expect(shown(renderer)).toBe("true");
    // the reader folds it: that choice outlives the setting it came from
    act(() => renderer.root.findByType("button").props.onClick());
    expect(shown(renderer)).toBe("false");
    act(() => renderer.update(row(store, true)));
    expect(shown(renderer)).toBe("false");
    act(() => renderer.unmount());
  });

  it("keeps the reader's choice when the row leaves and comes back", () => {
    const store = memory();
    const first = render(row(store, false));
    act(() => first.root.findByType("button").props.onClick());
    expect(shown(first)).toBe("true");
    act(() => first.unmount());
    const again = render(row(store, false));
    expect(shown(again)).toBe("true");
    act(() => again.unmount());
  });
});

describe("a native chat disclosure", () => {
  beforeEach(() => Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true));
  afterEach(() => Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", undefined));

  it("opens on initialOpen and stays folded without it", () => {
    const closed = render(<ChatRowMemoryContext.Provider value={memory()}><ChatDetails memoryKey="a" className="x"><summary>s</summary></ChatDetails></ChatRowMemoryContext.Provider>);
    expect(closed.root.findByType("details").props.open).toBe(false);
    act(() => closed.unmount());
    const opened = render(<ChatRowMemoryContext.Provider value={memory()}><ChatDetails memoryKey="b" initialOpen className="x"><summary>s</summary></ChatDetails></ChatRowMemoryContext.Provider>);
    expect(opened.root.findByType("details").props.open).toBe(true);
    act(() => opened.unmount());
  });
});