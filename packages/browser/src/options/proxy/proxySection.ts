// Builds the Library proxies section: an ordered list of proxies, each with a name, an address, an enabled switch and a remove button.
import { inlineCode } from "@labshelf/core/dom";
import { createEditableListSection, type EditableListSection } from "../editableList";
import { judgeTemplate, savableProxies } from "./proxyRows";

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
