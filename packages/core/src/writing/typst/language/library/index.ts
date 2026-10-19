// Exposes the Typst 0.14 standard-library catalogue used for completion and hover.
import { DATA_LOADING } from "./dataLoading";
import { FOUNDATIONS } from "./foundations/index";
import { INTROSPECTION } from "./introspection";
import { LAYOUT } from "./layout/index";
import { MATH } from "./math";
import { MODEL } from "./model";
import { TEXT } from "./text";
import type { TypstBuiltin } from "./typstBuiltin";
import { VISUALIZE } from "./visualize/index";

export type { TypstBuiltin, TypstParam } from "./typstBuiltin";

export const TYPST_LIBRARY: readonly TypstBuiltin[] = [
  ...FOUNDATIONS, ...MODEL, ...TEXT, ...MATH, ...LAYOUT, ...VISUALIZE, ...INTROSPECTION, ...DATA_LOADING,
];
