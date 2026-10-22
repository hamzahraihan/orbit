/**
 * herdr itself, updated from the app (server/herdr-update.ts): the server runs
 * `herdr update --handoff` for the herdr it talks to, on its own PC.
 *
 * The app's own update checks are gone: Orbit has no release channel, it is updated by pulling
 * this repository. What is left here is the herdr self-update, which is not the app's business.
 */
export interface HerdrUpdateStatus {
  /** false where the server offers no herdr update (Windows, a herdr that does not answer): the controls stay hidden */
  supported: boolean;
  phase: "idle" | "updating" | "error";
  /** the running herdr server, and the herdr binary installed beside it */
  server_version: string | null;
  binary_version: string | null;
  /** the installed binary is newer than the running server: an update moves the panes onto it */
  stale: boolean;
  /** what herdr printed on the last run, its tail; null before any run and while one runs */
  output: string | null;
  finished_at: string | null;
}
