// Builds the template sources of the open library: Community, Typst Universe and My templates.
import type { FetchLike, LibraryFileSystem, PathOps, TemplateSource, TemplateSourceId } from "@labshelf/core";
import { createLibraryTemplateSources, TEMPLATE_SOURCES } from "@labshelf/core";

import type { WritingHost } from "../../session/index.js";

/** The disk and path style the library is on. */
interface LibraryDisk {
  fs: LibraryFileSystem;
  paths: PathOps;
}

/**
 * One source per id that resolves the open library on every call, so the gallery keeps working when the library
 * folder changes; the sources of a library are built once.
 */
export function createTemplateSources(host: Pick<WritingHost, "current">, disk: LibraryDisk, fetch: FetchLike): TemplateSource[] {
  let built: { root: string; sources: Record<TemplateSourceId, TemplateSource> } | undefined;
  const current = (): Record<TemplateSourceId, TemplateSource> => {
    const session = host.current();
    if (!session) { throw new Error("Choose a library to browse templates."); }
    if (built?.root !== session.root) {
      built = { root: session.root, sources: createLibraryTemplateSources({ ...disk, libraryRoot: session.root, fetch, logger: session.logger }) };
    }
    return built.sources;
  };
  return TEMPLATE_SOURCES.map((id): TemplateSource => ({
    id,
    list: (signal) => current()[id].list(signal),
    thumbnail: (entry, signal) => current()[id].thumbnail(entry, signal),
    files: (entry, signal) => current()[id].files(entry, signal),
  }));
}
