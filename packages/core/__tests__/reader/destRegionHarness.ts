// Page layouts and text line builders shared by the destRegion tests.
import type { PageLayout } from "../../src/reader/destTarget";
import type { TextLine } from "../../src/reader/textLines";

export const W = 612;
export const H = 792;
export const SPLIT = 306;
export const single: PageLayout = { width: W, height: H, columnSplit: null };
export const twoCol: PageLayout = { width: W, height: H, columnSplit: SPLIT };

export const line = (text: string, y: number, over: Partial<TextLine> = {}): TextLine =>
  ({ text, x: 72, xEnd: 540, y, height: 11, column: 0, ...over });
export const body = (fromY: number, count: number, over: Partial<TextLine> = {}): TextLine[] =>
  Array.from({ length: count }, (_, i) => line("Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod", fromY - i * 15, over));

export const THM = "Theorem 2.1. Let f be continuous on a closed interval and let";
export const CONT = "then f attains every value between its endpoint values on it";

export const LEFT = { x: 72, xEnd: 290, column: 0 };
export const RIGHT = { x: 322, xEnd: 540, column: 1 };
