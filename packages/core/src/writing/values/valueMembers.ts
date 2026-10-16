/** Lists the names directly under a path of a JSON value file, for member completion. */

import type { ValueLeaf } from "./valueLeaves.js";

export interface ValueMember {
  name: string;
  /** The value itself when the member is a leaf; undefined when it holds more members. */
  leaf: ValueLeaf | undefined;
}

/** Members of `parent` (dotted, "" for the root) in `file`; array indexes are left out because Typst reads them with `.at()`. */
export function valueMembers(leaves: readonly ValueLeaf[], file: string, parent: string): ValueMember[] {
  const prefix = parent === "" ? "" : `${parent}.`;
  const members = new Map<string, ValueLeaf | undefined>();
  for (const leaf of leaves) {
    if (leaf.file !== file || !leaf.path.startsWith(prefix)) { continue; }
    const rest = leaf.path.slice(prefix.length);
    const dot = rest.indexOf(".");
    const name = dot < 0 ? rest : rest.slice(0, dot);
    if (!/^\d+$/.test(name)) { members.set(name, dot < 0 ? leaf : undefined); }
  }
  return [...members].map(([name, leaf]) => ({ name, leaf }));
}
