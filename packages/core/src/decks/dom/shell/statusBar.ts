// The shell's status bar: slide navigation and where the editor is, a gesture hint, the crumb, and the save or problem state.
import { renderElement, renderIcon } from "../../../ui/dom/index.js";
import type { ShellStatus, ShellStatusParts } from "./types.js";

const STATE_ICONS = { saved: "check", dirty: "edit", problem: "warning" } as const;

export function createShellStatus(): ShellStatus {
  const left = renderElement("span", { class: "dw-status-left" });
  const previous = renderElement("button", { type: "button", class: "dw-tool", title: "Previous slide", "aria-label": "Previous slide", html: renderIcon("chevron-left"), hidden: true });
  const next = renderElement("button", { type: "button", class: "dw-tool", title: "Next slide", "aria-label": "Next slide", html: renderIcon("chevron-right"), hidden: true });
  const hint = renderElement("span", { class: "dw-hint", hidden: true });
  const crumb = renderElement("span", { class: "dw-crumb" });
  const right = renderElement("span", { class: "dw-status-right", hidden: true });
  const element = renderElement("footer", { class: "dw-status" }, previous, left, next, renderElement("span", { class: "dw-spacer" }), hint, crumb, right);
  let nav: ShellStatusParts["nav"];
  previous.addEventListener("click", () => nav?.previous());
  next.addEventListener("click", () => nav?.next());
  return {
    element,
    set(parts) {
      nav = parts.nav;
      left.textContent = parts.left;
      previous.hidden = next.hidden = !nav;
      previous.disabled = !nav?.canPrevious;
      next.disabled = !nav?.canNext;
      hint.textContent = parts.hint ?? "";
      hint.hidden = !parts.hint;
      crumb.replaceChildren(...(parts.crumb ?? []).flatMap((part, i) => [...(i ? [renderElement("span", { class: "dw-crumb-sep", html: renderIcon("chevron-right") })] : []), renderElement("span", { text: part })]));
      const { state } = parts;
      right.hidden = !state;
      if (state) {
        right.dataset["state"] = state.tone;
        right.innerHTML = renderIcon(STATE_ICONS[state.tone]);
        right.append(renderElement("span", { text: state.text }));
      } else {
        delete right.dataset["state"];
        right.replaceChildren();
      }
    },
  };
}
