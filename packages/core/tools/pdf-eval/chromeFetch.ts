// Builds a fetch that sends a desktop Chrome User-Agent and stops when its paper's time is up.
const CHROME_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export const BROWSER_HEADERS = { "User-Agent": CHROME_USER_AGENT };

export function chromeFetch(paperSignal: AbortSignal): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", CHROME_USER_AGENT);
    const signal = init?.signal ? AbortSignal.any([init.signal, paperSignal]) : paperSignal;
    return fetch(input, { ...init, headers, signal });
  };
}
