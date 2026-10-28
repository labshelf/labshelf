// Exposes the Typst 0.14 standard-library catalogue used for completion and hover.
import { CALC, DATA_LOADING, INTROSPECTION, MATH } from "./computation";
import { COLLECTIONS, EVALUATION, NUMBERS, STRINGS, TIME, VALUES } from "./foundation";
import { PAINTS, SHAPES } from "./graphics";
import { LAYOUT } from "./layout";
import { MODEL, TEXT } from "./markup";
import type { TypstBuiltin } from "./typstBuiltin";

export type { TypstBuiltin, TypstParam } from "./typstBuiltin";

export const TYPST_LIBRARY: readonly TypstBuiltin[] = [
  ...NUMBERS, ...STRINGS, ...COLLECTIONS, ...TIME, ...VALUES, ...EVALUATION, CALC,
  ...MODEL, ...TEXT, ...MATH, ...LAYOUT, ...SHAPES, ...PAINTS, ...INTROSPECTION, ...DATA_LOADING,
];
