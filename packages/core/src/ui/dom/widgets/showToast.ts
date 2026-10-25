// Shows bottom-right notifications; errors stay until dismissed, info/ok messages fade after a few seconds.
import { renderIcon } from "../../icons/index.js";
import { renderElement } from "../dom.js";

export type ToastKind = "info" | "ok" | "error";

const AUTO_DISMISS_MS = 4500;
let host: HTMLElement | null = null;

/** Shows a toast; returns a function that dismisses it early. */
export function showToast(message: string, kind: ToastKind = "info"): () => void {
  if (!host) {
    host = renderElement("div", { class: "ls-toasts", role: "status", "aria-live": "polite" });
    document.body.append(host);
  }
  const glyph = kind === "error" ? "warning" : kind === "ok" ? "check" : "info";
  const closeBtn = renderElement("button", { class: "ls-icon-btn", type: "button", title: "Dismiss", html: renderIcon("x") });
  const node = renderElement("div", { class: `ls-toast ${kind}`, role: kind === "error" ? "alert" : null },
    renderElement("span", { html: renderIcon(glyph) }),
    renderElement("div", { class: "msg", text: message }),
    closeBtn,
  );
  const dismiss = (): void => { node.remove(); };
  closeBtn.addEventListener("click", dismiss);
  host.append(node);
  if (kind !== "error") setTimeout(dismiss, AUTO_DISMISS_MS);
  return dismiss;
}
