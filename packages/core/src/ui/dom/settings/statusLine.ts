/** A status line: a coloured dot, a text and, after it, an error message in the error colour. */
import { el } from "../dom.js";

export type StatusTone = "ok" | "error" | "idle";

export interface StatusLine {
  element: HTMLElement;
  set(text: string, tone: StatusTone, error?: string | null): void;
}

const DOT_CLASS: Record<StatusTone, string> = { ok: "ls-dot s-ok", error: "ls-dot s-error", idle: "ls-dot" };

export function statusLine(): StatusLine {
  const dot = el("span", { class: DOT_CLASS.idle });
  const text = el("span");
  const error = el("span", { class: "settings-status-error" });
  const element = el("div", { class: "settings-status", role: "status" }, dot, text, error);
  return {
    element,
    set(next, tone, message) {
      dot.className = DOT_CLASS[tone];
      text.textContent = next;
      error.textContent = message ? ` — ${message}` : "";
    },
  };
}
