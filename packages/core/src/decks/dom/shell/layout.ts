// The shell's layout: header, insert bar, body (left panel, code pane and divider, stage with zoom bar, grid and notes, properties) and status.
import { renderElement, renderIcon } from "../../../ui/dom/index.js";
import type { DeckShell, DeckShellParts } from "./types.js";

/** Dragging the divider resizes the code pane between 20% and 80% of the body. */
function wireDivider(divider: HTMLElement, body: HTMLElement, root: HTMLElement): void {
  // The library's sash grip (libraryChrome's attachSash).
  divider.insertAdjacentHTML("afterbegin", `<span class="ls-sash-grip" aria-hidden="true">${renderIcon("more")}</span>`);
  divider.addEventListener("pointerdown", (event) => {
    divider.setPointerCapture?.(event.pointerId);
    divider.classList.add("dragging");
    const move = (e: PointerEvent): void => {
      const bounds = body.getBoundingClientRect();
      if (bounds.width === 0) return;
      root.style.setProperty("--dw-code-width", `${Math.min(80, Math.max(20, ((e.clientX - bounds.left) / bounds.width) * 100))}%`);
    };
    const up = (): void => { divider.classList.remove("dragging"); divider.removeEventListener("pointermove", move); divider.removeEventListener("pointerup", up); };
    divider.addEventListener("pointermove", move);
    divider.addEventListener("pointerup", up);
  });
}

export function mountDeckShell(host: HTMLElement, parts: DeckShellParts): DeckShell {
  parts.stage.append(parts.zoom);
  const body = renderElement("div", { class: "dw-body" }, ...(parts.left ? [parts.left] : []));
  const root = renderElement("div", { class: "dw", "data-format": parts.format, "data-kind": parts.kind, "data-mode": "visual" }, parts.header, parts.insert, body, parts.status);
  if (parts.code) {
    const divider = renderElement("div", { class: "dw-divider", role: "separator", "aria-orientation": "vertical", "aria-label": "Resize" });
    body.append(renderElement("div", { class: "dw-code" }, parts.code, divider));
    wireDivider(divider, body, root);
  }
  body.append(renderElement("div", { class: "dw-stage-column" }, parts.stage, ...(parts.grid ? [parts.grid] : []), ...(parts.notes ? [parts.notes] : [])), parts.props);
  host.append(root);
  return {
    root,
    setMode(mode) { root.dataset["mode"] = mode; },
    destroy() { root.remove(); },
  };
}
