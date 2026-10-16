/** Reads and edits a project's device-local state file, which records where the user last edited, keeping keys other versions wrote. */
// CONTRACT: documents/contracts/library-format.md#labshelfstatejson

/** The folder inside a project that holds device-local state. */
export const PROJECT_STATE_DIR = ".labshelf";
export const PROJECT_STATE_FILE = "state.json";

/** The last edit position of a project, 0-based like the VS Code API. */
export interface ProjectCursor {
  /** Relative to the project folder, "/"-separated. */
  file: string;
  line: number;
  character: number;
  /** ISO timestamp. */
  updatedAt: string;
}

/** The whole file: the cursor keys plus any key another version wrote. */
export type ProjectState = Record<string, unknown>;

/** @returns undefined when the text is not a JSON object, so the caller can refuse to overwrite it */
export function parseProjectState(text: string): ProjectState | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  return raw !== null && typeof raw === "object" && !Array.isArray(raw) ? raw as ProjectState : undefined;
}

// The file is read from a folder that can be shared or copied, so a path that leaves the project is rejected.
function isProjectRelative(file: string): boolean {
  return file !== "" && !file.includes("\\") && !file.startsWith("/") && !/^[A-Za-z]:/.test(file)
    && !file.split("/").some((part) => part === ".." || part === "");
}

const isIndex = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;

/** @returns the cursor the state holds, or undefined when any of its four keys is missing or invalid */
export function cursorOf(state: ProjectState): ProjectCursor | undefined {
  const { file, line, character, updatedAt } = state;
  if (typeof file !== "string" || !isProjectRelative(file) || !isIndex(line) || !isIndex(character)) { return undefined; }
  if (typeof updatedAt !== "string" || Number.isNaN(Date.parse(updatedAt))) { return undefined; }
  return { file, line, character, updatedAt };
}

export function withCursor(state: ProjectState, cursor: ProjectCursor): ProjectState {
  const { file, line, character, updatedAt } = cursor;
  return { ...state, file, line, character, updatedAt };
}

export function serializeProjectState(state: ProjectState): string {
  return `${JSON.stringify(state, null, 2)}\n`;
}

/** @returns the item whose cursor was written last; undefined for an empty list */
export function newestCursor<T extends { cursor: ProjectCursor }>(items: readonly T[]): T | undefined {
  let newest: T | undefined;
  for (const item of items) {
    if (!newest || Date.parse(item.cursor.updatedAt) > Date.parse(newest.cursor.updatedAt)) { newest = item; }
  }
  return newest;
}
