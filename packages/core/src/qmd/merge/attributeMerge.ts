// Merges the opening lines of an item that both sides changed, attribute by attribute.
// CONTRACT: documents/contracts/qmd-items.md#merge
import { formatDivOpener, lineContent, lineEnding, parseDivOpener } from "../items/index.js";

/**
 * Takes each attribute and class from the side that changed it. When both changed an attribute differently, the
 * local value stays, unless local removed it: an edit beats a removal.
 */
export function mergeOpeners(base: string | undefined, local: string, other: string): string {
  const parse = (line: string | undefined) => (line === undefined ? undefined : parseDivOpener(lineContent(line)));
  const [baseAttrs, localAttrs, otherAttrs] = [parse(base), parse(local), parse(other)];
  if (!localAttrs || !otherAttrs) { return local; }
  const baseClasses = new Set(baseAttrs?.classes ?? []);
  const classes = [...new Set([...localAttrs.classes, ...otherAttrs.classes])].filter((name) => {
    const inLocal = localAttrs.classes.includes(name);
    return inLocal === otherAttrs.classes.includes(name) || inLocal !== baseClasses.has(name) ? inLocal : !inLocal;
  });
  const baseValues = new Map(baseAttrs?.pairs.map(([key, value]) => [key, value]));
  const localValues = new Map(localAttrs.pairs.map(([key, value]) => [key, value]));
  const otherValues = new Map(otherAttrs.pairs.map(([key, value]) => [key, value]));
  const pairs: [string, string][] = [];
  for (const key of new Set([...localValues.keys(), ...otherValues.keys()])) {
    const value = mergeValue(baseValues.get(key), localValues.get(key), otherValues.get(key));
    if (value !== undefined) { pairs.push([key, value]); }
  }
  const id = localAttrs.id;
  return formatDivOpener(id === undefined ? { classes, pairs } : { id, classes, pairs }) + lineEnding(local);
}

function mergeValue(base: string | undefined, local: string | undefined, other: string | undefined): string | undefined {
  if (local === other || other === base) { return local; }
  if (local === base) { return other; }
  return local ?? other;
}
