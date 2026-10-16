// Builds the fixed sidebar row that opens the citation map.
import { icon } from "@labshelf/core";

export function citationMapEntry(onOpen: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "sidebar-entry";
  button.title = "Works your papers often cite that your library lacks";
  button.innerHTML = `${icon("quote")}<span>Citation map</span>`;
  button.addEventListener("click", onOpen);
  return button;
}
