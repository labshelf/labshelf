// Builds the Library section: where the library lives, and a re-check of the connection to LabShelf on this computer.
import { errorMessage, type ILogger } from "@labshelf/core";
import { actionButton, el, inlineCode, settingRow, settingsSection, statusLine, textField } from "@labshelf/core/dom";
import { chooseLibraryFolder, recheckSource, sourceReason } from "../library-source";
import { getLibrarySource, type LibrarySource } from "../storage";

function sourceRow(source: LibrarySource): HTMLElement {
  if (source.kind === "folder") return settingRow({ label: "Stored in" }, el("span", {}, "Folder: ", inlineCode(source.root)));
  return settingRow({ label: "Stored in", description: sourceReason(source) }, el("span", { text: "This browser" }));
}

/** Offered when the host runs but names no library, so a user with only the standalone Helper can pick one. */
function folderForm(logger: ILogger, show: (source: LibrarySource) => void): HTMLElement {
  const input = textField({ id: "library-folder", type: "text", placeholder: "/Users/you/LabShelf" });
  const status = statusLine();
  const apply = actionButton({
    label: "Use this folder", icon: "folder", primary: true,
    onClick: async () => {
      status.set("Setting the folder…", "idle");
      try {
        show(await chooseLibraryFolder(input.control.value.trim(), logger));
      } catch (err) {
        await logger.error("options", err, { action: "choose library folder" });
        status.set("Could not use this folder", "error", errorMessage(err));
      }
    },
  });
  return el("div", {}, settingRow({ label: "Library folder", labelFor: "library-folder" }, input.element), settingRow({}, apply), status.element);
}

export function createLibrarySourceSection(logger: ILogger): HTMLElement {
  const status = statusLine();
  const row = el("div");
  const show = (source: LibrarySource): void => {
    row.replaceChildren(sourceRow(source));
    if (source.kind === "browser" && source.reason === "no-library") row.append(folderForm(logger, show));
  };
  const check = actionButton({
    label: "Check again", icon: "refresh",
    onClick: async () => {
      status.set("Checking…", "idle");
      try {
        show(await recheckSource(logger));
        status.set("", "idle");
      } catch (err) {
        await logger.error("options", err);
        status.set("Could not check", "error", errorMessage(err));
      }
    },
  });
  status.set("Checking…", "idle");
  getLibrarySource().then(
    (source) => { show(source); status.set("", "idle"); },
    (err: unknown) => { void logger.error("options", err); status.set("Could not check", "error", errorMessage(err)); },
  );
  return settingsSection({ title: "Library" }, row, settingRow({}, check), status.element);
}
