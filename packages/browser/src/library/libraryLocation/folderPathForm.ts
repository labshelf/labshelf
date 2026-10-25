// Asks for the library folder's path when LabShelf on this computer runs without one, and has the bridge serve it.
import { formatError, type ILogger } from "@labshelf/core";
import { renderElement, renderTextField } from "@labshelf/core/dom";
import { setLibraryFolder, type LibrarySource } from "../../storage";
import { recheckSource } from "./recheckLibraryLocation";

const FIELD_ID = "library-folder";

/** Offered for the `no-library` reason, so a user with only the standalone Helper can pick the folder. */
export function folderPathForm(logger: ILogger, onChosen: (source: LibrarySource) => void): HTMLElement {
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
        onChosen(await recheckSource(logger));
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
