// Shows where the library lives: the warning banner, the offer to move the browser's papers and the form for the folder path.
import { formatError, renderIcon, type IconName, type ILogger } from "@labshelf/core";
import { renderElement, renderInlineCode, renderTextField, showToast } from "@labshelf/core/dom";
import { bx } from "../../platform";
import { createHelperDownloadUrl } from "../../helper";
import { readLibraryLocation, refreshFromFiles, setLibraryFolder, type LibraryLocation } from "../libraryFileSystem";
import { askFolderPermission, readFolderPermission, readPickedDir } from "./pickedDir";
import { canPickFolder, describeSourceReason, pickLibraryFolder, refreshLibraryLocation, type BrowserSource } from "./location";
import { countBrowserPapers, moveBrowserLibraryToFolder } from "./move";

export interface BannerShell {
  root: HTMLElement;
  text: HTMLElement;
}

export function createBannerShell(tone: "warn" | "neutral", glyph: IconName): BannerShell {
  const text = renderElement("div", { class: "lsrc-text" });
  const root = renderElement("div", { class: `lsrc-banner ${tone}` }, renderElement("span", { class: "lsrc-icon", html: renderIcon(glyph) }), text);
  return { root, text };
}

/** Shows `label` beside `glyph`; a busy button is disabled and its icon spins. */
export function setButton(button: HTMLButtonElement, glyph: IconName, label: string, busy: boolean): void {
  button.disabled = busy;
  button.replaceChildren(
    renderElement("span", { class: busy ? "lsrc-spin" : "lsrc-glyph", html: renderIcon(busy ? "loader" : glyph) }),
    renderElement("span", { text: label }),
  );
}

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
