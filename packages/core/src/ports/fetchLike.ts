/** Declares the slice of `fetch` that network code needs, so apps and tests can inject their own. */
export type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<Response>;
