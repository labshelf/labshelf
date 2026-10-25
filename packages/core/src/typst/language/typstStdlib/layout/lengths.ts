// Catalogues Typst's layout value types (length, alignment, direction, angle, ratio, fraction, relative) and their named values.
import { createFunctionBuiltin, createTypeBuiltin, createConstantBuiltin, type TypstBuiltin } from "../typstBuiltin";

const method = (name: string, doc: string, returns: string): TypstBuiltin => createFunctionBuiltin(name, doc, [], returns);
const unit = (name: string, unitName: string) => method(name, `Converts an absolute length to a number of ${unitName}.`, "float");

const ALIGNMENTS: readonly [string, string][] = [
  ["start", "Aligns at the start of the text direction."], ["end", "Aligns at the end of the text direction."],
  ["left", "Aligns at the left."], ["center", "Aligns at the horizontal centre."], ["right", "Aligns at the right."],
  ["top", "Aligns at the top."], ["horizon", "Aligns at the vertical middle."], ["bottom", "Aligns at the bottom."],
];
const DIRECTIONS: readonly [string, string][] = [
  ["ltr", "The left-to-right direction."], ["rtl", "The right-to-left direction."],
  ["ttb", "The top-to-bottom direction."], ["btt", "The bottom-to-top direction."],
];

export const VALUES: readonly TypstBuiltin[] = [
  createTypeBuiltin("length", "A size or distance, absolute (`1pt`, `2mm`, `3cm`, `4in`) or relative to the font size (`1em`).", undefined, [
    unit("pt", "points"), unit("mm", "millimeters"), unit("cm", "centimeters"), unit("inches", "inches"),
    method("to-absolute", "Resolves the length to an absolute one, using the current font size; needs `context`.", "length"),
  ]),
  createTypeBuiltin("alignment", "Where to align something along the horizontal and vertical axes; combine them with `+`.", undefined, [
    method("axis", "The axis of the alignment, `\"horizontal\"` or `\"vertical\"`, or `none` for a 2D alignment.", "none | str"),
    method("inv", "The inverse alignment, such as `right` for `left`.", "alignment"),
  ]),
  createTypeBuiltin("direction", "The four directions in which content can be laid out.", undefined, [
    method("axis", "The axis of the direction, `\"horizontal\"` or `\"vertical\"`.", "str"),
    method("start", "The alignment at which the direction starts.", "alignment"),
    method("end", "The alignment at which the direction ends.", "alignment"),
    method("inv", "The opposite direction.", "direction"),
  ]),
  createTypeBuiltin("angle", "An angle, in degrees (`90deg`) or radians (`1rad`).", undefined, [
    method("rad", "Converts the angle to a number of radians.", "float"),
    method("deg", "Converts the angle to a number of degrees.", "float"),
  ]),
  createTypeBuiltin("ratio", "A part of a whole, written as a percentage such as `50%`.", undefined, []),
  createTypeBuiltin("fraction", "A part of the remaining space, written as `1fr`; spaces are shared in proportion to their fractions.", undefined, []),
  createTypeBuiltin("relative", "A length plus a ratio of the container's size, such as `50% + 1cm`.", undefined, []),
  ...ALIGNMENTS.map(([name, doc]) => createConstantBuiltin(name, doc)),
  ...DIRECTIONS.map(([name, doc]) => createConstantBuiltin(name, doc)),
];
