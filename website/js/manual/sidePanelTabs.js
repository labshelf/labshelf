// Switches the reader's side panel between the outline and the highlights.

import { $, $$ } from "../dom.js";

export function initSidePanelTabs() {
  const tabs = $$(".rtabs [data-tab]");
  $(".rtabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-tab]");
    if (!tab) return;
    for (const t of tabs) t.setAttribute("aria-selected", t === tab);
    $("#toc").hidden = tab.dataset.tab !== "toc";
    $("#hls").hidden = tab.dataset.tab !== "hls";
  });
}
