/** Builds a status line: a coloured dot, a text and, after it, an error message in the error colour. */
import { renderElement } from "../dom.js";

export type ToneLineTone = "ok" | "error" | "idle";

export interface ToneLine {
  element: HTMLElement;
  set(text: string, tone: ToneLineTone, error?: string | null): void;
}

const DOT_CLASS: Record<ToneLineTone, string> = { ok: "ls-dot s-ok", error: "ls-dot s-error", idle: "ls-dot" };

export function createToneLine(): ToneLine {
  const dot = renderElement("span", { class: DOT_CLASS.idle });
  const text = renderElement("span");
  const error = renderElement("span", { class: "settings-status-error" });
  const element = renderElement("div", { class: "settings-status", role: "status" }, dot, text, error);
  return {
    element,
    set(next, tone, message) {
      dot.className = DOT_CLASS[tone];
      text.textContent = next;
      error.textContent = message ? ` — ${message}` : "";
    },
  };
}
