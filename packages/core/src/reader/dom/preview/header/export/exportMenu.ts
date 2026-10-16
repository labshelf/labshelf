// Adds the header Export button, a menu that sends the project out as a zip or opens its PDF outside the editor.
import { icon, type IconName } from "../../../../../ui/index.js";
import { showMenu } from "../../../../../ui/dom/index.js";
import type { PreviewRoots } from "../../../../index.js";
import type { ExportTarget, PreviewRequest } from "../../../../previewRequests.js";
import { iconButton } from "../../../elements/index.js";

interface ExportMenuDeps {
  post: (request: PreviewRequest) => void;
}

export interface ExportMenu {
  /** Enables the button while the preview has a root to export. */
  setRoots(roots: PreviewRoots): void;
}

const ITEMS: { label: string; target: ExportTarget; icon?: IconName }[] = [
  { label: "Project zip", target: "projectZip" },
  { label: "arXiv zip", target: "arxivZip" },
  { label: "Open PDF in system viewer", target: "systemViewer", icon: "external" },
];

/** Fills the header's export slot and shows it. */
export function mountExportMenu(slot: HTMLElement, { post }: ExportMenuDeps): ExportMenu {
  const button = iconButton(icon("upload"), "Export");
  button.setAttribute("aria-haspopup", "menu");
  button.disabled = true;
  button.addEventListener("click", () =>
    showMenu(button, ITEMS.map(({ label, target, icon: glyph }) => ({
      label,
      ...(glyph && { icon: glyph }),
      onSelect: () => post({ command: "exportProject", target }),
    }))),
  );
  slot.append(button);
  slot.hidden = false;

  return {
    setRoots(roots) {
      button.disabled = roots.roots.length === 0;
    },
  };
}
