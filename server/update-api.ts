/**
 * The only thing left in this file: whether an update POST came from this app's own controls.
 * The app's own update checks are gone (Orbit has no release channel), but the herdr self-update
 * posts through here, so the guard stays.
 *
 * A custom header is not submit-able by an HTML form. Cross-origin preflights are refused
 * (no CORS headers); Sec-Fetch-Site also rejects browser CSRF.
 */
export function updateRequestAllowed(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  let sameHost = true;
  try { if (origin) sameHost = new URL(origin).host === url.host; } catch { sameHost = false; }
  return request.headers.get("x-herdr-update") === "1" && sameHost && (site === null || site === "same-origin") && !url.search;
}
