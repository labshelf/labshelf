/** HTTP transport shared by the registry clients: bounded wait, JSON parsing, and undefined on any failure. */

const USER_AGENT = "LabShelf/0.1 (research paper manager; mailto:contact@labshelf.dev)";
const REQUEST_TIMEOUT_MS = 12_000;

export async function fetchJson<T>(url: string): Promise<T | undefined> {
  const body = await fetchText(url);
  if (!body) {
    return undefined;
  }
  try {
    return JSON.parse(body) as T;
  } catch {
    return undefined;
  }
}

export async function fetchText(url: string): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    return response.ok ? await response.text() : undefined;
  } catch {
    // Offline, rate-limited or timed out — the caller falls through to the
    // next source rather than failing the import.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
