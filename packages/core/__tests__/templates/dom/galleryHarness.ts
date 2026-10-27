// Mounts the template gallery on a fake transport and an IntersectionObserver stub for jsdom tests.
import { mountTemplateGallery } from "../../../src/templates/dom/index";
import type { GalleryToHost, HostToGallery, TemplateAddress } from "../../../src/templates/host/index";
import type { TemplateEntry } from "../../../src/templates/templateCatalog";

export function entry(source: TemplateEntry["source"], id: string, extra: Partial<TemplateEntry> = {}): TemplateEntry {
  return {
    source, id, name: `Name ${id}`, description: `About ${id}`, category: "article", format: "latex", engine: "pdflatex",
    main: "main.tex", license: "MIT", authors: ["Ada"], ...extra,
  };
}

export const key = (source: TemplateEntry["source"], id: string): TemplateAddress => ({ source, id });

interface FakeObserver { targets: Set<Element>; callback: IntersectionObserverCallback; disconnected: boolean }

export function mountGallery() {
  const observers: FakeObserver[] = [];
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    private readonly rec: FakeObserver;
    constructor(callback: IntersectionObserverCallback) {
      this.rec = { targets: new Set(), callback, disconnected: false };
      observers.push(this.rec);
    }
    observe(el: Element) { this.rec.targets.add(el); }
    unobserve(el: Element) { this.rec.targets.delete(el); }
    disconnect() { this.rec.disconnected = true; this.rec.targets.clear(); }
    takeRecords() { return []; }
  };
  document.body.innerHTML = "";
  const root = document.createElement("div");
  document.body.append(root);
  const sent: GalleryToHost[] = [];
  const handlers = new Set<(m: HostToGallery) => void>();
  const transport = {
    post: (m: GalleryToHost) => { sent.push(m); },
    subscribe: (h: (m: HostToGallery) => void) => { handlers.add(h); return () => { handlers.delete(h); }; },
  };
  const gallery = mountTemplateGallery(root, transport);
  return {
    root, sent, gallery, handlers,
    deliver(m: HostToGallery) { for (const h of [...handlers]) h(m); },
    /** Reports every observed element as visible. */
    reveal() {
      for (const o of observers) {
        const hits = [...o.targets].map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry);
        if (hits.length > 0) o.callback(hits, {} as IntersectionObserver);
      }
    },
    ofType<T extends GalleryToHost["type"]>(type: T) { return sent.filter((m): m is Extract<GalleryToHost, { type: T }> => m.type === type); },
    cards: () => [...root.querySelectorAll<HTMLButtonElement>("button.ls-tpl-card")],
    cardNames: () => [...root.querySelectorAll("button.ls-tpl-card")].map((c) => c.getAttribute("aria-label")),
    card: (name: string) => root.querySelector<HTMLButtonElement>(`button.ls-tpl-card[aria-label="${name}"]`)!,
  };
}

export type Gallery = ReturnType<typeof mountGallery>;

/** Delivers a ready listing for each source: community c1 c2, universe u1, mine m1. */
export function listAll(g: Gallery, overrides: Partial<Record<TemplateEntry["source"], TemplateEntry[]>> = {}): void {
  const lists = {
    community: [entry("community", "c1"), entry("community", "c2", { category: "thesis" })],
    universe: [entry("universe", "u1", { format: "typst", engine: "typst", main: "main.typ", compiler: "0.13.1", version: "1.2.0" })],
    mine: [entry("mine", "m1", { category: "poster" })],
    ...overrides,
  };
  for (const source of ["community", "universe", "mine"] as const) {
    g.deliver({ type: "source", source, listing: { status: "ready", entries: lists[source], fromCache: false } });
  }
}
