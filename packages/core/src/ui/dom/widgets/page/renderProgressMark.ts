// Shows done-out-of-total as an Arc mark: empty at zero, full and ok at total, half otherwise.
import { renderArcMarkElement } from "../arcMark.js";

export function renderProgressMark(done: number, total: number, label?: string): HTMLElement {
  const complete = total > 0 && done >= total;
  const progress = complete ? "full" : done === 0 ? "none" : "half";
  return renderArcMarkElement(complete ? "ok" : "accent", progress, label ?? `${done} of ${total} Done`);
}
