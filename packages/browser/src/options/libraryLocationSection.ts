// Builds the Library section: where the library lives, the choice of a folder, and a re-check of the connection.
import { errorMessage, type ILogger } from "@labshelf/core";
import { actionButton, el, inlineCode, settingRow, settingsSection, statusLine } from "@labshelf/core/dom";
import { canPickFolder, folderPathForm, pickLibraryFolder, recheckSource, sourceReason } from "../library/libraryLocation";
import { getLibrarySource, type LibrarySource } from "../storage";

function sourceRow(source: LibrarySource): HTMLElement {
  if (source.kind === "folder") return settingRow({ label: "Stored in" }, el("span", {}, "Folder: ", inlineCode(source.root)));
  return settingRow({ label: "Stored in", description: sourceReason(source) }, el("span", { text: "This browser" }));
}

export function createLibrarySourceSection(logger: ILogger): HTMLElement {
  const status = statusLine();
  const row = el("div");
  const show = (source: LibrarySource): void => {
    row.replaceChildren(sourceRow(source));
    if (source.kind === "browser" && source.reason === "no-library") row.append(folderPathForm(logger, show));
    // A bridge folder belongs to the desktop apps, which change it themselves.
    if (canPickFolder() && (source.kind === "browser" || source.via === "picked")) row.append(settingRow({}, pick(source)));
  };
  const pick = (source: LibrarySource): HTMLElement => actionButton({
    label: source.kind === "folder" ? "Choose another folder" : "Choose a folder on this computer", icon: "folder",
    onClick: async () => {
      try {
        const next = await pickLibraryFolder(logger);
        if (next) show(next);
      } catch (err) {
        await logger.error("options", err, { action: "pick library folder" });
        status.set("Could not use this folder", "error", errorMessage(err));
      }
    },
  });
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
