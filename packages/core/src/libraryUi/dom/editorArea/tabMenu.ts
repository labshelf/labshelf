// Opens an editor tab's context menu: close it, or move it to the other group as the keyboard way to drag it there.
import { showMenu, type MenuAnchor } from "../../../ui/dom/index.js";

export interface TabMenuActions {
  close(): void;
  moveToOtherGroup(): void;
}

/** Shows the menu at a pointer or under the tab. */
export function showTabMenu(anchor: MenuAnchor | HTMLElement, actions: TabMenuActions): void {
  showMenu(anchor, [
    { label: "Close", icon: "x", hint: "Ctrl+W", onSelect: actions.close },
    { label: "Move to Other Group", icon: "open-to-side", onSelect: actions.moveToOtherGroup },
  ]);
}
