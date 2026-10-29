import { useEffect, useState } from "react";
import { useHerdrUpdate } from "../lib/herdrUpdate.ts";
import { runningHerdrVersion } from "../lib/runningVersion.ts";
import { lazyChunkFailed, onLazyChunkFailure } from "../lib/lazyChunk.ts";
import "./UpdateControls.css";

import { Button } from "../lib/heroui/orbit-components.tsx";
import { useT } from "../lib/i18n.ts";

/**
 * herdr itself. `herdr update` typed into a pane is refused by herdr, and every terminal here is
 * a pane: the server runs it instead and moves the running panes onto the new version.
 */
export function HerdrUpdateControls({ enabled, herdrVersion }: { enabled: boolean; herdrVersion: string | null }) {
  const t = useT();
  const { status, error, busy, request } = useHerdrUpdate(enabled);
  const version = runningHerdrVersion(status, herdrVersion);
  // Windows, an older server, a herdr that does not answer: nothing to offer, and the version
  // the health check reported is still read here, since the sidebar no longer carries it
  if (!status?.supported) {
    return version ? <section className="settings-section settings-herdr-update">
      <h3>herdr</h3>
      <div className="settings-card"><p className="settings-item settings-hint">{t("Running herdr {version}", { version })}</p></div>
    </section> : null;
  }
  const stale = status.stale && !!status.binary_version && !!status.server_version;
  return <section className="settings-section settings-herdr-update">
    <h3>herdr</h3>
    <div className="settings-card"><div className="settings-item">
    {version && <p className="settings-hint">{t("Running herdr {version}", { version })}</p>}
    {stale && <p className="settings-hint">{t("herdr {installed} is installed, but the running server is {running}. Updating moves your panes onto the installed version.", { installed: status.binary_version ?? "", running: status.server_version ?? "" })}</p>}
    <p className="settings-hint">{t("Installs the newest herdr on the PC this app runs on and moves its running panes onto it. Panes and agents keep running, and open terminals reconnect.")}</p>
    <div className="update-actions">
      <Button type="button" variant={stale ? "primary" : "secondary"} disabled={busy} onClick={() => void request()}>{t("Update herdr")}</Button>
    </div>
    {(error || busy) && <p className="settings-hint" role="status">{error ?? t("Updating herdr…")}</p>}
    {/* herdr's own words: what it installed, or why it did not */}
    {!busy && status.output && <pre className="update-output" data-failed={status.phase === "error" || undefined}>{status.output}</pre>}
    </div></div>
  </section>;
}

/**
 * The reload line alone, for a page without the update model: the markdown reader tab
 * (FileReader). A part of the app that failed to load there (lib/lazyChunk.ts) leaves math as its
 * source or a diagram as code until a reload, which this line offers. No status is polled.
 */
export function ChunkFailureNotice() {
  const t = useT();
  const [failed, setFailed] = useState(lazyChunkFailed);
  // subscribed first, then read: a failure between the first render and the subscription is kept
  useEffect(() => { const stop = onLazyChunkFailure(() => setFailed(true)); setFailed(lazyChunkFailed()); return stop; }, []);
  if (!failed) return null;
  return <div className="update-notice is-line is-warning" role="status">
    <span>{t("Part of the app could not load. Save unsent drafts, then reload.")}</span>
    <Button type="button" variant="secondary" onClick={() => window.location.reload()}>{t("Reload app")}</Button>
  </div>;
}
