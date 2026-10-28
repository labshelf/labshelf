// Builds the build-roots message a preview reader shows: the roots, the project's check limits, the last check's findings and the build options.
import type { BuildOptions, PreviewBuildRoot, PreviewBuildRoots } from "../reader/index.js";
import type { PreviewLimits } from "./checkLimits.js";

export interface BuildRootsMessageInput {
  main: string;
  focused: string;
  shown: string;
  roots: PreviewBuildRoot[];
  limits: PreviewLimits;
  /** Findings of the last pre-submission check. */
  checks?: number | undefined;
  /** Carried as given; a caller that keeps mutating its options passes a copy. */
  options?: BuildOptions | undefined;
}

/** INVARIANT: the key order is fixed, so every app posts the same message bytes. */
export function createBuildRootsMessage({ main, focused, shown, roots, limits, checks, options }: BuildRootsMessageInput): PreviewBuildRoots {
  const { pages, words, countUpTo } = limits;
  return {
    main, focused, shown, roots,
    ...(pages !== undefined ? { pageLimit: pages } : {}),
    ...(words !== undefined ? { wordLimit: words } : {}),
    ...(countUpTo !== undefined ? { countUpTo } : {}),
    ...(checks !== undefined ? { checks } : {}),
    ...(options !== undefined ? { options } : {}),
  };
}
