// Pins how the template gallery's host answers the page: listings per source, thumbnails, engine checks and "Use template".
import type { HostToGallery, TemplateEntry, TemplateFile, TemplateSource, TemplateSourceId } from "@labshelf/core";
import { createGalleryHost, type GalleryHostDeps } from "../../../src/writing/templates/galleryHost.js";
import { fakeLogger } from "../../support/writingFixtures.js";

const entry = (source: TemplateSourceId, id: string, engine: TemplateEntry["engine"] = "typst"): TemplateEntry => ({
  source, id, name: `Name ${id}`, description: "d", category: "article", format: engine === "typst" ? "typst" : "latex",
  engine, main: "main.typ", license: "MIT", authors: [],
});
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1]);
const FILES: TemplateFile[] = [{ path: "main.typ", bytes: Uint8Array.from([1]) }];

function fakeSource(id: TemplateSourceId, entries: TemplateEntry[]): jest.Mocked<TemplateSource> {
  return {
    id,
    list: jest.fn<ReturnType<TemplateSource["list"]>, Parameters<TemplateSource["list"]>>(async () => ({ entries, fromCache: id === "universe" })),
    thumbnail: jest.fn<ReturnType<TemplateSource["thumbnail"]>, Parameters<TemplateSource["thumbnail"]>>(async () => PNG),
    files: jest.fn<ReturnType<TemplateSource["files"]>, Parameters<TemplateSource["files"]>>(async () => FILES),
  };
}

function setup(over: Partial<GalleryHostDeps> = {}) {
  const posts: HostToGallery[] = [];
  const logger = fakeLogger();
  const community = fakeSource("community", [entry("community", "a")]);
  const universe = fakeSource("universe", [entry("universe", "u", "pdflatex")]);
  const deps: GalleryHostDeps = {
    sources: [community, universe],
    engines: jest.fn(async () => ({ engines: new Set(["typst" as const]), typstVersion: "0.13.0" })),
    askTitle: jest.fn(async () => "My thesis"),
    createProject: jest.fn(async () => {}),
    logger,
    post: (m) => { posts.push(m); },
    ...over,
  };
  return { host: createGalleryHost(deps), deps, posts, logger, community, universe };
}

const key = (source: TemplateSourceId, id: string) => ({ source, id });
const ofType = (posts: HostToGallery[], type: HostToGallery["type"]) => posts.filter((p) => p.type === type);

describe("createGalleryHost", () => {
  it("lists every source: loading, then ready with fromCache", async () => {
    const { host, posts } = setup();
    await host.handle({ type: "ready" });
    expect(posts).toEqual(expect.arrayContaining([
      { type: "source", source: "community", listing: { status: "loading" } },
      { type: "source", source: "community", listing: { status: "ready", entries: [entry("community", "a")], fromCache: false } },
      { type: "source", source: "universe", listing: { status: "ready", entries: [entry("universe", "u", "pdflatex")], fromCache: true } },
    ]));
    expect(host.isReady()).toBe(true);
  });

  it("reports a failing source as an error and logs it, while the others still list", async () => {
    const { host, posts, logger, community } = setup();
    community.list.mockRejectedValue(new Error("offline"));
    await host.handle({ type: "refresh" });
    const listings = ofType(posts, "source") as Extract<HostToGallery, { type: "source" }>[];
    expect(listings.find((p) => p.source === "community" && p.listing.status === "error")).toBeDefined();
    expect(listings.find((p) => p.source === "universe" && p.listing.status === "ready")).toBeDefined();
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ source: "community" }));
  });

  it("answers thumbnails with data URIs, and none for a miss, an unknown key or unknown bytes", async () => {
    const { host, posts, community, universe, logger } = setup();
    await host.handle({ type: "ready" });
    posts.length = 0;
    universe.thumbnail.mockResolvedValue(undefined);
    await host.handle({ type: "thumbnails", templates: [key("community", "a"), key("universe", "u"), key("mine", "zz")] });
    expect(community.thumbnail).toHaveBeenCalledTimes(1);
    expect(posts).toEqual(expect.arrayContaining([
      { type: "thumbnail", template: key("community", "a"), dataUri: `data:image/png;base64,${Buffer.from(PNG).toString("base64")}` },
      { type: "thumbnail", template: key("universe", "u") },
    ]));
    expect(posts).not.toContainEqual(expect.objectContaining({ template: key("mine", "zz") }));
    expect(logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.objectContaining({ id: "zz" }));

    community.thumbnail.mockResolvedValue(Uint8Array.from([1, 2, 3]));
    posts.length = 0;
    await host.handle({ type: "thumbnails", templates: [key("community", "a")] });
    expect(posts).toEqual([{ type: "thumbnail", template: key("community", "a") }]);
  });

  it("answers detail with the engine problem of this machine", async () => {
    const { host, posts } = setup();
    await host.handle({ type: "ready" });
    posts.length = 0;
    await host.handle({ type: "detail", template: key("universe", "u") });
    await host.handle({ type: "detail", template: key("community", "a") });
    expect(posts).toEqual([
      { type: "engine", template: key("universe", "u"), problem: "Needs pdflatex, which is not available on this machine" },
      { type: "engine", template: key("community", "a") },
    ]);
  });

  it("uses a template: asks the title, reads the files, creates the project, settles", async () => {
    const { host, posts, deps, community } = setup();
    await host.handle({ type: "ready" });
    posts.length = 0;
    await host.handle({ type: "use", template: key("community", "a") });
    expect(deps.askTitle).toHaveBeenCalledWith("Name a");
    expect(community.files).toHaveBeenCalledWith(entry("community", "a"), expect.anything());
    expect(deps.createProject).toHaveBeenCalledWith("My thesis", entry("community", "a"), FILES);
    expect(posts).toEqual([{ type: "use.settled", template: key("community", "a") }]);
  });

  it("only settles when the title is cancelled", async () => {
    const { host, posts, deps } = setup({ askTitle: jest.fn(async () => undefined) });
    await host.handle({ type: "ready" });
    posts.length = 0;
    await host.handle({ type: "use", template: key("community", "a") });
    expect(deps.createProject).not.toHaveBeenCalled();
    expect(posts).toEqual([{ type: "use.settled", template: key("community", "a") }]);
  });

  it("reports a failed project creation as a notice, logs it and settles", async () => {
    const { host, posts, logger } = setup({ createProject: jest.fn(async () => { throw new Error("disk full"); }) });
    await host.handle({ type: "ready" });
    posts.length = 0;
    await host.handle({ type: "use", template: key("community", "a") });
    expect(posts).toEqual([
      { type: "notice", kind: "error", text: expect.stringContaining("disk full") },
      { type: "use.settled", template: key("community", "a") },
    ]);
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.any(Error), expect.objectContaining({ source: "community", id: "a" }));
  });

  it("logs and ignores a malformed message", async () => {
    const { host, posts, logger } = setup();
    await host.handle({ type: "use", template: { source: "nope", id: "a" } });
    await host.handle("ready");
    expect(posts).toEqual([]);
    expect(logger.log).toHaveBeenCalledWith("WARN", expect.any(String), expect.any(String), expect.anything());
    expect(host.isReady()).toBe(false);
  });
});
