// Adds the "Save to LabShelf" button to Google's organic results that are papers, at the end of each one's URL line.
import type { SearchPage } from "../resultButton";
import { googleResults, isPaperHit, readGoogleResult } from "./googleParse";

export const GOOGLE_PAGE: SearchPage = {
  results: () => googleResults(document),
  readHit(result) {
    const hit = readGoogleResult(result);
    return hit && isPaperHit(hit) ? hit : undefined;
  },
  place(result, host) {
    // The visible URL line (site name, cite, "⋮") is the title link wrapper's sibling that holds a <cite>;
    // the copy inside the link is hidden. No such line: no button rather than one in a wrong spot.
    const wrapper = result.querySelector("a[href] > h3")?.parentElement?.parentElement;
    const line = wrapper && [...(wrapper.parentElement?.children ?? [])].find((c) => c !== wrapper && c.querySelector("cite"));
    if (!line) return false;
    line.append(host);
    return true;
  },
  hostStyle: "display: block; align-self: center; flex-shrink: 0; margin-left: 8px;",
};
