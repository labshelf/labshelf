// Builds the Library proxies section: an ordered list of proxies, each with a name, an address, an enabled switch and a remove button.
import { inlineCode } from "@labshelf/core/dom";
import { createEditableListSection, type EditableListSection } from "./editableListSection";
import { deriveProxyKind, type LibraryProxy, type ProxyKind } from "@labshelf/core";

const PROXY_KIND_LABELS: Record<ProxyKind, string> = { prefix: "Prefix", hostname: "Hostname", openathens: "OpenAthens" };

export const PROXY_TEMPLATE_ERROR = "Not a proxy address — paste a URL with $@, a hostname like .ezproxy.uni.edu, or an OpenAthens redirector link.";

/** What to show beside a template field: its kind, an error, or nothing while the field is empty. */
type TemplateVerdict = { kind: ProxyKind; label: string } | { error: string } | undefined;

export function judgeTemplate(template: string): TemplateVerdict {
  if (!template.trim()) return undefined;
  const kind = deriveProxyKind(template);
  return kind ? { kind, label: PROXY_KIND_LABELS[kind] } : { error: PROXY_TEMPLATE_ERROR };
}

/** The rows with a valid template, trimmed and in order; a blank name falls back to the template so every proxy is nameable in logs. */
export function savableProxies(rows: readonly LibraryProxy[]): LibraryProxy[] {
  return rows.flatMap((row) => {
    const template = row.template.trim();
    return deriveProxyKind(template) ? [{ name: row.name.trim() || template, template, enabled: row.enabled }] : [];
  });
}

const DESCRIPTION = [
  "When a publisher asks for a sign-in, LabShelf retries through each enabled proxy, top to bottom. Three address shapes work: ",
  "a prefix such as ", inlineCode("https://login.ezproxy.uni.edu/login?url=$@"),
  ", a hostname such as ", inlineCode(".ezproxy.uni.edu"),
  " and an OpenAthens redirector such as ", inlineCode("https://go.openathens.net/redirector/uni.edu"), ".",
];

export function createProxySection(onChange: () => void): EditableListSection {
  return createEditableListSection({
    title: "Library proxies",
    description: DESCRIPTION,
    idPrefix: "proxy",
    rowLabel: "Proxy",
    addLabel: "Add proxy",
    namePlaceholder: "Library name",
    nameAriaLabel: "Proxy name",
    addressPlaceholder: "https://login.ezproxy.uni.edu/login?url=$@",
    addressAriaLabel: "Proxy address",
    judge(template) {
      const verdict = judgeTemplate(template);
      if (!verdict) return undefined;
      return "error" in verdict ? { text: verdict.error, isError: true } : { text: verdict.label, isError: false };
    },
    savable: savableProxies,
  }, onChange);
}
