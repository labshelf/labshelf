// Warns that the library lives in this browser and offers the ways to a folder, with a re-check of the connection.
import { formatError, type ILogger } from "@labshelf/core";
import { renderElement, renderInlineCode, showToast } from "@labshelf/core/dom";
import { bx } from "../../platform";
import { createHelperDownloadUrl } from "../../helper";
import { createBannerShell, setButton } from "./createBannerShell";
import { renderFolderPathForm } from "./renderFolderPathForm";
import { canPickFolder, pickLibraryFolder } from "./pickLibraryFolder";
import { refreshLibraryLocation } from "./recheckLibraryLocation";
import { describeSourceReason, type BrowserSource } from "./libraryLocationReason";
import {
  readLibraryLocation,
  type LibraryLocation,
  readFolderPermission,
  readPickedDir,
  refreshFromFiles,
  askFolderPermission,
} from "../../storage";

/** Renders into `host` only while the picked folder lacks permission; `onGranted` runs once the records are rebuilt. */
async function showFolderAccess(host: HTMLElement, logger: ILogger, onGranted: () => void): Promise<void> {
  const handle = await readPickedDir();
  if (!handle || (await readFolderPermission(handle)) === "granted") return;
  const { root, text } = createBannerShell("warn", "warning");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Library folder access");
  const allow = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button" });
  setButton(allow, "folder", "Allow access", false);
  allow.addEventListener("click", () => void (async () => {
    setButton(allow, "folder", "Allow access", true);
    try {
      if (await askFolderPermission(handle)) {
        host.replaceChildren();
        await refreshFromFiles(logger);
        onGranted();
        return;
      }
      showToast("LabShelf still may not use the folder.", "error");
    } catch (err) {
      await logger.error("library.libraryLocation", err, { action: "allow folder access", folder: handle.name });
      showToast(formatError(err), "error");
    }
    setButton(allow, "folder", "Allow access", false);
  })());
  text.append(
    "LabShelf needs your permission to use the library folder ", renderInlineCode(handle.name), " again.",
    renderElement("div", { class: "lsrc-reason", text: "The browser asks again after it restarts, unless you let it allow LabShelf on every visit." }),
    renderElement("div", { class: "lsrc-actions" }, allow),
  );
  host.replaceChildren(root);
}

export interface SourceBannerOptions {
  logger: ILogger;
  /** Runs once the library is a folder, by a re-check, a pick or granted access; the banner is already gone. */
  onFolder(): void;
}

const PANEL_ID = "lsrc-panel";

function bridgePanel(): HTMLElement {
  const download = renderElement("a", { href: createHelperDownloadUrl(""), target: "_blank", rel: "noopener", text: "Download LabShelf Helper" });
  bx.runtime.getPlatformInfo().then((info) => { download.setAttribute("href", createHelperDownloadUrl(info.os)); }, () => undefined);
  return renderElement("div", { id: PANEL_ID, class: "lsrc-reason", hidden: true },
    renderElement("div", {}, download, ", install it, then choose Check again and give it the folder."),
    renderElement("div", {}, "Already use LabShelf for VS Code or the terminal? Run Connect the Browser in VS Code, or ",
      renderInlineCode("labshelf bridge install"), " in the terminal, and choose Check again."));
}

/** Shows and hides `help`; `state` keeps it open across re-renders. */
function panelToggle(help: HTMLElement, state: { open: boolean }): HTMLButtonElement {
  help.hidden = !state.open;
  const toggle = renderElement("button", { class: "ls-btn ls-btn-ghost", type: "button", "aria-expanded": String(state.open), "aria-controls": PANEL_ID, text: "Save to a folder on this computer" });
  toggle.addEventListener("click", () => {
    state.open = !state.open;
    help.hidden = !state.open;
    toggle.setAttribute("aria-expanded", String(state.open));
  });
  return toggle;
}

/** Renders nothing until the first source check ends, and nothing at all when the library is a usable folder. */
export function mountSourceBanner(host: HTMLElement, options: SourceBannerOptions): void {
  const panel = { open: false };
  const toFolder = (source: LibraryLocation): void => {
    if (source.kind === "browser") return render(source);
    host.replaceChildren();
    options.onFolder();
  };
  const pickButton = (): HTMLButtonElement => {
    const pick = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button" });
    setButton(pick, "folder", "Choose a folder on this computer", false);
    pick.addEventListener("click", () => void run(pick, "folder", "Choose a folder on this computer", () => pickLibraryFolder(options.logger)));
    return pick;
  };
  const render = (source: BrowserSource): void => {
    const { root, text } = createBannerShell("warn", "warning");
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Library storage");
    const help = bridgePanel();
    const check = renderElement("button", { class: "ls-btn", type: "button" });
    setButton(check, "refresh", "Check again", false);
    check.addEventListener("click", () => void run(check, "refresh", "Check again", () => refreshLibraryLocation(options.logger)));
    text.append(
      "Your library lives in this browser. Uninstalling the extension deletes it.",
      renderElement("div", { class: "lsrc-reason", text: describeSourceReason(source) }),
      renderElement("div", { class: "lsrc-actions" }, canPickFolder() ? pickButton() : panelToggle(help, panel), check),
    );
    if (source.reason === "no-library") text.append(renderFolderPathForm(options.logger, toFolder));
    else if (!canPickFolder()) text.append(help);
    host.replaceChildren(root);
  };
  const run = async (button: HTMLButtonElement, glyph: "folder" | "refresh", label: string, step: () => Promise<LibraryLocation | undefined>): Promise<void> => {
    setButton(button, glyph, label, true);
    try {
      const next = await step();
      if (next) return toFolder(next);
    } catch (err) {
      await options.logger.error("library.libraryLocation", err, { action: label });
      showToast(formatError(err), "error");
    }
    setButton(button, glyph, label, false);
  };
  readLibraryLocation().then(async (source) => {
    if (source.kind === "browser") render(source);
    else if (source.via === "picked") await showFolderAccess(host, options.logger, options.onFolder);
  }).catch((err: unknown) => options.logger.error("library.libraryLocation", err));
}
