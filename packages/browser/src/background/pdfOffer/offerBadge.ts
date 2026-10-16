// Marks one tab's toolbar button when a PDF there can be attached to a paper, without touching the global sync badge.
import { COLOR_TOKENS, errorMessage, type ILogger } from "@labshelf/core";
import { bx } from "../../platform";

// ASCII only (no emoji in UI text); the toolbar has no theme, so the badge uses the dark values of the core tokens.
const TEXT = "PDF";
const COLOR = COLOR_TOKENS.focus.value;

export async function showOfferBadge(log: ILogger, tabId: number, title: string): Promise<void> {
  try {
    await bx.action.setBadgeBackgroundColor({ tabId, color: COLOR });
    await bx.action.setBadgeText({ tabId, text: TEXT });
    await bx.action.setTitle({ tabId, title: `LabShelf — attach this PDF to "${title}"` });
  } catch (error) {
    // The tab may have closed since the PDF finished.
    void log.log("WARN", "pdf-offer", "badge not set", { tabId, error: errorMessage(error) });
  }
}

export async function clearOfferBadge(log: ILogger, tabId: number): Promise<void> {
  try {
    // PLATFORM: null (not "") removes the tab's own value in Chrome and Firefox, so the global sync badge shows again.
    await bx.action.setBadgeText({ tabId, text: null });
    await bx.action.setBadgeBackgroundColor({ tabId, color: null });
    await bx.action.setTitle({ tabId, title: null });
  } catch (error) {
    void log.log("WARN", "pdf-offer", "badge not cleared", { tabId, error: errorMessage(error) });
  }
}
