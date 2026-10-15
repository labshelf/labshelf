/** Looks up DataCite records by DOI, for datasets, theses and preprints. */
import { fetchJson, type RegistryEnv } from "../http.js";
import type { RegistryRecord } from "../types.js";

interface DataCiteAttributes {
  doi?: string;
  titles?: Array<{ title?: string }>;
  creators?: Array<{ name?: string; givenName?: string; familyName?: string }>;
  publisher?: string;
  publicationYear?: number;
  url?: string;
  descriptions?: Array<{ description?: string }>;
}

/**
 * Looks up a DOI in DataCite, which registers datasets, theses and preprints
 * that CrossRef does not carry.
 * @returns The record's metadata, or undefined.
 */
export async function dataCiteByDoi(env: RegistryEnv, doi: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ data?: { attributes?: DataCiteAttributes } }>(
    env,
    `https://api.datacite.org/dois/${encodeURIComponent(doi)}`,
  );
  const attributes = payload?.data?.attributes;
  if (!attributes?.titles?.[0]?.title) {
    return undefined;
  }

  return {
    title: attributes.titles[0].title,
    authors: (attributes.creators ?? [])
      .map((creator) => creator.name ?? [creator.givenName, creator.familyName].filter(Boolean).join(" "))
      .filter((name): name is string => Boolean(name)),
    year: attributes.publicationYear,
    publisher: attributes.publisher,
    doi: attributes.doi,
    url: attributes.url,
    summary: attributes.descriptions?.[0]?.description,
  };
}
