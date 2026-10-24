/** Counts the past year's downloads of each catalog template's main file from the jsDelivr stats API, summed across versions. */
import type { FetchLike } from "./sources/index.js";

const STATS_URL = "https://data.jsdelivr.com/v1/stats/packages/gh/labshelf/labshelf-templates";
const MAX_PAGE = 100;

interface HitRow {
  hits: { total: number };
}

/** Reads every page of a jsDelivr stats list; throws with the URL and status on a non-OK response. */
async function fetchAllPages<T>(base: string, fetch: FetchLike, signal?: AbortSignal): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 1; page <= MAX_PAGE; page++) {
    const url = `${base}?period=year&limit=100&page=${page}`;
    const response = await fetch(url, signal === undefined ? undefined : { signal });
    if (!response.ok) throw new Error(`jsDelivr request failed: ${url} ${response.status}`);
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error(`jsDelivr request returned a non-list body: ${url}`);
    rows.push(...(body as T[]));
    const totalPages = Number(response.headers.get("x-total-pages"));
    if (!Number.isInteger(totalPages)) throw new Error(`jsDelivr response has no x-total-pages header: ${url}`);
    if (page >= totalPages) return rows;
  }
  throw new Error(`jsDelivr list exceeds ${MAX_PAGE} pages: ${base}`);
}

/** Download counts keyed by template id, sorted by id; a template without hits maps to 0. */
export async function countDownloads(
  templates: readonly { id: string; main: string }[],
  fetch: FetchLike,
  signal?: AbortSignal,
): Promise<Record<string, number>> {
  const idByPath = new Map(templates.map((t) => [`/templates/${t.id}/files/${t.main}`, t.id]));
  const counts = new Map(templates.map((t) => [t.id, 0]));
  const versions = await fetchAllPages<HitRow & { version: string }>(`${STATS_URL}/versions`, fetch, signal);
  for (const { version, hits } of versions) {
    // Versions without hits have no file rows to read.
    if (hits.total === 0) continue;
    const files = await fetchAllPages<HitRow & { name: string }>(`${STATS_URL}@${version}/files`, fetch, signal);
    for (const { name, hits: fileHits } of files) {
      const id = idByPath.get(name);
      if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + fileHits.total);
    }
  }
  return Object.fromEntries([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
