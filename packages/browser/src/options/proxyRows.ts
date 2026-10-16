// Judges proxy rows typed on the options page and keeps the ones that can be saved.
import { proxyKind, type LibraryProxy, type ProxyKind } from "@labshelf/core";

export const PROXY_KIND_LABELS: Record<ProxyKind, string> = { prefix: "Prefix", hostname: "Hostname", openathens: "OpenAthens" };

export const PROXY_TEMPLATE_ERROR = "Not a proxy address — paste a URL with $@, a hostname like .ezproxy.uni.edu, or an OpenAthens redirector link.";

/** What to show beside a template field: its kind, an error, or nothing while the field is empty. */
export type TemplateVerdict = { kind: ProxyKind; label: string } | { error: string } | undefined;

export function judgeTemplate(template: string): TemplateVerdict {
  if (!template.trim()) return undefined;
  const kind = proxyKind(template);
  return kind ? { kind, label: PROXY_KIND_LABELS[kind] } : { error: PROXY_TEMPLATE_ERROR };
}

/** The rows with a valid template, trimmed and in order; a blank name falls back to the template so every proxy is nameable in logs. */
export function savableProxies(rows: readonly LibraryProxy[]): LibraryProxy[] {
  return rows.flatMap((row) => {
    const template = row.template.trim();
    return proxyKind(template) ? [{ name: row.name.trim() || template, template, enabled: row.enabled }] : [];
  });
}
