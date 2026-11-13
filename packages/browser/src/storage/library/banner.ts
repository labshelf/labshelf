// Asks for the library folder before the page can be used: the folder gate, the folder access prompt and the form for the folder path.
import { formatError, type ILogger } from "@labshelf/core";
import { renderElement, renderInlineCode, renderTextField, showToast } from "@labshelf/core/dom";
import { bx } from "../../platform";
import { createHelperDownloadUrl } from "../../helper";
import { readLibraryLocation, refreshFromFiles, setLibraryFolder, type LibraryLocation } from "../libraryFileSystem";
import { askFolderPermission, readFolderPermission, readPickedDir } from "../pickedDir";
import { canPickFolder, describeSourceReason, pickLibraryFolder, refreshLibraryLocation, type BrowserSource } from "./location";
import { createBannerShell, setButton } from "./shell";

const FIELD_ID = "library-folder";

/** Offered for the `no-library` reason, so a user with only the standalone Helper can pick the folder. */
export function renderFolderPathForm(logger: ILogger, onChosen: (source: LibraryLocation) => void): HTMLElement {
  const input = renderTextField({ id: FIELD_ID, type: "text", placeholder: "/Users/you/LabShelf" });
  const failure = renderElement("div", { class: "lsrc-reason", role: "alert" });
  const apply = renderElement("button", { class: "ls-btn ls-btn-primary", type: "submit", text: "Use this folder" });
  const form = renderElement("form", { class: "lsrc-folder-form" },
    renderElement("label", { for: FIELD_ID, text: "Library folder" }),
    renderElement("div", { class: "lsrc-actions" }, input.element, apply),
    failure);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      apply.disabled = true;
      failure.textContent = "";
      try {
        await setLibraryFolder(input.control.value.trim());
        onChosen(await refreshLibraryLocation(logger));
      } catch (err) {
        await logger.error("library.libraryLocation", err, { action: "choose library folder" });
        failure.textContent = `Could not use this folder: ${formatError(err)}`;
      } finally {
        apply.disabled = false;
      }
    })();
  });
  return form;
}

/** Renders into `host` only while the picked folder lacks permission; `onGranted` runs once the records are rebuilt. */
async function showFolderAccess(host: HTMLElement, logger: ILogger, onGranted: () => void): Promise<void> {
  const handle = await readPickedDir();
  if (!handle || (await readFolderPermission(handle)) === "granted") return;
  const { root, text } = createBannerShell("warn", "warning");
  root.classList.add("lsrc-gate");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
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
  setGated(true);
}

export interface SourceBannerOptions {
  logger: ILogger;
  /** Runs once the library is a folder, by a re-check, a pick or granted access; the gate is already gone. */
  onFolder(): void;
  /** Given where a folder picker cannot run (the popup closes when it opens): the gate's main button opens the library page instead. */
  openLibrary?: () => void;
}

/** While set on the body, the page shows only the gate; each page's CSS hides the rest. */
const GATED_CLASS = "lsrc-gated";

function setGated(gated: boolean): void {
  document.body.classList.toggle(GATED_CLASS, gated);
}

const CONNECT_HINT = "Already use LabShelf for VS Code or the terminal? Run Connect the Browser in VS Code, or ";

function bridgeHelp(): HTMLElement {
  const download = renderElement("a", { href: createHelperDownloadUrl(""), target: "_blank", rel: "noopener", text: "Download LabShelf Helper" });
  bx.runtime.getPlatformInfo().then((info) => { download.setAttribute("href", createHelperDownloadUrl(info.os)); }, () => undefined);
  return renderElement("div", { class: "lsrc-reason" },
    renderElement("div", {}, "This browser cannot open folders itself. ", download, ", install it, then choose Check again and give it the folder."),
    renderElement("div", {}, CONNECT_HINT, renderInlineCode("labshelf bridge install"), " in the terminal, and choose Check again."));
}

function connectHint(): HTMLElement {
  return renderElement("div", { class: "lsrc-reason" }, CONNECT_HINT, renderInlineCode("labshelf bridge install"), " in the terminal, and choose Check again.");
}

/**
 * Blocks the page until the library is a usable folder: the library never lives in the browser's storage. Renders nothing until the
 * first source check ends, and nothing at all when the library is a usable folder.
 */
export function mountSourceBanner(host: HTMLElement, options: SourceBannerOptions): void {
  const toFolder = (source: LibraryLocation): void => {
    if (source.kind === "browser") return render(source);
    host.replaceChildren();
    setGated(false);
    options.onFolder();
  };
  const mainButton = (): HTMLButtonElement => {
    const button = renderElement("button", { class: "ls-btn ls-btn-primary", type: "button" });
    const { openLibrary } = options;
    if (openLibrary) {
      setButton(button, "folder", "Open LabShelf to choose a folder", false);
      button.addEventListener("click", () => openLibrary());
      return button;
    }
    setButton(button, "folder", "Choose a folder", false);
    button.addEventListener("click", () => void run(button, "folder", "Choose a folder", () => pickLibraryFolder(options.logger)));
    return button;
  };
  const render = (source: BrowserSource): void => {
    const { root, text } = createBannerShell("neutral", "folder");
    root.classList.add("lsrc-gate");
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Choose the library folder");
    const check = renderElement("button", { class: "ls-btn", type: "button" });
    setButton(check, "refresh", "Check again", false);
    check.addEventListener("click", () => void run(check, "refresh", "Check again", () => refreshLibraryLocation(options.logger)));
    const pickable = canPickFolder() || options.openLibrary !== undefined;
    text.append(
      renderElement("div", { class: "lsrc-title", text: "Choose a folder for your library" }),
      renderElement("div", { class: "lsrc-reason", text: "LabShelf keeps your papers and notes as files in a folder on this computer. Choose one to continue." }),
    );
    // "not-installed" only says no folder is chosen yet, which the text above already says.
    if (source.reason !== "not-installed") text.append(renderElement("div", { class: "lsrc-reason", text: describeSourceReason(source) }));
    text.append(renderElement("div", { class: "lsrc-actions" }, ...(pickable ? [mainButton()] : []), check));
    if (source.reason === "no-library") text.append(renderFolderPathForm(options.logger, toFolder));
    else text.append(pickable ? connectHint() : bridgeHelp());
    host.replaceChildren(root);
    setGated(true);
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
    else if (source.via === "picked") await showFolderAccess(host, options.logger, () => { setGated(false); options.onFolder(); });
  }).catch((err: unknown) => options.logger.error("library.libraryLocation", err));
}
