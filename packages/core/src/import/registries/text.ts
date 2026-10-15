/** Cleans strings and reads payload shapes for the registry mappers. */

export function firstNonEmpty(values: string[] | undefined): string | undefined {
  return values?.map((value) => value.trim()).find((value) => value.length > 0);
}

export function trimmed(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

/** Normalizes an API field that is one value when singular and a list when not. */
export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

export function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export function matchTag(content: string, tagName: string): string | undefined {
  return content.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, "i"))?.[1];
}

export function xmlText(value: string | undefined): string | undefined {
  return value?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() || undefined;
}
