/** Verifies where the shared cache directory resolves. */
import * as path from "node:path";

import { resolveCacheDir } from "../../../src/library/node/index";

describe("cacheDir", () => {
  it("puts caches in $XDG_CACHE_HOME/labshelf when set", () => {
    expect(resolveCacheDir({ XDG_CACHE_HOME: "/xdg/cache" })).toBe(path.join("/xdg/cache", "labshelf"));
  });
});
