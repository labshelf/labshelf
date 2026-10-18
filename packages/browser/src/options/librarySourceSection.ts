// Builds the Library section: where the library lives, and a re-check of the connection to LabShelf on this computer.
import { errorMessage, type ILogger } from "@labshelf/core";
import { actionButton, el, inlineCode, settingRow, settingsSection, statusLine } from "@labshelf/core/dom";
import { recheckSource, sourceReason } from "../library-source";
import { getLibrarySource, type LibrarySource } from "../storage";

function sourceRow(source: LibrarySource): HTMLElement {
  if (source.kind === "folder") return settingRow({ label: "Stored in" }, el("span", {}, "Folder: ", inlineCode(source.root)));
  return settingRow({ label: "Stored in", description: sourceReason(source) }, el("span", { text: "This browser" }));
}

export function createLibrarySourceSection(logger: ILogger): HTMLElement {
  const status = statusLine();
  const row = el("div");
  const show = (source: LibrarySource): void => row.replaceChildren(sourceRow(source));
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
