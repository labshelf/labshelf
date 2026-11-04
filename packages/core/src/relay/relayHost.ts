// Writes and reads the short text that names a relay Worker inside share links and invites.
// CONTRACT: documents/contracts/share-link.md#relay-host
const WORKER_HOST = /^ls-([a-z2-7]{12})\.([a-z0-9-]+)\.workers\.dev$/;
const SHORT_HOST = /^([a-z2-7]{12})\.([a-z0-9-]+)$/;

/** `<12 chars>.<subdomain>` for a LabShelf Worker, else the whole host; throws TypeError for a URL that has no unambiguous host form. */
export function formatRelayHost(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new TypeError(`Not a relay URL: ${url}`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new TypeError(`Not a plain https relay URL: ${url}`);
  }
  const worker = parsed.port === "" ? WORKER_HOST.exec(parsed.hostname) : null;
  if (worker) { return `${worker[1]}.${worker[2]}`; }
  if (SHORT_HOST.test(parsed.host)) { throw new TypeError(`The relay host of ${url} reads as a short Worker name`); }
  return parsed.host;
}

/** The relay URL (`https://<host>`, no trailing slash) a host text names; undefined when the text is not a host. */
export function parseRelayHost(text: string): string | undefined {
  const short = SHORT_HOST.exec(text);
  if (short) { return `https://ls-${short[1]}.${short[2]}.workers.dev`; }
  if (text.includes("~")) { return undefined; }
  try {
    return new URL(`https://${text}`).host === text ? `https://${text}` : undefined;
  } catch {
    return undefined;
  }
}
