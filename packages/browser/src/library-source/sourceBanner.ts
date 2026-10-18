// Warns that the library lives in this browser and offers the way to a folder, with a re-check of the connection.
import { errorMessage, type ILogger } from "@labshelf/core";
import { el, inlineCode, toast } from "@labshelf/core/dom";
import { bannerShell, setButton } from "./bannerShell";
import { recheckSource } from "./recheckSource";
import { sourceReason, type BrowserSource } from "./sourceReason";
import { getLibrarySource } from "../storage";

export interface SourceBannerOptions {
  logger: ILogger;
  /** Runs once a re-check finds the library folder; the banner is already gone. */
  onFolder(): void;
}

const PANEL_ID = "lsrc-panel";

function panel(): HTMLElement {
  return el("div", { id: PANEL_ID, class: "lsrc-reason", hidden: true },
    "Install LabShelf for VS Code or the terminal and choose a library folder there. Then run Connect the Browser in VS Code, or ",
    inlineCode("labshelf bridge install"), " in the terminal, and choose Check again.");
}

/** Renders nothing until the first source check ends, and nothing at all when the library is a folder. */
export function mountSourceBanner(host: HTMLElement, options: SourceBannerOptions): void {
  let open = false;
  const render = (source: BrowserSource): void => {
    const { root, text } = bannerShell("warn", "warning");
    root.setAttribute("role", "region");
    root.setAttribute("aria-label", "Library storage");
    const help = panel();
    help.hidden = !open;
    const toggle = el("button", { class: "ls-btn ls-btn-ghost", type: "button", "aria-expanded": String(open), "aria-controls": PANEL_ID, text: "Save to a folder on this computer" });
    toggle.addEventListener("click", () => {
      open = !open;
      help.hidden = !open;
      toggle.setAttribute("aria-expanded", String(open));
    });
    const check = el("button", { class: "ls-btn", type: "button" });
    setButton(check, "refresh", "Check again", false);
    check.addEventListener("click", () => void recheck(source, check));
    text.append(
      "Your library lives in this browser. Uninstalling the extension deletes it.",
      el("div", { class: "lsrc-reason", text: sourceReason(source) }),
      el("div", { class: "lsrc-actions" }, toggle, check),
      help,
    );
    host.replaceChildren(root);
  };
  const recheck = async (source: BrowserSource, check: HTMLButtonElement): Promise<void> => {
    setButton(check, "refresh", "Check again", true);
    try {
      const next = await recheckSource(options.logger);
      if (next.kind === "folder") {
        host.replaceChildren();
        options.onFolder();
      } else render(next);
    } catch (err) {
      await options.logger.error("library-source", err);
      toast(errorMessage(err), "error");
      render(source);
    }
  };
  getLibrarySource().then((source) => { if (source.kind === "browser") render(source); }, (err: unknown) => options.logger.error("library-source", err));
}
