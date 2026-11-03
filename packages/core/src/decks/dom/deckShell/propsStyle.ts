// The Style tab of the deck workspace's properties panel: typography, colour, alignment and spacing of a text block, fill and stroke
// of a shape, the TeX of an equation and the picture of an image; each change one undo step.
import { renderElement } from "../../../ui/dom/index.js";
import { applyDeckEdit } from "../../deckEdit.js";
import { describeDeckBlock, setDeckImageSource } from "../../deckBlocks.js";
import type { DeckBlock } from "../../deckParse.js";
import { readBlockShape, readBlockStyle, setBlockShapeStyle, setBlockStyle, type DeckTextDeclaration } from "../../deckStyle.js";
import { button, colour, field, grid, input, row, section, select, toggle } from "./fields.js";
import type { ShellContext } from "./types.js";

const FONTS: ReadonlyArray<readonly [string, string]> = [["Theme", ""], ["Inter", "Inter, system-ui, sans-serif"], ["Source Serif 4", "'Source Serif 4', Georgia, serif"], ["Georgia", "Georgia, 'Times New Roman', serif"], ["Mono", "ui-monospace, Menlo, monospace"]];
const WEIGHTS: ReadonlyArray<readonly [string, string]> = [["Theme", ""], ["Regular", "400"], ["Medium", "500"], ["Semibold", "600"], ["Bold", "700"], ["Black", "800"]];
const ALIGNS = ["left", "center", "right", "justify"] as const;
const number = (value: string | undefined): string => (value ? String(Number.parseFloat(value) || "") : "");

/** Writes text declarations of a block as one step. */
export function setStyle(ctx: ShellContext, id: string, changes: Partial<Record<DeckTextDeclaration, string | null>>, label: string): void {
  ctx.edit([(html) => setBlockStyle(html, id, changes)], label, [id]);
}

/** The B, I, U and S toggles of a text block. */
export function emphasisToggles(ctx: ShellContext, id: string, style: Record<string, string>): HTMLElement[] {
  const decoration = style["text-decoration"] ?? "";
  const bold = Number(style["font-weight"]) >= 600 || style["font-weight"] === "bold";
  return [
    toggle({ icon: "bold" }, "Bold", bold, () => setStyle(ctx, id, { "font-weight": bold ? null : "700" }, "Bold")),
    toggle({ icon: "italic" }, "Italic", style["font-style"] === "italic", () => setStyle(ctx, id, { "font-style": style["font-style"] === "italic" ? null : "italic" }, "Italic")),
    toggle({ icon: "underline" }, "Underline", decoration.includes("underline"), () => setStyle(ctx, id, { "text-decoration": decoration.includes("underline") ? null : "underline" }, "Underline")),
    toggle({ text: "S", style: "text-decoration: line-through" }, "Strikethrough", decoration.includes("line-through"), () => setStyle(ctx, id, { "text-decoration": decoration.includes("line-through") ? null : "line-through" }, "Strikethrough")),
  ];
}

function typography(ctx: ShellContext, id: string, style: Record<string, string>): HTMLElement {
  const set = (name: DeckTextDeclaration, label: string) => (value: string): void => setStyle(ctx, id, { [name]: value || null }, label);
  const alignRow = row(...ALIGNS.map((align) => toggle({ text: align[0]!.toUpperCase() + align.slice(1) }, `Align ${align}`, style["text-align"] === align, () => set("text-align", "Alignment")(style["text-align"] === align ? "" : align))));
  return section("Typography",
    select(FONTS, style["font-family"] ?? "", set("font-family", "Typeface")),
    grid(input("number", number(style["font-size"]), (value) => set("font-size", "Text size")(value ? `${value}px` : ""), { min: "4", title: "Size (px)", placeholder: "Size" }),
      select(WEIGHTS, style["font-weight"] ?? "", set("font-weight", "Text weight"))),
    row(...emphasisToggles(ctx, id, style)),
    field("Colour", colour(style["color"], set("color", "Text colour"))),
    field("Line height", input("number", number(style["line-height"]), set("line-height", "Line height"), { step: "0.1", min: "0.5" })),
    field("Alignment", alignRow));
}

function spacing(ctx: ShellContext, id: string, style: Record<string, string>): HTMLElement {
  const side = (name: DeckTextDeclaration, label: string): HTMLElement =>
    field(label, input("number", number(style[name]), (value) => setStyle(ctx, id, { [name]: value ? `${value}px` : null }, "Spacing"), { min: "0" }));
  return section("Spacing", grid(side("padding-top", "Space before"), side("padding-bottom", "Space after"), side("padding-left", "Indent left"), side("padding-right", "Indent right")));
}

function shapeStyle(ctx: ShellContext, block: DeckBlock): HTMLElement[] {
  const shape = readBlockShape(ctx.view.html, block)!;
  const set = (changes: Parameters<typeof setBlockShapeStyle>[2], label: string): void => ctx.edit([(html) => setBlockShapeStyle(html, block.id, changes)], label, [block.id]);
  return [section("Shape",
    ...(shape.kind === "line" ? [] : [field("Fill", colour(shape.style.fill, (fill) => set({ fill }, "Shape fill")))]),
    field("Stroke", colour(shape.style.stroke, (stroke) => set({ stroke }, "Shape stroke"))),
    field("Stroke width", input("number", String(shape.style.strokeWidth), (value) => set({ strokeWidth: Number(value) }, "Shape stroke"), { min: "0", max: "100" })))];
}

function equationStyle(ctx: ShellContext, block: DeckBlock): HTMLElement[] {
  const leaf = block.leaves.findIndex((candidate) => candidate.math);
  const tex = block.leaves[leaf]?.text ?? "";
  const area = input("text", tex, (text) => ctx.edit([(html) => applyDeckEdit(html, { kind: "setText", block: block.id, leaf, text })], "Edit equation", [block.id]));
  return [section("Equation", field("TeX", area))];
}

function imageStyle(ctx: ShellContext, block: DeckBlock): HTMLElement[] {
  const pick = ctx.options.pickImage;
  if (!pick) return [section("Image", renderElement("p", { class: "dw-props-note", text: "Edit the image path in the HTML source." }))];
  return [section("Image", button("Replace image…", () => void pick().then((src) => { if (src) ctx.edit([(html) => setDeckImageSource(html, block.id, src)], "Replace image", [block.id]); }), "file-media"))];
}

/** The Style tab of the selected block. */
export function styleTab(ctx: ShellContext, block: DeckBlock): HTMLElement[] {
  const { kind } = describeDeckBlock(ctx.view.html, block);
  if (kind === "shape") return shapeStyle(ctx, block);
  if (kind === "equation") return equationStyle(ctx, block);
  if (kind === "image") return imageStyle(ctx, block);
  const style = readBlockStyle(ctx.view.html, block);
  return [typography(ctx, block.id, style), spacing(ctx, block.id, style)];
}
