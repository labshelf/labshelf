// Defines the per-paper sidecar and the stores over it: the on-disk store and the in-memory preview store.
import { isPdfTheme, type Annotation, type PdfTheme, ANNOTATION_COLORS, type AnnotationColor, type AnnotationPosition } from "../../model/index.js";
import { normalizeReadingPosition, type ReadingState } from "./readingState.js";
import type { ILogger, SidecarPort } from "../../ports/index.js";

// Defines the per-paper sidecar (data.json: annotations, theme, reading position) every app reads and writes.
// INVARIANT: every app reads and writes the same data.json, so the format must not drift.

export interface PaperSidecar {
  annotations: Annotation[];
  theme: PdfTheme;
  /** Last reading position; absent until the paper has been opened in the reader. */
  reading?: ReadingState;
  /** Annotations the user removed, so a stale copy of the file cannot bring them back. Absent when there are none. */
  deleted?: DeletedAnnotation[];
}

export interface DeletedAnnotation {
  id: string;
  /** ISO time of the deletion, comparable with an annotation's `updatedAt`. */
  deletedAt: string;
}

/** How long a deletion marker is kept; a stale copy older than this is assumed not to exist. */
const DELETION_MARKER_DAYS = 90;

function isDeletionMarker(value: unknown): value is DeletedAnnotation {
  if (!value || typeof value !== "object") { return false; }
  const marker = value as Record<string, unknown>;
  return typeof marker["id"] === "string" && typeof marker["deletedAt"] === "string"
    && Number.isFinite(Date.parse(marker["deletedAt"]));
}

/**
 * @returns the markers deleted within `DELETION_MARKER_DAYS` before `now`.
 */
export function removeStaleDeletionMarkers(markers: DeletedAnnotation[], now: string): DeletedAnnotation[] {
  const cutoff = new Date(Date.parse(now) - DELETION_MARKER_DAYS * 86_400_000).toISOString();
  return markers.filter((m) => m.deletedAt >= cutoff);
}

/**
 * @returns the sidecar of a paper that has never been opened.
 */
export function createEmptyPaperSidecar(): PaperSidecar {
  return { annotations: [], theme: "auto" };
}

/**
 * Defensive normalization so a corrupt or hand-edited sidecar never throws and never half-applies.
 * @returns clean PaperSidecar; unknown or malformed fields fall back to their defaults.
 */
export function normalizePaperSidecar(parsed: unknown): PaperSidecar {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) { return createEmptyPaperSidecar(); }
  const obj = parsed as Record<string, unknown>;
  const annotations = Array.isArray(obj["annotations"])
    ? (obj["annotations"].filter(
        (a) => a && typeof a === "object" && typeof (a as Annotation).id === "string",
      ) as Annotation[])
    : [];
  const theme = isPdfTheme(obj["theme"]) ? obj["theme"] : "auto";
  const data: PaperSidecar = { annotations, theme };
  const reading = normalizeReadingPosition(obj["reading"]);
  if (reading) { data.reading = reading; }
  const deleted = Array.isArray(obj["deleted"]) ? obj["deleted"].filter(isDeletionMarker).map(({ id, deletedAt }) => ({ id, deletedAt })) : [];
  if (deleted.length > 0) { data.deleted = deleted; }
  return data;
}

/**
 * The exact bytes both extensions write: fixed key order, two-space indent, `reading` and `deleted` omitted until set,
 * markers sorted by id so two devices holding the same markers write the same bytes.
 * @returns the JSON text of the sidecar.
 */
export function serializePaperSidecar(data: PaperSidecar): string {
  const payload: PaperSidecar = { annotations: data.annotations, theme: data.theme };
  if (data.reading) { payload.reading = data.reading; }
  if (data.deleted && data.deleted.length > 0) { payload.deleted = [...data.deleted].sort((a, b) => a.id.localeCompare(b.id)); }
  return JSON.stringify(payload, null, 2);
}

/**
 * The order the reader lists annotations in: by page, then by creation time.
 * @returns a negative number when `a` comes first, positive when `b` does, 0 when they tie.
 */
