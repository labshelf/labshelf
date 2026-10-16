// Parses, edits and serializes a project's .labshelf/checklist.json, keeping what it does not understand.
// CONTRACT: documents/contracts/library-format.md#labshelfchecklistjson
import { parseJsonObject } from "../project/index.js";

export const CHECKLIST_DIR = ".labshelf";
export const CHECKLIST_FILE = "checklist.json";

/** An item a user added to a project's Checklist by hand. */
export interface ManualItem {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  doneAt?: string;
}

/** The whole file: invalid items and unknown keys are carried so a rewrite loses nothing. */
export interface ChecklistDocument {
  [key: string]: unknown;
  items: readonly unknown[];
}

/** @returns undefined when the text is not a JSON object with an `items` array */
export function parseChecklistFile(text: string): ChecklistDocument | undefined {
  const raw = parseJsonObject(text);
  if (raw === undefined || !Array.isArray(raw["items"])) { return undefined; }
  return raw as ChecklistDocument;
}

export function serializeChecklistFile(doc: ChecklistDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// The file syncs from other machines, so every key is checked; doneAt must be present exactly when done is true.
function isManualItem(value: unknown): value is ManualItem {
  if (!isRecord(value)) { return false; }
  const { id, text, done, createdAt, doneAt } = value;
  if (typeof id !== "string" || id === "" || typeof text !== "string" || text === "") { return false; }
  if (typeof done !== "boolean" || !isTimestamp(createdAt)) { return false; }
  return done ? isTimestamp(doneAt) : doneAt === undefined;
}

/** @returns the valid items in file order */
export function manualItems(doc: ChecklistDocument): ManualItem[] {
  return doc.items.filter(isManualItem).map(({ id, text, done, createdAt, doneAt }) =>
    doneAt === undefined ? { id, text, done, createdAt } : { id, text, done, createdAt, doneAt });
}

export function addManualItem(doc: ChecklistDocument, entry: { id: string; text: string; now: string }): ChecklistDocument {
  const item: ManualItem = { id: entry.id, text: entry.text, done: false, createdAt: entry.now };
  return { ...doc, items: [...doc.items, item] };
}

/** An unknown id returns the document unchanged. */
export function setManualItemDone(doc: ChecklistDocument, id: string, done: boolean, now: string): ChecklistDocument {
  return {
    ...doc,
    items: doc.items.map((item) => {
      if (!isManualItem(item) || item.id !== id) { return item; }
      const { doneAt: _doneAt, ...rest } = item as ManualItem & Record<string, unknown>;
      return done ? { ...rest, done, doneAt: now } : { ...rest, done };
    }),
  };
}

/** An unknown id returns the document unchanged. */
export function removeManualItem(doc: ChecklistDocument, id: string): ChecklistDocument {
  return { ...doc, items: doc.items.filter((item) => !isManualItem(item) || item.id !== id) };
}
