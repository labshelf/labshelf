// Names the optional list columns, their fixed order and the ones shown by default.
import type { SortColumn } from "./viewState.js";

/** Every list column except the title, which is always shown. */
export type ListColumn = Exclude<SortColumn, "title">;

export const COLUMN_KEYS: readonly ListColumn[] = ["creator", "venue", "year", "lastRead", "status"];

export const DEFAULT_COLUMNS: ListColumn[] = ["creator", "year", "status"];
