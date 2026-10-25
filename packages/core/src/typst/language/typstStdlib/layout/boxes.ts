// Catalogues Typst's containers and transforms: box, block, stack, pad, move, rotate, scale and skew.
import { createFunctionBuiltin, createNamedParam, createPositionalParam, type TypstBuiltin, type TypstParam } from "../typstBuiltin";

const STROKE = "none | length | color | gradient | stroke | tiling | dictionary";

const decoration: readonly TypstParam[] = [
  createNamedParam("fill", "none | color | gradient | tiling", "none", "The background fill."),
  createNamedParam("stroke", STROKE, "(:)", "The border stroke, one for all sides or a dictionary by side."),
  createNamedParam("radius", "relative | dictionary", "(:)", "How much to round the corners."),
  createNamedParam("inset", "relative | dictionary", "(:)", "How much to pad the content."),
  createNamedParam("outset", "relative | dictionary", "(:)", "How much to expand the background beyond the size, without affecting layout."),
  createNamedParam("clip", "bool", "false", "Whether to clip content that overflows the container."),
];

const transform: readonly TypstParam[] = [
  createNamedParam("origin", "alignment", "center + horizon", "The point the transformation is relative to."),
  createNamedParam("reflow", "bool", "false", "Whether the transformation affects the layout around the content."),
];

const offset = (axis: "x" | "y") => createNamedParam(`d${axis}`, "relative", "0% + 0pt", `The ${axis === "x" ? "horizontal" : "vertical"} displacement.`);

export const BOXES: readonly TypstBuiltin[] = [
  createFunctionBuiltin("box", "An inline container that sizes and decorates content within a paragraph.", [
    createPositionalParam("body", "none | content", "The content in the box.", "none"),
    createNamedParam("width", "auto | relative | fraction", "auto", "The box's width."),
    createNamedParam("height", "auto | relative", "auto", "The box's height."),
    createNamedParam("baseline", "relative", "0% + 0pt", "How far to shift the box's baseline."),
    ...decoration,
  ], "content"),
  createFunctionBuiltin("block", "A block-level container that separates content and can be sized and decorated.", [
    createPositionalParam("body", "none | content", "The content in the block.", "none"),
    createNamedParam("width", "auto | relative", "auto", "The block's width."),
    createNamedParam("height", "auto | relative | fraction", "auto", "The block's height."),
    createNamedParam("breakable", "bool", "true", "Whether the block can break across pages."),
    ...decoration,
    createNamedParam("spacing", "relative | fraction", "1.2em", "The spacing around the block; shorthand for `above` and `below`."),
    createNamedParam("above", "auto | relative | fraction", "auto", "The spacing between the block and its predecessor."),
    createNamedParam("below", "auto | relative | fraction", "auto", "The spacing between the block and its successor."),
    createNamedParam("sticky", "bool", "false", "Whether the block stays on the same page as the next block."),
  ], "content"),
  createFunctionBuiltin("stack", "Arranges content and spacing along an axis.", [
    createPositionalParam("children", "relative | fraction | content", "The items to stack, as any number of arguments."),
    createNamedParam("dir", "direction", "ttb", "The direction to stack in."),
    createNamedParam("spacing", "none | relative | fraction", "none", "The spacing inserted between items."),
  ], "content"),
  createFunctionBuiltin("pad", "Adds spacing around content.", [
    createPositionalParam("body", "content", "The content to pad."),
    ...["left", "top", "right", "bottom"].map((side) => createNamedParam(side, "relative", "0% + 0pt", `The padding on the ${side}.`)),
    createNamedParam("x", "relative", "0% + 0pt", "The horizontal padding, on both sides."),
    createNamedParam("y", "relative", "0% + 0pt", "The vertical padding, on both sides."),
    createNamedParam("rest", "relative", "0% + 0pt", "The padding on all sides not otherwise given."),
  ], "content"),
  createFunctionBuiltin("move", "Moves content without affecting the layout.", [
    createPositionalParam("body", "content", "The content to move."),
    offset("x"),
    offset("y"),
  ], "content"),
  createFunctionBuiltin("rotate", "Rotates content.", [
    createPositionalParam("angle", "angle", "The amount of rotation, clockwise.", "0deg"),
    createPositionalParam("body", "content", "The content to rotate."),
    ...transform,
  ], "content"),
  createFunctionBuiltin("scale", "Scales content.", [
    createPositionalParam("factor", "auto | length | ratio", "The scaling factor for both axes.", "100%"),
    createPositionalParam("body", "content", "The content to scale."),
    createNamedParam("x", "auto | length | ratio", "100%", "The horizontal scaling factor, or the target width."),
    createNamedParam("y", "auto | length | ratio", "100%", "The vertical scaling factor, or the target height."),
    ...transform,
  ], "content"),
  createFunctionBuiltin("skew", "Skews content.", [
    createPositionalParam("body", "content", "The content to skew."),
    createNamedParam("ax", "angle", "0deg", "The horizontal skewing angle."),
    createNamedParam("ay", "angle", "0deg", "The vertical skewing angle."),
    ...transform,
  ], "content"),
];
