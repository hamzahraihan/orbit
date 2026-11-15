import { createContext, useCallback, useContext, useReducer, type ComponentProps } from "react";

/** State belongs to a logical row, not to a virtualizer container. */
export interface ChatRowMemory {
  readonly toggles: Map<string, boolean | null>;
  readonly outputs: Map<string, string>;
}

export const ChatRowMemoryContext = createContext<ChatRowMemory | null>(null);

/**
 * Whether the chat's folded detail starts open (Settings → Chat → Unfold agent detail). A context
 * of its own, so the memoized turn list does not re-render for a setting only the folds below it
 * read — every consumer of it does, and the turn itself does not.
 */
export const ChatDetailOpenContext = createContext(false);

/** Whether the folds drawn under this row start open on their own. */
export function useChatDetailOpen(): boolean {
  return useContext(ChatDetailOpenContext);
}

export function useChatRowToggle(key: string, initial: boolean | null) {
  const memory = useContext(ChatRowMemoryContext);
  // The value lives in the memory map rather than this state, so a row can follow a changing
  // `initial` until the user chooses for itself; a bump is all the re-render that needs.
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const update = useCallback((next: boolean | null) => {
    memory?.toggles.set(key, next);
    rerender();
  }, [key, memory]);
  // A row with no choice of its own follows `initial` as it changes: opening the setting above
  // opens the rows already drawn, not only the ones mounted after it.
  const value = memory?.toggles.has(key) === true ? memory.toggles.get(key) ?? null : initial;
  return [value, update] as const;
}

/** Native disclosures retain their open state when their row leaves the DOM. */
export function ChatDetails({ memoryKey, initialOpen = false, onToggle, ...props }: ComponentProps<"details"> & { memoryKey: string; initialOpen?: boolean }) {
  const [open, setOpen] = useChatRowToggle(memoryKey, initialOpen);
  return <details {...props} open={open === true} onToggle={(event) => {
    setOpen(event.currentTarget.open);
    onToggle?.(event);
  }} />;
}
