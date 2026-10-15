// Judges custom resolver rows typed on the options page and keeps the ones that can be saved.
import { isCustomResolverTemplate, type CustomResolver } from "@labshelf/core";

export const RESOLVER_TEMPLATE_ERROR = "Not usable — paste an http(s) address that contains {doi}.";

/** The message to show beside a template field, or undefined while it is empty or valid. */
export function judgeResolverTemplate(template: string): string | undefined {
  const text = template.trim();
  return text && !isCustomResolverTemplate(text) ? RESOLVER_TEMPLATE_ERROR : undefined;
}

/** The rows with a valid template, trimmed and in order; a blank name falls back to the template so every entry is nameable in logs. */
export function savableResolvers(rows: readonly CustomResolver[]): CustomResolver[] {
  return rows.flatMap((row) => {
    const template = row.template.trim();
    return isCustomResolverTemplate(template) ? [{ name: row.name.trim() || template, template, enabled: row.enabled }] : [];
  });
}
