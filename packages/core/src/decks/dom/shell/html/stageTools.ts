// The HTML deck's tools over the stage (the shell's zoom bar is beside them): the floating bar
// over the selected block (kind, text size, emphasis, colour, edit, duplicate, delete, order) and a poster's centimetre rulers.
import { renderElement, showMenu } from "../../../../ui/dom/index.js";
import { describeDeckBlock } from "../../../deckBlocks.js";
import { readBlockStyle } from "../../../deckStyle.js";
import { deleteSelected, duplicateSelected, orderSelected, selectedBlock } from "./actions.js";
import { emphasisToggles, setStyle } from "./propsStyle.js";
import type { ShellContext } from "./types.js";
import { actionButton } from "../../workspace/index.js";

const PX_PER_CM = 96 / 2.54;
const RULER = 22;

/** The text controls of the floating bar: size and emphasis toggles and colour. */
function textControls(ctx: ShellContext, id: string, style: Record<string, string>): HTMLElement[] {
  const size = renderElement("input", { type: "number", class: "dsh-bar-size", min: "4", value: style["font-size"] ? String(Number.parseFloat(style["font-size"])) : "", placeholder: "Size", title: "Text size (px)" });
  size.addEventListener("change", () => setStyle(ctx, id, { "font-size": size.value ? `${size.value}px` : null }, "Text size"));
  size.addEventListener("keydown", (event) => event.stopPropagation());
  const colour = renderElement("input", { type: "color", class: "dsh-bar-colour", title: "Text colour", value: /^#[0-9a-f]{6}$/i.test(style["color"] ?? "") ? style["color"]! : "#000000" });
  colour.addEventListener("change", () => setStyle(ctx, id, { color: colour.value }, "Text colour"));
  return [size, ...emphasisToggles(ctx, id, style), colour];
}

export function createFloatingBar(ctx: ShellContext): { element: HTMLElement; render(): void } {
  const element = renderElement("div", { class: "dw-actionbar dsh-floatbar", role: "toolbar", "aria-label": "Selected block", hidden: true });
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  let key = "";
  const render = (): void => {
    const block = selectedBlock(ctx);
    const editing = ctx.editor.element.classList.contains("is-editing");
    if (!block?.rect || ctx.view.readOnly || editing) { element.hidden = true; key = ""; return; }
    element.hidden = false;
    const stage = ctx.editor.stage.getBoundingClientRect();
    const host = element.offsetParent?.getBoundingClientRect() ?? stage;
    const { scale } = ctx.view;
    element.style.left = `${Math.max(4, stage.left - host.left + block.rect.left * scale)}px`;
    element.style.top = `${Math.max(4, stage.top - host.top + block.rect.top * scale - 40)}px`;
    const next = `${block.id}|${ctx.view.html.slice(block.range.from, block.range.to)}`;
    if (next === key) return;
    key = next;
    const { kind } = describeDeckBlock(ctx.view.html, block);
    const chip = renderElement("span", { class: "dsh-chip", text: { text: "Text", image: "Image", equation: "Equation", shape: "Shape" }[kind] });
    const more: HTMLButtonElement = actionButton("ellipsis", "More", () => showMenu(more, [
      { label: "Bring to front", onSelect: () => orderSelected(ctx, "front") }, { label: "Send to back", onSelect: () => orderSelected(ctx, "back") },
    ]));
    element.replaceChildren(chip, ...(kind === "text" ? [...textControls(ctx, block.id, readBlockStyle(ctx.view.html, block)), actionButton("edit", "Edit text (Enter)", () => ctx.editor.editText(block.id))] : []),
      actionButton("copy", "Duplicate", () => duplicateSelected(ctx)), actionButton("trash", "Delete", () => deleteSelected(ctx), "dw-action-danger"), more);
  };
  return { element, render };
}

/** Draws one ruler: a tick every cm, longer every 5, labelled every 10, from the stage's offset along the axis. */
function drawRuler(canvas: HTMLCanvasElement, length: number, offset: number, scale: number, vertical: boolean): void {
  const ratio = Math.min(globalThis.devicePixelRatio || 1, 2);
  canvas.width = (vertical ? RULER : length) * ratio;
  canvas.height = (vertical ? length : RULER) * ratio;
  const g = canvas.getContext("2d");
  if (!g) return;
  g.scale(ratio, ratio);
  const style = getComputedStyle(canvas);
  g.strokeStyle = g.fillStyle = style.color;
  g.font = "9px sans-serif";
  const cm = PX_PER_CM * scale;
  const step = cm < 4 ? 5 : 1;
  for (let n = Math.max(0, Math.floor(-offset / cm)); offset + n * cm < length; n += step) {
    const at = Math.round(offset + n * cm) + 0.5;
    const size = n % 10 === 0 ? RULER : n % 5 === 0 ? RULER / 2 : RULER / 4;
    g.beginPath();
    if (vertical) { g.moveTo(RULER - size, at); g.lineTo(RULER, at); } else { g.moveTo(at, RULER - size); g.lineTo(at, RULER); }
    g.stroke();
    if (n % 10 === 0) { if (vertical) { g.save(); g.translate(9, at + 3); g.rotate(-Math.PI / 2); g.fillText(String(n), 0, 0); g.restore(); } else g.fillText(String(n), at + 3, 9); }
  }
}

/** A poster's top and left rulers in cm, following zoom and scroll. */
export function createRulers(ctx: ShellContext): { element: HTMLElement; render(): void } {
  const top = renderElement("canvas", { class: "dsh-ruler dsh-ruler-top" });
  const left = renderElement("canvas", { class: "dsh-ruler dsh-ruler-left" });
  const element = renderElement("div", { class: "dsh-rulers", "aria-hidden": "true" }, top, left, renderElement("span", { class: "dsh-ruler-unit", text: "cm" }));
  return {
    element,
    render() {
      const viewport = ctx.editor.viewport.getBoundingClientRect();
      const stage = ctx.editor.stage.getBoundingClientRect();
      if (viewport.width === 0) return;
      drawRuler(top, viewport.width, stage.left - viewport.left, ctx.view.scale, false);
      drawRuler(left, viewport.height, stage.top - viewport.top, ctx.view.scale, true);
    },
  };
}
