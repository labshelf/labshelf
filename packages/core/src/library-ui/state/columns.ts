// Names the optional list columns, their fixed order and the ones shown by default.
import type { SortKey } from "./viewState.js";

/** Every list column except the title, which is always shown. */
export type ColumnKey = Exclude<SortKey, "title">;

export const COLUMN_KEYS: readonly ColumnKey[] = ["creator", "venue", "year", "lastRead", "status"];

export const DEFAULT_COLUMNS: ColumnKey[] = ["creator", "year", "status"];
