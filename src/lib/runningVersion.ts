import type { HerdrUpdateStatus } from "../../shared/update.ts";

/**
 * The herdr version Settings prints: the running server's, else the installed binary's, else
 * the one the health check reported, which is all there is where herdr cannot be updated from
 * here (Windows, an older server, the demo).
 */
export function runningHerdrVersion(status: Pick<HerdrUpdateStatus, "server_version" | "binary_version"> | null, reported: string | null): string | null {
  return status?.server_version || status?.binary_version || reported || null;
}
