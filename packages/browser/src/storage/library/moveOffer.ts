// Offers to move this browser's papers into the library folder the bridge serves, counts them and runs the move.
import { countPapers, formatError, moveToFolder, type ILogger, type MoveResult } from "@labshelf/core";
import { renderElement, showToast } from "@labshelf/core/dom";
import { createBrowserLogger } from "../../platform";
import { IdbFileSystem } from "../idb";
import { readFolderFileSystem, readLibraryLocation, refreshStoredLibraryLocation } from "../libraryFileSystem";
import { refreshPaperRecords } from "../records";
import { createBannerShell, setButton } from "./shell";

const MODULE = "browser.storage.move";

/** Throws when the folder is not the library source; the paper cache is rebuilt from the folder either way. */
async function moveBrowserLibraryToFolder(): Promise<MoveResult> {
  const logger = createBrowserLogger();
  const source = await refreshStoredLibraryLocation();
  if (source.kind !== "folder") {
    throw new Error(`The library folder is not reachable (${source.reason}), so the browser library stays where it is`);
  }
  try {
    return await moveToFolder({ from: new IdbFileSystem(), to: readFolderFileSystem(), logger });
  } finally {
    await refreshPaperRecords(readFolderFileSystem(), logger).catch((error: unknown) => logger.error(MODULE, error, { op: "rebuildAfterMove" }));
  }
}

function countBrowserPapers(): Promise<number> {
  return countPapers(new IdbFileSystem());
}

export interface MoveOfferOptions {
  logger: ILogger;
  /** Runs after every move attempt, once the paper records are rebuilt, so the page can reload its snapshots. */
  onMoved(): void | Promise<void>;
}

export interface MoveOffer {
  /** Looks again at where the library lives and how many papers the browser still holds. */
  refresh(): Promise<void>;
}

const papers = (n: number): string => `${n} ${n === 1 ? "paper" : "papers"}`;

export function mountMoveOffer(host: HTMLElement, options: MoveOfferOptions): MoveOffer {
  const show = (root: string, count: number, skipped: readonly string[]): void => {
    const { root: banner, text } = createBannerShell("neutral", "upload");
    const move = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button" });
    setButton(move, "upload", `Move ${papers(count)} to ${root}`, false);
    move.addEventListener("click", () => void run(root, move));
    text.append(`${papers(count)} ${count === 1 ? "is" : "are"} still in this browser.`);
    if (skipped.length) {
      text.append(renderElement("div", { class: "lsrc-reason", text:
        `${papers(skipped.length)} ${skipped.length === 1 ? "stays" : "stay"} in this browser because the folder already has a paper with the same id: ${skipped.join(", ")}.` }));
    }
    text.append(renderElement("div", { class: "lsrc-actions" }, move));
    host.replaceChildren(banner);
  };
  const run = async (root: string, move: HTMLButtonElement): Promise<void> => {
    setButton(move, "upload", "Moving papers…", true);
    let skipped: readonly string[] = [];
    try {
      const result = await moveBrowserLibraryToFolder();
      skipped = result.skipped;
      if (!skipped.length) showToast(`Moved ${papers(result.moved.length)} to the folder.`, "ok");
    } catch (err) {
      await options.logger.error("library.libraryLocation", err);
      showToast(formatError(err), "error");
    }
    try {
      await options.onMoved();
    } catch (err) {
      await options.logger.error("library.libraryLocation", err);
    }
    await refresh(skipped);
  };
  const refresh = async (skipped: readonly string[] = []): Promise<void> => {
    try {
      const source = await readLibraryLocation();
      const count = source.kind === "folder" ? await countBrowserPapers() : 0;
      if (source.kind !== "folder" || count === 0) host.replaceChildren();
      else show(source.root, count, skipped);
    } catch (err) {
      host.replaceChildren();
      await options.logger.error("library.libraryLocation", err);
    }
  };
  return { refresh: () => refresh() };
}
