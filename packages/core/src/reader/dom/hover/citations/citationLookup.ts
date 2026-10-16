// Asks a preview host which cited papers stand behind a place in the PDF, and matches each answer to its request.
import type { CitationEntry, CitationQuery } from "../../../index.js";
import { DOCUMENT_REPLACED, type ReaderContext } from "../../session/index.js";

/** The host always answers; this only bounds the wait when the host is gone or stuck. */
export const LOOKUP_TIMEOUT_MS = 1500;

export class CitationLookup {
  private nextRequest = 1;
  private readonly waiting = new Map<number, (entries: CitationEntry[] | null) => void>();
  private readonly answers = new Map<string, Promise<CitationEntry[]>>();

  constructor(private readonly ctx: ReaderContext) {
    ctx.eventBus.on(DOCUMENT_REPLACED, () => this.answers.clear());
  }

  /**
   * @param cacheKey names the place for the lifetime of the open document; omit it for places that are not links.
   * @returns the entries cited at the place; empty when the host names none or does not answer in time.
   */
  lookup(query: CitationQuery, cacheKey?: string): Promise<CitationEntry[]> {
    const cached = cacheKey === undefined ? undefined : this.answers.get(cacheKey);
    if (cached) { return cached; }
    const asked = this.ask(query).then((entries) => {
      // A timeout is not an answer: the same place may be asked again.
      if (entries === null && cacheKey !== undefined) { this.answers.delete(cacheKey); }
      return entries ?? [];
    });
    if (cacheKey !== undefined) { this.answers.set(cacheKey, asked); }
    return asked;
  }

  /** Delivers the host's `citation` answer to the request that asked for it. */
  receive(request: number, entries: CitationEntry[]): void {
    const settle = this.waiting.get(request);
    this.waiting.delete(request);
    settle?.(entries);
  }

  private ask(query: CitationQuery): Promise<CitationEntry[] | null> {
    const request = this.nextRequest++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.waiting.delete(request); resolve(null); }, LOOKUP_TIMEOUT_MS);
      this.waiting.set(request, (entries) => { clearTimeout(timer); resolve(entries); });
      this.ctx.host.post({ command: "lookupCitation", request, query });
    });
  }
}
