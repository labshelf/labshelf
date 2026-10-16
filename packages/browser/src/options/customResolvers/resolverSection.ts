// Builds the Custom resolvers section: an ordered list of address templates, each with a name, an enabled switch and a remove button.
import { inlineCode } from "@labshelf/core/dom";
import { createEditableListSection, type EditableListSection } from "../editableList";
import { judgeResolverTemplate, savableResolvers } from "./resolverRows";

const DESCRIPTION = [
  "Off until you add one. As a last resort for a paper no other source has, LabShelf opens each enabled address, top to bottom, ",
  "with ", inlineCode("{doi}"), " replaced by the paper's DOI, and attaches the PDF that page links to. Use an address you are allowed to use, such as ",
  inlineCode("https://host.example/find/{doi}"), ".",
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
      const error = judgeResolverTemplate(template);
      return error === undefined ? undefined : { text: error, isError: true };
    },
    savable: savableResolvers,
  }, onChange);
}
