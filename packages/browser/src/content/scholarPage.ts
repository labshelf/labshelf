// Adds the "Save to LabShelf" button to each Google Scholar result, in Scholar's right-hand PDF column.
import type { SearchPage } from "./searchHitScan";
import { readResult } from "./scholarParse";

export const SCHOLAR_PAGE: SearchPage = {
  results: () => [...document.querySelectorAll(".gs_r.gs_or")],
  readHit: readResult,
  place(result, host) {
    // Scholar's right column; results without a PDF link get one built the same way.
    let column = result.querySelector(".gs_ggs .gs_ggsd");
    if (!column) {
      const ggs = document.createElement("div");
      ggs.className = "gs_ggs gs_fl";
      column = document.createElement("div");
      column.className = "gs_ggsd";
      ggs.append(column);
      result.insertBefore(ggs, result.querySelector(".gs_ri"));
    }
    column.append(host);
    return true;
  },
  hostStyle: "display: block; margin: 8px 0 2px;",
};
