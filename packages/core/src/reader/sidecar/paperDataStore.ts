/** Loads, modifies and saves the per-paper sidecar, serializing the work per paper. */
import type { Annotation, PdfTheme } from "../../model/index.js";
import type { ILogger, SidecarPort } from "../../ports/index.js";
import { validateAnnotationColor, validateAnnotationPosition, validatePageNumber } from "./annotationValidation.js";
import { byPageThenCreated, emptyPaperData, normalizePaperData, serializePaperData, type PaperData } from "./paperData.js";
import type { ReadingState } from "./readingState.js";

export interface PaperDataStoreOptions {
  now?: () => string;
  newId?: () => string;
  /** Receives a warning when a sidecar cannot be parsed and loads as empty. */
  logger?: ILogger;
}

/**
 * Load-modify-save over one sidecar per paper. Every mutator of a paper runs in a per-paper queue: the reader saves the
 * reading position while scrolling, and without serialization a position write racing an annotation write drops one.
 */
export class PaperDataStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => string;
  private readonly newId: () => string;
  private readonly logger: ILogger | undefined;

  constructor(private readonly port: SidecarPort, options: PaperDataStoreOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.newId = options.newId ?? (() => globalThis.crypto.randomUUID());
    this.logger = options.logger;
  }

  private enqueue<T>(paperId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(paperId) ?? Promise.resolve();
    // A failed write must not poison the writes queued behind it.
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.queues.set(paperId, settled);
    void settled.then(() => {
      if (this.queues.get(paperId) === settled) { this.queues.delete(paperId); }
    });
    return next;
  }

  /**
   * @returns the paper's sidecar, or empty data when it is absent or unreadable.
   */
  async load(paperId: string): Promise<PaperData> {
    const text = await this.port.read(paperId);
    if (text === null) { return emptyPaperData(); }
    try {
      return normalizePaperData(JSON.parse(text) as unknown);
    } catch (error) {
      void this.logger?.log("WARN", "sidecar", "Sidecar is not valid JSON; loading it as empty", { paperId, error: String(error) });
      return emptyPaperData();
    }
  }

  private async mutate<T>(paperId: string, change: (data: PaperData) => T | null): Promise<T | null> {
    return this.enqueue(paperId, async () => {
      const data = await this.load(paperId);
      const result = change(data);
      if (result !== null) { await this.port.write(paperId, serializePaperData(data)); }
      return result;
    });
  }

  /**
   * @returns the paper's annotations, by page then creation time.
   */
  async getAnnotations(paperId: string): Promise<Annotation[]> {
    return [...(await this.load(paperId)).annotations].sort(byPageThenCreated);
  }

  /**
   * Validates: known color, positive integer page, non-empty text, normalized position.
   * @returns the stored highlight.
   */
  async addHighlight(
    paperId: string,
    pageNumber: number,
    content: string,
    color: string,
    position?: unknown,
  ): Promise<Annotation> {
    const validColor = validateAnnotationColor(color);
    validatePageNumber(pageNumber);
    if (!content.trim()) { throw new Error("Highlight content cannot be empty"); }
    const validPosition = position === undefined ? undefined : validateAnnotationPosition(position);
    return this.add(paperId, {
      type: "highlight", pageNumber, content, color: validColor, ...(validPosition ? { position: validPosition } : {}),
    });
  }

  /**
   * @returns the stored note.
   */
  async addNote(paperId: string, pageNumber: number, content: string): Promise<Annotation> {
    validatePageNumber(pageNumber);
    if (!content.trim()) { throw new Error("Note content cannot be empty"); }
    return this.add(paperId, { type: "note", pageNumber, content });
  }

  private async add(paperId: string, fields: Pick<Annotation, "type" | "pageNumber" | "content" | "color" | "position">): Promise<Annotation> {
    const at = this.now();
    // Key order is the on-disk contract (library-format.md), so every app writes the same bytes.
    const annotation: Annotation = {
      id: this.newId(), paperId, type: fields.type, pageNumber: fields.pageNumber, content: fields.content,
      ...(fields.color === undefined ? {} : { color: fields.color }),
      ...(fields.position === undefined ? {} : { position: fields.position }),
      createdAt: at, updatedAt: at,
    };
    await this.mutate(paperId, (data) => { data.annotations.push(annotation); return annotation; });
    return annotation;
  }

  /**
   * @returns the updated annotation; throws when the content is empty or the id is unknown.
   */
  async updateAnnotation(paperId: string, id: string, content: string): Promise<Annotation> {
    if (!content.trim()) { throw new Error("Annotation content cannot be empty"); }
    const updated = await this.mutate(paperId, (data) => {
      const index = data.annotations.findIndex((a) => a.id === id);
      if (index === -1) { return null; }
      const next: Annotation = { ...data.annotations[index]!, content, updatedAt: this.now() };
      data.annotations[index] = next;
      return next;
    });
    if (!updated) { throw new Error(`Annotation not found: ${id}`); }
    return updated;
  }

  /**
   * Removing an id that does not exist is a no-op and does not rewrite the file.
   * @returns true when an annotation was removed.
   */
  async deleteAnnotation(paperId: string, id: string): Promise<boolean> {
    const removed = await this.mutate(paperId, (data) => {
      const kept = data.annotations.filter((a) => a.id !== id);
      if (kept.length === data.annotations.length) { return null; }
      data.annotations = kept;
      return true;
    });
    return removed === true;
  }

  /**
   * @returns the paper's stored reader theme ("auto" when never chosen).
   */
  async getTheme(paperId: string): Promise<PdfTheme> {
    return (await this.load(paperId)).theme;
  }

  async setTheme(paperId: string, theme: PdfTheme): Promise<void> {
    await this.mutate(paperId, (data) => { data.theme = theme; return true; });
  }

  /**
   * @returns the last reading position, or null when the paper was never opened.
   */
  async getReadingState(paperId: string): Promise<ReadingState | null> {
    return (await this.load(paperId)).reading ?? null;
  }

  async setReadingState(paperId: string, reading: ReadingState): Promise<void> {
    await this.mutate(paperId, (data) => { data.reading = reading; return true; });
  }
}
