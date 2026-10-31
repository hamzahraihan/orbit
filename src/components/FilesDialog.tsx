import { useEffect, useRef, useState, type ReactNode } from "react";
import { FolderSearch, X } from "lucide-react";

import "./FilesDialog.css";
import { DirectoryBrowser } from "./DirectoryBrowser.tsx";
import { RepoChanges } from "./RepoChanges.tsx";
import type { RepoDiffFile } from "../../shared/protocol.ts";
import { useT } from "../lib/i18n.ts";
import type { RepoComparison } from "../lib/repoDiff.ts";
import { nativeModalOver, useFocusTrap } from "../lib/useFocusTrap.ts";
import { useSheetSwipe } from "../lib/sheets.ts";
import { usePhoneSheetBack } from "../lib/sheetHistory.ts";
import { useMediaQuery } from "../lib/useMediaQuery.ts";

export interface FilesDialogProps {
  /** the folder to open at: the pane's own */
  start: string;
  /** the pane whose repository's changes are listed */
  paneId: string;
  /** a file or a diff is open above this dialog: Escape belongs to it, which closes first */
  viewing: boolean;
  onOpenFile: (path: string) => void;
  onOpenDiff: (comparison: RepoComparison, file: RepoDiffFile) => void;
  /** the command palette, already browsing this folder (it opens above this dialog) */
  onBrowseFolders: (path: string) => void;
  onClose: () => void;
  /** a column beside the pane (a wide window), not a dialog over it: the pane stays usable */
  docked?: boolean;
  /** drawn first in the docked column, before the browser (its resize edge) */
  panelStart?: ReactNode;
}

type Tab = "browse" | "changes";

/**
 * The files of the pane's folder (and any other), each opened in the file viewer, and the changes
 * of its repository, each opened as a diff: a column beside the pane on a wide window, where the
 * docked file panel is, and a dialog over the pane below that.
 */
export function FilesDialog({ start, paneId, viewing, onOpenFile, onOpenDiff, onBrowseFolders, onClose, docked = false, panelStart }: FilesDialogProps) {
  const t = useT();
  const phone = useMediaQuery("(max-width: 480px)");
  // docked, the rest of the page stays reachable: no trap, and no sheet on a phone (there is no panel there)
  const surface = useFocusTrap<HTMLElement>(!docked);
  const [tab, setTab] = useState<Tab>("browse");
  // the changes are read with the first visit and kept, as the browser keeps its folder
  const [changesVisited, setChangesVisited] = useState(false);
  useSheetSwipe(surface, docked ? null : onClose);
  // a file opened from the list is drawn over it with an entry of its own: Back closes the file first
  usePhoneSheetBack(onClose, !viewing);
  useEffect(() => {
    if (viewing) return;
    // a native modal over it (Add PC, from the palette) takes its own Escape; docked, the pane
    // beside it is live, so Escape there is the terminal's and only one inside the panel closes it
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || nativeModalOver(surface.current)) return;
      if (docked && !surface.current?.contains(document.activeElement)) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, viewing, docked]);
  const show = (next: Tab): void => {
    setTab(next);
    if (next === "changes") setChangesVisited(true);
  };
  // the folder the browser shows now (it tells each one it opens), for the pane it showed it for;
  // else the one the dialog opened at
  const folder = useRef<{ pane: string; path: string } | null>(null);
  const browseFolders = (): void => onBrowseFolders(folder.current?.pane === paneId ? folder.current.path : (start || "~"));
  const tabs = <div className="segmented files-dialog-tabs" role="group" aria-label={t("Show")}>
    <button type="button" aria-pressed={tab === "browse"} onClick={() => show("browse")}>{t("Browse")}</button>
    <button type="button" aria-pressed={tab === "changes"} onClick={() => show("changes")}>{t("Changes")}</button>
  </div>;
  const foldersButton = <button type="button" className="icon-button" aria-label={t("Browse folders in the palette")} title={t("Browse folders in the palette")} onClick={browseFolders}><FolderSearch aria-hidden="true" /></button>;
  const closeButton = <button type="button" className="icon-button" aria-label={t("Close files")} title={t("Close files")} onClick={onClose}><X aria-hidden="true" /></button>;
  // a pane switch (Next pane) keeps the dialog open: the browser starts over on the new pane's
  // folder, as Changes reads the new pane, instead of listing the pane it was opened on
  const body = <>
    <div className="files-dialog-tab" hidden={tab !== "browse"}><DirectoryBrowser key={paneId} start={start} onOpenFile={onOpenFile} onFolder={(path) => { folder.current = { pane: paneId, path }; }} /></div>
    {changesVisited && <div className="files-dialog-tab" hidden={tab !== "changes"}><RepoChanges paneId={paneId} directory={start} onOpenDiff={onOpenDiff} /></div>}
  </>;
  if (docked) return (
    <aside ref={surface} className="file-panel files-panel" aria-label={t("Files")}>
      {panelStart}
      {/* one row, as the docked viewer's header: the title, the two tabs, and the ways out */}
      <header className="files-panel-header">
        <h2 className="files-panel-title">{t("Files")}</h2>
        {tabs}
        {foldersButton}
        {closeButton}
      </header>
      <div className="files-panel-body">{body}</div>
    </aside>
  );
  return (
    <div className="modal-scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={surface} className="modal files-dialog" role="dialog" aria-modal="true" aria-labelledby="files-dialog-title" tabIndex={-1}>
        <header className="modal-header">
          <h2 className="modal-title" id="files-dialog-title">{t("Files")}</h2>
          {tabs}
          {!phone && foldersButton}
          {closeButton}
        </header>
        <div className="modal-body">{body}</div>
      </section>
    </div>
  );
}
