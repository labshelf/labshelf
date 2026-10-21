// Mounts the glossary empty state for a Space.
import { emptyState } from "../../../ui/dom/index.js";
export function mountSpaceGlossary(root: HTMLElement): () => void {
  root.replaceChildren(emptyState({ text: "No terms yet." }));
  return () => root.replaceChildren();
}
