// Catalogues Typst's containers and transforms: box, block, stack, pad, move, rotate, scale and skew.
import { fn, named, pos, type TypstBuiltin, type TypstParam } from "../typstBuiltin";

const STROKE = "none | length | color | gradient | stroke | tiling | dictionary";

const decoration: readonly TypstParam[] = [
  named("fill", "none | color | gradient | tiling", "none", "The background fill."),
  named("stroke", STROKE, "(:)", "The border stroke, one for all sides or a dictionary by side."),
  named("radius", "relative | dictionary", "(:)", "How much to round the corners."),
  named("inset", "relative | dictionary", "(:)", "How much to pad the content."),
  named("outset", "relative | dictionary", "(:)", "How much to expand the background beyond the size, without affecting layout."),
  named("clip", "bool", "false", "Whether to clip content that overflows the container."),
];

const transform: readonly TypstParam[] = [
  named("origin", "alignment", "center + horizon", "The point the transformation is relative to."),
  named("reflow", "bool", "false", "Whether the transformation affects the layout around the content."),
];

const offset = (axis: "x" | "y") => named(`d${axis}`, "relative", "0% + 0pt", `The ${axis === "x" ? "horizontal" : "vertical"} displacement.`);

export const BOXES: readonly TypstBuiltin[] = [
  fn("box", "An inline container that sizes and decorates content within a paragraph.", [
    pos("body", "none | content", "The content in the box.", "none"),
    named("width", "auto | relative | fraction", "auto", "The box's width."),
    named("height", "auto | relative", "auto", "The box's height."),
    named("baseline", "relative", "0% + 0pt", "How far to shift the box's baseline."),
    ...decoration,
  ], "content"),
  fn("block", "A block-level container that separates content and can be sized and decorated.", [
    pos("body", "none | content", "The content in the block.", "none"),
    named("width", "auto | relative", "auto", "The block's width."),
    named("height", "auto | relative | fraction", "auto", "The block's height."),
    named("breakable", "bool", "true", "Whether the block can break across pages."),
    ...decoration,
    named("spacing", "relative | fraction", "1.2em", "The spacing around the block; shorthand for `above` and `below`."),
    named("above", "auto | relative | fraction", "auto", "The spacing between the block and its predecessor."),
    named("below", "auto | relative | fraction", "auto", "The spacing between the block and its successor."),
    named("sticky", "bool", "false", "Whether the block stays on the same page as the next block."),
  ], "content"),
  fn("stack", "Arranges content and spacing along an axis.", [
    pos("children", "relative | fraction | content", "The items to stack, as any number of arguments."),
    named("dir", "direction", "ttb", "The direction to stack in."),
    named("spacing", "none | relative | fraction", "none", "The spacing inserted between items."),
  ], "content"),
  fn("pad", "Adds spacing around content.", [
    pos("body", "content", "The content to pad."),
    ...["left", "top", "right", "bottom"].map((side) => named(side, "relative", "0% + 0pt", `The padding on the ${side}.`)),
    named("x", "relative", "0% + 0pt", "The horizontal padding, on both sides."),
    named("y", "relative", "0% + 0pt", "The vertical padding, on both sides."),
    named("rest", "relative", "0% + 0pt", "The padding on all sides not otherwise given."),
  ], "content"),
  fn("move", "Moves content without affecting the layout.", [
    pos("body", "content", "The content to move."),
    offset("x"),
    offset("y"),
  ], "content"),
  fn("rotate", "Rotates content.", [
    pos("angle", "angle", "The amount of rotation, clockwise.", "0deg"),
    pos("body", "content", "The content to rotate."),
    ...transform,
  ], "content"),
  fn("scale", "Scales content.", [
    pos("factor", "auto | length | ratio", "The scaling factor for both axes.", "100%"),
    pos("body", "content", "The content to scale."),
    named("x", "auto | length | ratio", "100%", "The horizontal scaling factor, or the target width."),
    named("y", "auto | length | ratio", "100%", "The vertical scaling factor, or the target height."),
    ...transform,
  ], "content"),
  fn("skew", "Skews content.", [
    pos("body", "content", "The content to skew."),
    named("ax", "angle", "0deg", "The horizontal skewing angle."),
    named("ay", "angle", "0deg", "The vertical skewing angle."),
    ...transform,
  ], "content"),
];
