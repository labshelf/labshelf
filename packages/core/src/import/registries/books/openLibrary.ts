/** Looks up OpenLibrary books by ISBN. */
import { extractYear } from "../../metadata/index.js";
import { fetchJson } from "../http.js";
import type { RegistryRecord } from "../types.js";

interface OpenLibraryBook {
  title?: string;
  subtitle?: string;
  authors?: Array<{ name: string }>;
  publishers?: Array<{ name: string }>;
  publish_date?: string;
  number_of_pages?: number;
  url?: string;
}

/**
 * Looks up a book by ISBN through OpenLibrary.
 * @returns Book metadata, or undefined.
 */
export async function openLibraryByIsbn(isbn: string): Promise<RegistryRecord | undefined> {
  const key = `ISBN:${isbn}`;
  const payload = await fetchJson<Record<string, OpenLibraryBook>>(
    `https://openlibrary.org/api/books?format=json&jscmd=data&bibkeys=${encodeURIComponent(key)}`,
  );
  const book = payload?.[key];
  if (!book?.title) {
    return undefined;
  }

  return {
    title: book.subtitle ? `${book.title}: ${book.subtitle}` : book.title,
    authors: (book.authors ?? []).map((author) => author.name).filter(Boolean),
    year: extractYear(book.publish_date),
    publisher: book.publishers?.[0]?.name,
    pages: book.number_of_pages ? String(book.number_of_pages) : undefined,
    url: book.url,
  };
}
