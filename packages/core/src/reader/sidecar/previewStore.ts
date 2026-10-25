// Keeps a build preview's reading position and theme in memory for the life of its panel and refuses annotation writes.
import type { SidecarPort } from "../../ports/index.js";
import type { ReaderSidecarStore } from "../host/index.js";
import { PaperDataStore } from "./paperSidecarStore.js";

export const PREVIEW_ANNOTATION_REFUSAL = "Annotations are not saved in a build preview.";

function memoryPort(): SidecarPort {
  const files = new Map<string, string>();
  return {
    read: async (paperId) => files.get(paperId) ?? null,
    write: async (paperId, text) => { files.set(paperId, text); },
  };
}

// The controller turns the rejection into a visible notice, so a refused annotation is never dropped silently.
const refuse = (): Promise<never> => Promise.reject(new Error(PREVIEW_ANNOTATION_REFUSAL));

export function createPreviewStore(): ReaderSidecarStore {
  const store = new PaperDataStore(memoryPort());
  return {
    load: (id) => store.load(id),
    getAnnotations: (id) => store.getAnnotations(id),
    setTheme: (id, theme) => store.setTheme(id, theme),
    setReadingState: (id, reading) => store.setReadingState(id, reading),
    addHighlight: refuse,
    addNote: refuse,
    updateAnnotation: refuse,
    deleteAnnotation: refuse,
  };
}
