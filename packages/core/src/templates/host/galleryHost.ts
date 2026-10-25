// Answers the template gallery page: lists each source on its own, serves thumbnails and engine checks, and runs "Use template".
import { deriveEngineProblem, type AvailableEngines } from "../deriveEngineProblem.js";
import { parseGalleryMessage, type GalleryToHost, type TemplateAddress } from "../protocol/index.js";
import type { TemplateSource } from "../sources/index.js";
import type { TemplateEntry, TemplateSourceId } from "../templateEntry.js";
import { SOURCE_LABELS } from "../templateLabels.js";
import { createThumbnailUri } from "./thumbnailUri.js";
import { TEMPLATES_LOG_MODULE, createTemplateProject, type UseTemplatePorts } from "./createTemplateProject.js";

/** What the gallery needs from the Publish screen; the host forwards validated `publish.*` messages to it. */
export interface PublishHost {
  /** Posts `publish.open` for the project, or for the one the user picks when no id is given. */
  open(projectId?: string): Promise<void>;
  /** Handles one validated `publish.*` message; failures are reported to the page, never thrown. */
  handle(message: Extract<GalleryToHost, { type: `publish.${string}` }>): Promise<void>;
}

export interface GalleryHostDeps extends UseTemplatePorts {
  sources: readonly TemplateSource[];
  engines: () => Promise<AvailableEngines>;
  publish: PublishHost;
}

const cacheKey = (key: TemplateAddress): string => `${key.source}:${key.id}`;

export class GalleryHost {
  /** Entries of the last listing of each source, to resolve the keys the page sends. */
  private readonly entries = new Map<string, TemplateEntry>();
  private readonly listings = new Map<TemplateSourceId, AbortController>();
  private readonly lifetime = new AbortController();
  private engines: Promise<AvailableEngines> | undefined;
  private ready = false;
  private markReady: () => void = () => {};
  private readonly pageReady = new Promise<void>((resolve) => { this.markReady = resolve; });

  constructor(private readonly deps: GalleryHostDeps) {}

  isReady(): boolean { return this.ready; }

  /** Handles one untrusted message from the page; resolves when its work is done. */
  async handle(raw: unknown): Promise<void> {
    const message = parseGalleryMessage(raw);
    if (!message) {
      const type = (raw as { type?: unknown } | null)?.type;
      await this.deps.logger.log("WARN", TEMPLATES_LOG_MODULE, "Ignored a malformed gallery message", { type });
      // The page waits on a reply to publish.*, so a rejected one must not leave it stuck.
      if (typeof type === "string" && type.startsWith("publish.")) {
        this.deps.post({ type: "publish.failed", error: "LabShelf could not read that request. Try again." });
      }
      return;
    }
    await this.dispatch(message);
  }

  /** Opens the Publish screen once the page has said `ready`, for the project or the one the user picks. */
  async openPublish(projectId?: string): Promise<void> {
    await this.pageReady;
    await this.deps.publish.open(projectId);
  }

  /** Aborts every call still running. */
  dispose(): void {
    this.lifetime.abort();
    for (const controller of this.listings.values()) { controller.abort(); }
  }

  private async dispatch(message: GalleryToHost): Promise<void> {
    switch (message.type) {
      case "ready": this.ready = true; this.markReady(); return this.listAll();
      case "refresh": return this.listAll();
      case "thumbnails": await Promise.all(message.templates.map((key) => this.sendThumbnail(key))); return;
      case "detail": return this.sendEngine(message.template);
      case "use": return this.use(message.template);
      case "publish.start": case "publish.check": case "publish.signIn": case "publish.submit": return this.deps.publish.handle(message);
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

  private async sendThumbnail(key: TemplateAddress): Promise<void> {
    const found = this.resolve(key, "thumbnail");
    if (!found) { return; }
    let dataUri: string | undefined;
    try {
      const bytes = await found.source.thumbnail(found.entry, this.lifetime.signal);
      dataUri = bytes && createThumbnailUri(bytes);
    } catch (error) {
      await this.deps.logger.error(TEMPLATES_LOG_MODULE, error, { ...key, action: "thumbnail" });
    }
    if (!this.lifetime.signal.aborted) { this.deps.post({ type: "thumbnail", template: key, ...(dataUri ? { dataUri } : {}) }); }
  }

  private async sendEngine(key: TemplateAddress): Promise<void> {
    const found = this.resolve(key, "detail");
    if (!found) { return; }
    let problem: string | undefined;
    try {
      problem = deriveEngineProblem(found.entry, await this.probeEngines());
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

  private async use(key: TemplateAddress): Promise<void> {
    const found = this.resolve(key, "use");
    if (!found) { this.deps.post({ type: "use.settled", template: key }); return; }
    await createTemplateProject(this.deps, found.source, found.entry, this.lifetime.signal);
  }

  private resolve(key: TemplateAddress, action: string): { entry: TemplateEntry; source: TemplateSource } | undefined {
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
