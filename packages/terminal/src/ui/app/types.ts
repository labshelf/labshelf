/**
 * Declares the App's shared types: what it needs from the real terminal, plus the small value types its state, input,
 * actions and drawing modules pass around.
 */
import type { CellRect } from "../../tui/index.js";
import type { InputEvent } from "../../tui/index.js";
import type { Screen } from "../../tui/index.js";
import type { TerminalSize } from "../../tui/index.js";
import type { FolderRowData } from "../render.js";

/** What the App needs from the real terminal; tests and --dump-frame pass a fake. */
export interface TerminalLike {
  size(): TerminalSize;
  listen(onInput: (event: InputEvent) => void, onResize: (size: TerminalSize) => void): void;
  enter(): void;
  leave(): void;
  draw(frame: Screen, extra?: string): void;
  invalidate(): void;
  writeRaw(data: string): void;
  suspend<T>(run: () => T): T;
  stopJob(): void;
}

/** The folders pane key of the "All papers" row; every other key is a folder path relative to papers/ ("" = Unfiled). */
export const ALL = "*all";

export type Focus = "folders" | "papers";

export interface FolderRow extends FolderRowData {
  key: string;
}

export interface Place {
  folder: string;
  search: string | undefined;
}

export interface PaperCursor {
  id: string | undefined;
  index: number;
  offset: number;
}

export interface Message {
  text: string;
  level: "info" | "warn" | "error";
  until: number;
}

export interface ImagePlan {
  key: string;
  rect: CellRect;
  png: Uint8Array;
}

export function parentFolder(rel: string): string {
  if (rel === ALL || rel === "") { return ALL; }
  const i = rel.lastIndexOf("/");
  return i < 0 ? ALL : rel.slice(0, i);
}

export function folderTitle(key: string): string {
  if (key === ALL) { return "All papers"; }
  if (key === "") { return "Unfiled"; }
  return key.split("/").join(" › ");
}
