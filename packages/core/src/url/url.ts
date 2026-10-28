/** Reads a URL string without throwing: the parsed URL, its host name and its origin. */

/** The parsed URL, or undefined when `value` is not an absolute URL. */
export function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** The lower-case host name of `value` (no port, `www.` kept), or "" when `value` is not a URL. */
export function hostOf(value: string): string {
  return parseUrl(value)?.hostname ?? "";
}

/** The origin (scheme, host and port) of `value`, or undefined when it is empty or not a URL. */
export function originOf(value: string | undefined): string | undefined {
  return value ? parseUrl(value)?.origin : undefined;
}
