// Builds the template sources of the open library: Community, Typst Universe and My templates.
import type { FetchLike, ILogger, LibraryFileSystem, PathOps, TemplateSource, TemplateSourceId } from "@labshelf/core";
import { createCommunitySource, createLibraryTemplateCache, createMineSource, TEMPLATE_SOURCES } from "@labshelf/core";
import { createUniverseSource } from "@labshelf/core/node";
import { TypstPackageStore, typstPackageDirs } from "@labshelf/core/typst/node";

import type { WritingHost } from "../../session/index.js";

type SourceSet = Record<TemplateSourceId, TemplateSource>;

/** The disk and path style the library is on. */
interface LibraryDisk {
  fs: LibraryFileSystem;
  paths: PathOps;
}

function buildSourceSet({ fs, paths }: LibraryDisk, libraryRoot: string, fetch: FetchLike, logger: ILogger): SourceSet {
  const dirs = typstPackageDirs();
  const cache = createLibraryTemplateCache({ fs, paths, libraryRoot });
  return {
    community: createCommunitySource({ fetch, cache, logger }),
    universe: createUniverseSource({
      fetch, cache, logger, packages: new TypstPackageStore(dirs), packageCacheDir: dirs.cache,
    }),
    mine: createMineSource({ fs, paths, libraryRoot, logger }),
  };
}

/**
 * One source per id that resolves the open library on every call, so the gallery keeps working when the library
 * folder changes; the sources of a library are built once.
 */
export function createTemplateSources(host: Pick<WritingHost, "current">, disk: LibraryDisk, fetch: FetchLike): TemplateSource[] {
  let built: { root: string; sources: SourceSet } | undefined;
  const current = (): SourceSet => {
    const session = host.current();
    if (!session) { throw new Error("Choose a library to browse templates."); }
    if (built?.root !== session.root) { built = { root: session.root, sources: buildSourceSet(disk, session.root, fetch, session.logger) }; }
    return built.sources;
  };
  return TEMPLATE_SOURCES.map((id): TemplateSource => ({
    id,
    list: (signal) => current()[id].list(signal),
    thumbnail: (entry, signal) => current()[id].thumbnail(entry, signal),
    files: (entry, signal) => current()[id].files(entry, signal),
  }));
}
