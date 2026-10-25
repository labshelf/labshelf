// Builds the Custom resolvers section: an ordered list of address templates, each with a name, an enabled switch and a remove button.
import { renderInlineCode } from "@labshelf/core/dom";
import { createEditableListSection, type EditableListSection } from "./editableListSection";
import { isCustomResolverTemplate, type CustomResolver } from "@labshelf/core";

export const RESOLVER_TEMPLATE_ERROR = "Not usable — paste an http(s) address that contains {doi}.";

/** The message to show beside a template field, or undefined while it is empty or valid. */
export function checkResolverTemplate(template: string): string | undefined {
  const text = template.trim();
  return text && !isCustomResolverTemplate(text) ? RESOLVER_TEMPLATE_ERROR : undefined;
}

/** The rows with a valid template, trimmed and in order; a blank name falls back to the template so every entry is nameable in logs. */
export function listWritableResolvers(rows: readonly CustomResolver[]): CustomResolver[] {
  return rows.flatMap((row) => {
    const template = row.template.trim();
    return isCustomResolverTemplate(template) ? [{ name: row.name.trim() || template, template, enabled: row.enabled }] : [];
  });
}

const DESCRIPTION = [
  "Off until you add one. As a last resort for a paper no other source has, LabShelf opens each enabled address, top to bottom, ",
  "with ", renderInlineCode("{doi}"), " replaced by the paper's DOI, and attaches the PDF that page links to. Use an address you are allowed to use, such as ",
  renderInlineCode("https://host.example/find/{doi}"), ".",
];

export function createResolverSection(onChange: () => void): EditableListSection {
  return createEditableListSection({
    title: "Custom resolvers",
    description: DESCRIPTION,
    idPrefix: "resolver",
    rowLabel: "Custom resolver",
    addLabel: "Add resolver",
    namePlaceholder: "Name",
    nameAriaLabel: "Resolver name",
    addressPlaceholder: "https://host.example/find/{doi}",
    addressAriaLabel: "Resolver address",
    judge(template) {
      const error = checkResolverTemplate(template);
      return error === undefined ? undefined : { text: error, isError: true };
    },
    savable: listWritableResolvers,
  }, onChange);
}
