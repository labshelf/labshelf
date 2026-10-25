// Builds the notices above a shared file that opens read-only, each with the action that lets it edit.
import { renderElement, renderIcon, type IconName } from "@labshelf/core/dom";

function readOnlyNotice(iconName: IconName, text: string, action: { label: string; icon: IconName; run: () => void }): HTMLElement {
  const button = renderElement("button", { type: "button", class: "ls-btn ls-button-soft", html: renderIcon(action.icon) }, action.label);
  button.addEventListener("click", () => { button.disabled = true; action.run(); });
  return renderElement("div", { class: "ls-source-notice", role: "status" },
    renderElement("span", { class: "ls-source-notice-icon", "aria-hidden": "true", html: renderIcon(iconName) }),
    renderElement("span", { class: "ls-source-notice-text" }, text),
    button);
}

export function renderUnresolvedNotice(retry: () => void): HTMLElement {
  return readOnlyNotice("cloud-off", "This shared file is not ready to edit. It stays read-only until sharing is ready.", { label: "Retry", icon: "refresh", run: retry });
}

export function renderObservingNotice(useHere: () => void): HTMLElement {
  return readOnlyNotice("external", "This shared project is open in another tab. This file is read-only here until you use it here or that tab closes.", { label: "Use here", icon: "target", run: useHere });
}
