// Builds the Library section: where the library lives, the choice of a folder, and a re-check of the connection.
import { formatError, type ILogger } from "@labshelf/core";
import { renderActionButton, renderElement, renderInlineCode, renderSettingRow, renderSettingsSection, createToneLine } from "@labshelf/core/dom";
import { canPickFolder, renderFolderPathForm, pickLibraryFolder, refreshLibraryLocation, describeSourceReason } from "../storage/library";
import { readLibraryLocation, type LibraryLocation } from "../storage";

function sourceRow(source: LibraryLocation): HTMLElement {
  if (source.kind === "folder") return renderSettingRow({ label: "Stored in" }, renderElement("span", {}, "Folder: ", renderInlineCode(source.root)));
  return renderSettingRow({ label: "Stored in", description: describeSourceReason(source) }, renderElement("span", { text: "This browser" }));
}

export function createLibraryLocationSection(logger: ILogger): HTMLElement {
  const status = createToneLine();
  const row = renderElement("div");
  const show = (source: LibraryLocation): void => {
    row.replaceChildren(sourceRow(source));
    if (source.kind === "browser" && source.reason === "no-library") row.append(renderFolderPathForm(logger, show));
    // A bridge folder belongs to the desktop apps, which change it themselves.
    if (canPickFolder() && (source.kind === "browser" || source.via === "picked")) row.append(renderSettingRow({}, pick(source)));
  };
  const pick = (source: LibraryLocation): HTMLElement => renderActionButton({
    label: source.kind === "folder" ? "Choose another folder" : "Choose a folder on this computer", icon: "folder",
    onClick: async () => {
      try {
        const next = await pickLibraryFolder(logger);
        if (next) show(next);
      } catch (err) {
        await logger.error("options", err, { action: "pick library folder" });
        status.set("Could not use this folder", "error", formatError(err));
      }
    },
  });
  const check = renderActionButton({
    label: "Check again", icon: "refresh",
    onClick: async () => {
      status.set("Checking…", "idle");
      try {
        show(await refreshLibraryLocation(logger));
        status.set("", "idle");
      } catch (err) {
        await logger.error("options", err);
        status.set("Could not check", "error", formatError(err));
      }
    },
  });
  status.set("Checking…", "idle");
  readLibraryLocation().then(
    (source) => { show(source); status.set("", "idle"); },
    (err: unknown) => { void logger.error("options", err); status.set("Could not check", "error", formatError(err)); },
  );
  return renderSettingsSection({ title: "Library" }, row, renderSettingRow({}, check), status.element);
}
