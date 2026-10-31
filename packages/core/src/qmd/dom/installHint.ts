// Copy buttons for the `Install it with: <command>` hint lines the cell drivers print when a package is missing.
import { renderElement, renderIcon, showToast } from "../../ui/dom/index.js";

const PREFIX = "Install it with: ";
const COPY_REFUSED_TEXT = "The clipboard refused the copy; select the command and copy it.";

/** One `div.qmd-output-install` with a copy button per line of the text that starts with `Install it with: `; the button copies the command after the prefix. */
export function renderInstallHints(text: string, copy: (text: string) => Promise<void> = (value) => navigator.clipboard.writeText(value)): HTMLElement[] {
  return text.split(/\r\n|\n|\r/).filter((line) => line.startsWith(PREFIX)).map((line) => {
    const command = line.slice(PREFIX.length).trimEnd();
    const button = renderElement("button", { class: "qmd-output-copy", type: "button", "aria-label": "Copy install command", title: "Copy install command", html: renderIcon("clipboard") });
    button.addEventListener("click", () => {
      const refused = () => { showToast(COPY_REFUSED_TEXT, "error"); };
      try { copy(command).then(() => { showToast(`Copied: ${command}`, "ok"); }, refused); } catch { refused(); }
    });
    return renderElement("div", { class: "qmd-output-install" }, button);
  });
}