export function compareAnnotations(a: Annotation, b: Annotation): number {
  return a.pageNumber - b.pageNumber || a.createdAt.localeCompare(b.createdAt);
}

/** Loads, modifies and saves the per-paper sidecar, serializing the work per paper. */

/**
 * Throws when the page number is not a positive integer.
 */
function validatePageNumber(pageNumber: number): void {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`Invalid page number: ${pageNumber}. Must be a positive integer`);
  }
}

/**
 * @returns the color, typed; throws for anything outside ANNOTATION_COLORS.
 */
function validateAnnotationColor(color: string): AnnotationColor {
  if (!ANNOTATION_COLORS.includes(color as AnnotationColor)) {
    throw new Error(`Invalid annotation color: ${color}. Must be one of: ${ANNOTATION_COLORS.join(", ")}`);
  }
  return color as AnnotationColor;
}

/**
 * @returns a position whose x, y, width and height are normalized to the page (0..1); throws otherwise.
 */
export function checkAnnotationPosition(pos: unknown): AnnotationPosition {
  if (!pos || typeof pos !== "object" || Array.isArray(pos)) {
    throw new Error("Position must be an object with x, y, width, height");
  }
  const p = pos as Record<string, unknown>;
  const { x, y, width, height } = p;
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
    throw new Error("Position fields x, y, width, height must be numbers");
  }
  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x > 1 || y > 1 || x + width > 1 || y + height > 1) {
    throw new Error("Position values must be normalized (0.0-1.0) and width/height must be positive");
  }
  return { x, y, width, height };
}

export interface PaperSidecarStoreOptions {
  now?: () => string;
  newId?: () => string;
  /** Receives a warning when a sidecar cannot be parsed and loads as empty. */
  logger?: ILogger;
}

/**
 * Load-modify-save over one sidecar per paper. Every mutator of a paper runs in a per-paper queue: the reader saves the
 * reading position while scrolling, and without serialization a position write racing an annotation write drops one.
 */
export class PaperSidecarStore {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly now: () => string;
  private readonly newId: () => string;
  private readonly logger: ILogger | undefined;

  constructor(private readonly port: SidecarPort, options: PaperSidecarStoreOptions = {}) {
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
  async load(paperId: string): Promise<PaperSidecar> {
    const text = await this.port.read(paperId);
    if (text === null) { return createEmptyPaperSidecar(); }
    try {
      return normalizePaperSidecar(JSON.parse(text) as unknown);
    } catch (error) {
      void this.logger?.log("WARN", "sidecar", "Sidecar is not valid JSON; loading it as empty", { paperId, error: String(error) });
      return createEmptyPaperSidecar();
    }
  }

  private async mutate<T>(paperId: string, change: (data: PaperSidecar) => T | null): Promise<T | null> {
    return this.enqueue(paperId, async () => {
      const data = await this.load(paperId);
      const result = change(data);
      if (result !== null) {
        if (data.deleted) { data.deleted = removeStaleDeletionMarkers(data.deleted, this.now()); }
        await this.port.write(paperId, serializePaperSidecar(data));
      }
      return result;
    });
  }

  /**
   * @returns the paper's annotations, by page then creation time.
   */
  async getAnnotations(paperId: string): Promise<Annotation[]> {
    return [...(await this.load(paperId)).annotations].sort(compareAnnotations);
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
    const validPosition = position === undefined ? undefined : checkAnnotationPosition(position);
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
      data.deleted = [...(data.deleted ?? []).filter((m) => m.id !== id), { id, deletedAt: this.now() }];
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

/** The part of the store the reader host uses: reads, plus the writes a host without a library may refuse. */
export type ReaderSidecarStore = Pick<
  PaperSidecarStore,
  "load" | "getAnnotations" | "addHighlight" | "addNote" | "updateAnnotation" | "deleteAnnotation" | "setTheme" | "setReadingState"
>;

// Keeps a build preview's reading position and theme in memory for the life of its panel and refuses annotation writes.

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
  const store = new PaperSidecarStore(memoryPort());
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
