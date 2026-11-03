/**
 * The palette's conversation searches, newest first, kept in this browser. They span PCs: a
 * search is a phrase, not a place, and the same list is offered whichever PC is selected.
 */
export const RECENT_SEARCHES_KEY = "herdr-web-ui:recent-searches";
export const RECENT_SEARCHES_SHOWN = 5;
/** shorter than the palette's own conversation search (2 characters): not a search yet */
export const RECENT_SEARCH_MIN_CHARS = 2;
/** the server refuses a longer query, so a stored one that long would only fail again */
export const RECENT_SEARCH_MAX_CHARS = 200;

/** The stored list, cleaned: strings only, trimmed, no repeats (case-insensitive), newest kept. */
export function loadRecentSearches(read: (key: string) => string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(read(RECENT_SEARCHES_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const searches: string[] = [];
    for (const value of parsed) {
      if (typeof value !== "string") continue;
      const query = value.trim().slice(0, RECENT_SEARCH_MAX_CHARS);
      const key = query.toLowerCase();
      if (query.length < RECENT_SEARCH_MIN_CHARS || seen.has(key)) continue;
      seen.add(key);
      searches.push(query);
      if (searches.length === RECENT_SEARCHES_SHOWN) break;
    }
    return searches;
  } catch {
    // unavailable or malformed storage: this page starts with no history
    return [];
  }
}

/** The list without `query` (however it is cased), keeping the order of the rest. */
export function forgetRecentSearch(query: string, current: readonly string[]): string[] {
  const key = query.trim().toLowerCase();
  return current.filter((entry) => entry.toLowerCase() !== key);
}

/** The list with `query` first, a repeat removed from where it stood, capped for the palette. */
export function rememberRecentSearch(query: string, current: readonly string[]): string[] {
  const trimmed = query.trim().slice(0, RECENT_SEARCH_MAX_CHARS);
  if (trimmed.length < RECENT_SEARCH_MIN_CHARS) return [...current];
  const key = trimmed.toLowerCase();
  return [trimmed, ...current.filter((entry) => entry.toLowerCase() !== key)].slice(0, RECENT_SEARCHES_SHOWN);
}
