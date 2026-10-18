// Hides secrets in log text: registered values, bearer tokens, key parameters and URL fragments.

const REDACTED = "[redacted]";
const BEARER = /\bBearer\s+[^\s"',;]+/gi;
const SECRET_PARAM = /([?&](?:key|token)=)[^&\s#"']*/gi;
// Fragments carry share keys in invite links, so everything after the # goes.
const URL_FRAGMENT = /([a-z][a-z0-9+.-]*:\/\/[^\s#"']*)#\S*/gi;

export function redactText(text: string, secrets: Iterable<string>): string {
  let out = text;
  for (const secret of secrets) out = out.split(secret).join(REDACTED);
  return out.replace(BEARER, `Bearer ${REDACTED}`).replace(SECRET_PARAM, `$1${REDACTED}`).replace(URL_FRAGMENT, `$1#${REDACTED}`);
}

/** Redacts every string in a JSON-like value; other values pass through. */
export function redactValue<T>(value: T, secrets: Iterable<string>): T {
  const list = [...secrets];
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return redactText(node, list);
    if (Array.isArray(node)) return node.map(walk);
    if (node !== null && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
    return node;
  };
  return walk(value) as T;
}
