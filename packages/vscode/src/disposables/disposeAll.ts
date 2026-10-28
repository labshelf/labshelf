// Disposes a list of disposables in the order given.

/** Disposes each item in order; a throwing dispose stops the rest, as the loops it replaces did. */
export function disposeAll(items: readonly { dispose(): unknown }[]): void {
  for (const item of items) { item.dispose(); }
}
