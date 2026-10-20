// Shows the Share button in the list header while the current folder can be shared as a link.
import { PAPERS_DIR, isUnderDir } from "../../../library/index.js";
import { runShareFolderDialog } from "../../../share/dom/index.js";
import { el } from "../../../ui/dom/index.js";
import { icon } from "../../../ui/index.js";
import type { UiContext } from "../uiContext.js";

/** Appends the button to `container` and keeps it in step with the folder and the host's offers; returns the unsubscribe. */
export function mountShareFolderButton(ctx: UiContext, container: HTMLElement): () => void {
  const sharing = ctx.sharing;
  if (ctx.readOnly || !sharing) return () => undefined;
  let button: HTMLElement | null = null;
  let folder = ctx.store.get().folder;
  const paint = (): void => {
    const shown = sharing.offers().links && folder !== PAPERS_DIR && isUnderDir(folder, PAPERS_DIR, "/");
    if (!shown) { button?.remove(); button = null; return; }
    const name = folder.split("/").pop() ?? folder;
    if (!button) {
      button = el("button", { class: "ls-btn ls-btn-ghost", type: "button", html: `${icon("link")}<span>Share</span>` });
      button.dataset["act"] = "share";
      button.addEventListener("click", () => void runShareFolderDialog(sharing, folder));
      container.append(button);
    }
    button.setAttribute("aria-label", `Share "${name}" as a link`);
  };
  const offFolder = ctx.store.select((s) => s.folder, (next) => { folder = next; paint(); });
  const offOffers = sharing.onOffersChange(paint);
  return () => { offFolder(); offOffers(); };
}
