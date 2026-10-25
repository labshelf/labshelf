// Connects the right pane's controls to browser workspace context.
import type { SpaceStore } from "@labshelf/core";
import { el, icon, mountResearchChat } from "@labshelf/core/dom";
import { parseTabId } from "../editorArea";
import type { PageShell } from "../editorArea";

export function createRightPane(shell: PageShell, store: Pick<SpaceStore, "list" | "onChange">) {
  const buttons = el("div", { class: "ls-workspace-pane-buttons" });
  const chat = mountResearchChat(shell.chat, { context: null });
  let activeSpace: string | undefined;
  const syncContext = (): void => {
    const result = store.list().find((entry) => entry.state === "ready" && entry.space.id === activeSpace);
    chat.setContext(result?.state === "ready" ? result.space.name : null);
  };
  const unsubscribe = store.onChange(syncContext);
  for (const [pane, label, glyph] of [["details", "Details", "panel-right"], ["chat", "Research chat", "message"]] as const) {
    const button = el("button", {
      class: "ls-icon-btn", type: "button", title: `Toggle ${label}`, "aria-label": `Toggle ${label}`, html: icon(glyph),
    });
    button.dataset["pane"] = pane;
    button.addEventListener("click", () => { shell.togglePane(pane); syncButtons(); });
    buttons.append(button);
  }
  const syncButtons = (): void => {
    for (const button of buttons.querySelectorAll("button")) {
      button.setAttribute("aria-pressed", String(button.dataset["pane"] === shell.root.dataset["rightPane"]
        && !shell.root.classList.contains("details-collapsed")));
    }
  };
  // INVARIANT: Sash gestures also change the pane's collapsed state.
  const observer = new MutationObserver(syncButtons);
  observer.observe(shell.root, { attributes: true, attributeFilter: ["class", "data-right-pane"] });
  syncButtons();
  return {
    buttons,
    activateTab(id: string): void {
      const parsed = parseTabId(id);
      activeSpace = parsed?.kind === "space" ? parsed.params["id"] : undefined;
      syncContext();
    },
    dispose(): void { observer.disconnect(); unsubscribe(); chat.dispose(); buttons.remove(); },
  };
}
