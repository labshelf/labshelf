/** Tells which file events in the library folders are not library changes: atomic-write temps and editor droppings. */

// Atomic writes (library/node/atomicWrite.ts, vscodeFileSystem.ts) stage `.<name>.<uuid>.tmp` beside the target.
export function isExternalChangeNoise(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  return (name.startsWith(".") && name.endsWith(".tmp")) || name === ".DS_Store" || name.endsWith("~") || name.endsWith(".swp");
}
