// Asks the user to let LabShelf use the picked library folder again when the browser no longer allows it.
import { errorMessage, type ILogger } from "@labshelf/core";
import { el, inlineCode, toast } from "@labshelf/core/dom";
import { bannerShell, setButton } from "./bannerShell";
import { folderPermission, loadPickedFolder, rebuildFromFiles, requestFolderPermission } from "../storage";

/** Renders into `host` only while the picked folder lacks permission; `onGranted` runs once the records are rebuilt. */
export async function showFolderAccess(host: HTMLElement, logger: ILogger, onGranted: () => void): Promise<void> {
  const handle = await loadPickedFolder();
  if (!handle || (await folderPermission(handle)) === "granted") return;
  const { root, text } = bannerShell("warn", "warning");
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Library folder access");
  const allow = el("button", { class: "ls-btn ls-btn-primary", type: "button" });
  setButton(allow, "folder", "Allow access", false);
  allow.addEventListener("click", () => void (async () => {
    setButton(allow, "folder", "Allow access", true);
    try {
      if (await requestFolderPermission(handle)) {
        host.replaceChildren();
        await rebuildFromFiles(logger);
        onGranted();
        return;
      }
      toast("LabShelf still may not use the folder.", "error");
    } catch (err) {
      await logger.error("library-source", err, { action: "allow folder access", folder: handle.name });
      toast(errorMessage(err), "error");
    }
    setButton(allow, "folder", "Allow access", false);
  })());
  text.append(
    "LabShelf needs your permission to use the library folder ", inlineCode(handle.name), " again.",
    el("div", { class: "lsrc-reason", text: "The browser asks again after it restarts, unless you let it allow LabShelf on every visit." }),
    el("div", { class: "lsrc-actions" }, allow),
  );
  host.replaceChildren(root);
}
