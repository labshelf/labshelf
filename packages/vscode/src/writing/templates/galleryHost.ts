// Answers the template gallery page: lists each source on its own, serves thumbnails and engine checks, and runs "Use template".
import {
  engineProblem, parseGalleryMessage, SOURCE_LABELS,
  type AvailableEngines, type GalleryToHost, type TemplateEntry, type TemplateKey, type TemplateSource, type TemplateSourceId,
} from "@labshelf/core";
import { thumbnailDataUri } from "./thumbnailUri.js";
import { TEMPLATES_LOG_MODULE, useTemplate, type UseTemplatePorts } from "./useTemplate.js";

export interface GalleryHostDeps extends UseTemplatePorts {
  sources: readonly TemplateSource[];
  engines: () => Promise<AvailableEngines>;
}

const cacheKey = (key: TemplateKey): string => `${key.source}:${key.id}`;

export class GalleryHost {
  /** Entries of the last listing of each source, to resolve the keys the page sends. */
  private readonly entries = new Map<string, TemplateEntry>();
  private readonly listings = new Map<TemplateSourceId, AbortController>();
  private readonly lifetime = new AbortController();
  private engines: Promise<AvailableEngines> | undefined;
  private ready = false;

  constructor(private readonly deps: GalleryHostDeps) {}

  isReady(): boolean { return this.ready; }

  /** Handles one untrusted message from the page; resolves when its work is done. */
  async handle(raw: unknown): Promise<void> {
    const message = parseGalleryMessage(raw);
    if (!message) {
      await this.deps.logger.log("WARN", TEMPLATES_LOG_MODULE, "Ignored a malformed gallery message", { type: (raw as { type?: unknown } | null)?.type });
      return;
    }
    await this.dispatch(message);
  }

  /** Aborts every call still running. */
  dispose(): void {
    this.lifetime.abort();
    for (const controller of this.listings.values()) { controller.abort(); }
  }

  private async dispatch(message: GalleryToHost): Promise<void> {
    switch (message.type) {
      case "ready": this.ready = true; return this.listAll();
      case "refresh": return this.listAll();
      case "thumbnails": await Promise.all(message.templates.map((key) => this.sendThumbnail(key))); return;
      case "detail": return this.sendEngine(message.template);
      case "use": return this.use(message.template);
    }
  }

  private async listAll(): Promise<void> {
    await Promise.all(this.deps.sources.map((source) => this.listSource(source)));
  }

  private async listSource(source: TemplateSource): Promise<void> {
    this.listings.get(source.id)?.abort();
    const controller = new AbortController();
    this.listings.set(source.id, controller);
    const { post, logger } = this.deps;
    post({ type: "source", source: source.id, listing: { status: "loading" } });
    try {
      const { entries, fromCache } = await source.list(controller.signal);
      if (controller.signal.aborted) { return; }
      for (const key of [...this.entries.keys()]) { if (key.startsWith(`${source.id}:`)) { this.entries.delete(key); } }
      for (const entry of entries) { this.entries.set(cacheKey(entry), entry); }
      post({ type: "source", source: source.id, listing: { status: "ready", entries, fromCache } });
    } catch (error) {
      if (controller.signal.aborted) { return; }
      await logger.error(TEMPLATES_LOG_MODULE, error, { source: source.id, action: "list" });
      post({ type: "source", source: source.id, listing: { status: "error", message: `Could not list ${SOURCE_LABELS[source.id]}.` } });
    }
  }

  private async sendThumbnail(key: TemplateKey): Promise<void> {
    const found = this.resolve(key, "thumbnail");
    if (!found) { return; }
    let dataUri: string | undefined;
    try {
      const bytes = await found.source.thumbnail(found.entry, this.lifetime.signal);
      dataUri = bytes && thumbnailDataUri(bytes);
    } catch (error) {
      await this.deps.logger.error(TEMPLATES_LOG_MODULE, error, { ...key, action: "thumbnail" });
    }
    if (!this.lifetime.signal.aborted) { this.deps.post({ type: "thumbnail", template: key, ...(dataUri ? { dataUri } : {}) }); }
  }

  private async sendEngine(key: TemplateKey): Promise<void> {
    const found = this.resolve(key, "detail");
    if (!found) { return; }
    let problem: string | undefined;
    try {
      problem = engineProblem(found.entry, await this.probeEngines());
    } catch (error) {
      await this.deps.logger.error(TEMPLATES_LOG_MODULE, error, { ...key, action: "engines" });
    }
    this.deps.post({ type: "engine", template: key, ...(problem ? { problem } : {}) });
  }

  // Engines are probed once per panel; a failed probe is tried again on the next detail.
  private probeEngines(): Promise<AvailableEngines> {
    this.engines ??= this.deps.engines().catch((error: unknown) => { this.engines = undefined; throw error; });
    return this.engines;
  }

  private async use(key: TemplateKey): Promise<void> {
    const found = this.resolve(key, "use");
    if (!found) { this.deps.post({ type: "use.settled", template: key }); return; }
    await useTemplate(this.deps, found.source, found.entry, this.lifetime.signal);
  }

  private resolve(key: TemplateKey, action: string): { entry: TemplateEntry; source: TemplateSource } | undefined {
    const entry = this.entries.get(cacheKey(key));
    const source = this.deps.sources.find((s) => s.id === key.source);
    if (entry && source) { return { entry, source }; }
    void this.deps.logger.log("WARN", TEMPLATES_LOG_MODULE, "Gallery asked for a template that is not listed", { ...key, action });
    return undefined;
  }
}

export function createGalleryHost(deps: GalleryHostDeps): GalleryHost {
  return new GalleryHost(deps);
}
