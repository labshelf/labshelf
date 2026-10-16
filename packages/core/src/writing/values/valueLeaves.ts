/** Flattens parsed JSON into the number, string and boolean leaves that sources read by key. */
// CONTRACT: documents/contracts/library-format.md#labshelf-valuestex

export type LeafValue = number | string | boolean;

export interface ValueLeaf {
  /** `<file name without .json>.<dotted path>`: what `\lsvalue` takes. */
  key: string;
  value: LeafValue;
  /** The JSON file as listed under `values:`, relative to the project folder. */
  file: string;
  /** Dotted path of the leaf inside the file. */
  path: string;
}

export interface FlattenedValues {
  leaves: ValueLeaf[];
  /** Keys of leaves left out because the key has a character a LaTeX control sequence name cannot carry. */
  skipped: string[];
}

const KEY_CHARACTERS = /^[A-Za-z0-9._-]+$/;

/** The key prefix of a value file: its name without `.json`. */
export const valueFileBase = (file: string): string => file.replace(/^.*\//, "").replace(/\.json$/i, "");

function isLeaf(node: unknown): node is LeafValue {
  return typeof node === "number" || typeof node === "string" || typeof node === "boolean";
}

/** Leaves in document order; `null` is skipped, array items are numbered from 0. */
export function flattenValues(file: string, json: unknown): FlattenedValues {
  const base = valueFileBase(file);
  const leaves: ValueLeaf[] = [];
  const skipped: string[] = [];
  const visit = (node: unknown, path: string): void => {
    if (isLeaf(node)) {
      const key = `${base}.${path}`;
      if (KEY_CHARACTERS.test(key)) { leaves.push({ key, value: node, file, path }); } else { skipped.push(key); }
      return;
    }
    if (node === null || typeof node !== "object") { return; }
    const children = Array.isArray(node) ? node.map((item, index): [string, unknown] => [String(index), item]) : Object.entries(node);
    for (const [name, child] of children) { visit(child, path === "" ? name : `${path}.${name}`); }
  };
  // A file whose root is a single value has no path to name it by.
  if (json !== null && typeof json === "object") { visit(json, ""); }
  return { leaves, skipped };
}
