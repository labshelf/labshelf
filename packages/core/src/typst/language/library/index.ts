// Exposes the Typst 0.14 standard-library catalogue used for completion and hover.
import { COLLECTIONS } from "./arrays";
import { PAINTS } from "./colors";
import { VALUES } from "./content";
import { CALC } from "./derive";
import { EVALUATION } from "./evaluation";
import { DATA_LOADING } from "./fileLoading";
import { INTROSPECTION } from "./introspection";
import { LAYOUT } from "./layout/index";
import { MATH } from "./math";
import { MODEL } from "./model";
import { NUMBERS } from "./numbers";
import { SHAPES } from "./shapes";
import { STRINGS } from "./strings";
import { TEXT } from "./text";
import { TIME } from "./time";
import type { TypstBuiltin } from "./typstBuiltin";

export type { TypstBuiltin, TypstParam } from "./typstBuiltin";

export const TYPST_LIBRARY: readonly TypstBuiltin[] = [
  ...NUMBERS, ...STRINGS, ...COLLECTIONS, ...TIME, ...VALUES, ...EVALUATION, CALC,
  ...MODEL, ...TEXT, ...MATH, ...LAYOUT, ...SHAPES, ...PAINTS, ...INTROSPECTION, ...DATA_LOADING,
];
