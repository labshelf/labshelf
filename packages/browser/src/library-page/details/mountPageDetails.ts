// Mounts the Details surface in the page's right pane over one message end.
import type { DetailsToHost, HostToDetails, MessageEnd } from "@labshelf/core";
import { mountDetails } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";
import { PAGE_CAPABILITIES, PAGE_LABELS } from "./pageLibraryOptions";

export function mountPageDetails(aside: HTMLElement, transport: MessageEnd<DetailsToHost, HostToDetails>, prefs: PagePrefs): () => void {
  return mountDetails(aside, { transport, prefs, capabilities: PAGE_CAPABILITIES, labels: PAGE_LABELS });
}
