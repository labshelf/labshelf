/** Looks up Google Books volumes by ISBN. */
import { asString, extractYear } from "../../metadata/index.js";
import { fetchJson, type RegistryEnv } from "../http.js";
import { xmlText } from "../text.js";
import type { RegistryRecord } from "../types.js";

interface GoogleBooksVolumeInfo {
  title?: string;
  subtitle?: string;
  authors?: string[];
  publishedDate?: string;
  publisher?: string;
  pageCount?: number;
  description?: string;
  language?: string;
  infoLink?: string;
}

/**
 * Looks up a book by ISBN through Google Books, which carries descriptions and
 * page counts for many editions OpenLibrary has only a stub for.
 * @returns Book metadata, or undefined.
 */
export async function googleBooksByIsbn(env: RegistryEnv, isbn: string): Promise<RegistryRecord | undefined> {
  const payload = await fetchJson<{ items?: Array<{ volumeInfo?: GoogleBooksVolumeInfo }> }>(
    env,
    `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(`isbn:${isbn}`)}`,
  );
  const volume = payload?.items?.[0]?.volumeInfo;
  if (!volume?.title) {
    return undefined;
  }

  return {
    title: volume.subtitle ? `${volume.title}: ${volume.subtitle}` : volume.title,
    authors: (volume.authors ?? []).filter((name): name is string => Boolean(name)),
    year: extractYear(volume.publishedDate),
    publisher: asString(volume.publisher),
    pages: volume.pageCount ? String(volume.pageCount) : undefined,
    url: asString(volume.infoLink),
    language: asString(volume.language),
    summary: volume.description ? xmlText(volume.description) : undefined,
  };
}
