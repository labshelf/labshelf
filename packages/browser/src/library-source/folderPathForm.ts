// Asks for the library folder's path when LabShelf on this computer runs without one, and has the bridge serve it.
import { errorMessage, type ILogger } from "@labshelf/core";
import { el, textField } from "@labshelf/core/dom";
import { setLibraryFolder, type LibrarySource } from "../storage";
import { recheckSource } from "./recheckSource";

const FIELD_ID = "library-folder";

/** Offered for the `no-library` reason, so a user with only the standalone Helper can pick the folder. */
export function folderPathForm(logger: ILogger, onChosen: (source: LibrarySource) => void): HTMLElement {
  const input = textField({ id: FIELD_ID, type: "text", placeholder: "/Users/you/LabShelf" });
  const failure = el("div", { class: "lsrc-reason", role: "alert" });
  const apply = el("button", { class: "ls-btn ls-btn-primary", type: "submit", text: "Use this folder" });
  const form = el("form", { class: "lsrc-folder-form" },
    el("label", { for: FIELD_ID, text: "Library folder" }),
    el("div", { class: "lsrc-actions" }, input.element, apply),
    failure);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      apply.disabled = true;
      failure.textContent = "";
      try {
        await setLibraryFolder(input.control.value.trim());
        onChosen(await recheckSource(logger));
      } catch (err) {
        await logger.error("library-source", err, { action: "choose library folder" });
        failure.textContent = `Could not use this folder: ${errorMessage(err)}`;
      } finally {
        apply.disabled = false;
      }
    })();
  });
  return form;
}
