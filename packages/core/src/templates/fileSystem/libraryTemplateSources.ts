// Builds the gallery's Community, Typst Universe and My templates sources for one library folder.
import type { ILogger, FetchLike } from "../../ports/index.js";
import { createCommunitySource, createUniverseSource, type TemplateSource } from "../sources/index.js";
import type { TemplateSourceId } from "../templateEntry.js";
import { createLibraryTemplateCache, type LibraryTemplateCacheDeps } from "./libraryTemplateCache.js";
import { createMineSource } from "./mineSource.js";

export interface LibraryTemplateSourcesDeps extends LibraryTemplateCacheDeps {
  fetch: FetchLike;
  logger: ILogger;
}

export function createLibraryTemplateSources(deps: LibraryTemplateSourcesDeps): Record<TemplateSourceId, TemplateSource> {
  const { fetch, logger } = deps;
  const cache = createLibraryTemplateCache(deps);
  return {
    community: createCommunitySource({ fetch, cache, logger }),
    universe: createUniverseSource({ fetch, cache, logger }),
    mine: createMineSource(deps),
  };
}
