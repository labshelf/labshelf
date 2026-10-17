// Holds what the template gallery knows (listings, filter, sort, thumbnails, busy and open templates) and derives the entries to show.
import type { ProjectFormat } from "../../project/index.js";
import { filterTemplates, type TemplateFilter } from "../filterTemplates.js";
import { sortTemplates, type TemplateSort } from "../sortTemplates.js";
import { TEMPLATE_SOURCES, type TemplateEntry, type TemplateSourceId } from "../templateEntry.js";
import type { SourceListing, TemplateKey } from "../protocol/index.js";

export const keyOf = (template: TemplateKey): string => `${template.source}/${template.id}`;

export class GalleryState {
  readonly listings: Record<TemplateSourceId, SourceListing> = { community: { status: "loading" }, universe: { status: "loading" }, mine: { status: "loading" } };
  filter: TemplateFilter = {};
  sort: TemplateSort = "most-used";
  /** The entry whose detail page is open. */
  open: TemplateEntry | null = null;
  /** What the host said this machine lacks to build the open template. */
  openProblem: string | undefined;
  readonly thumbnails = new Map<string, string>();
  readonly busy = new Set<string>();
  private readonly requested = new Set<string>();

  setListing(source: TemplateSourceId, listing: SourceListing): void {
    this.listings[source] = listing;
    for (const requestedKey of [...this.requested]) if (requestedKey.startsWith(`${source}/`)) this.requested.delete(requestedKey);
  }

  loadAgain(): void {
    for (const source of TEMPLATE_SOURCES) this.setListing(source, { status: "loading" });
  }

  setFormats(checked: readonly ProjectFormat[]): void {
    this.filter = { ...this.filter, formats: checked.length === 2 ? [] : checked };
  }

  /** Every listed entry in source order, whatever the filter. */
  private listed(): TemplateEntry[] {
    return TEMPLATE_SOURCES.flatMap((source) => { const l = this.listings[source]; return l.status === "ready" ? l.entries : []; });
  }

  visible(): TemplateEntry[] {
    return sortTemplates(filterTemplates(this.listed(), this.filter), this.sort);
  }

  count(source: TemplateSourceId): number {
    const listing = this.listings[source];
    return listing.status === "ready" ? listing.entries.length : 0;
  }

  statuses(): SourceListing["status"][] {
    return TEMPLATE_SOURCES.map((source) => this.listings[source].status);
  }

  /** Marks the templates not yet requested as requested and returns them. */
  takeUnrequested(templates: readonly TemplateKey[]): TemplateKey[] {
    const fresh = templates.filter((t) => !this.requested.has(keyOf(t)));
    for (const t of fresh) this.requested.add(keyOf(t));
    return fresh;
  }

  setThumbnail(template: TemplateKey, dataUri: string | undefined): void {
    if (dataUri === undefined) this.thumbnails.delete(keyOf(template));
    else this.thumbnails.set(keyOf(template), dataUri);
  }

  isOpen(template: TemplateKey): boolean {
    return this.open !== null && keyOf(this.open) === keyOf(template);
  }
}
