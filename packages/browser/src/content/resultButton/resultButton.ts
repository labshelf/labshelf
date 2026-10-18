// Mounts a "Save to LabShelf" split button for one search hit and runs its save, folder menu and "no PDF" ask.
// PLATFORM: the button lives in a shadow root so the page's stylesheet cannot reshape it; all saving runs in the background.
import type { IfNoPdf } from "@labshelf/core";
import { PAPERS_DIR, errorMessage, folderPathLabel, icon, pdfSourceLabel, type IconName } from "@labshelf/core";
import { askNoPdf, showMenu } from "@labshelf/core/dom";
import { sendRuntime } from "../../platform";
import type { FoldersData, LibraryRef, SaveOutcome, SearchHit } from "../../platform";
import { kitShadow } from "../shadowStyles";
import { BUTTON_CSS } from "./buttonStyles";

type ButtonState = "idle" | "saving" | "saved" | "error" | "confirm";

/** A mounted button and the hit it saves. */
export interface ResultButton {
  hit: SearchHit;
  box: HTMLElement;
  main: HTMLButtonElement;
  caret: HTMLButtonElement;
  saved?: Pick<LibraryRef, "folder" | "id" | "hasPdf">;
}

/** Marks page elements the content script added or already handled. */
export const MOUNTED_ATTR = "data-lsx";
let overlay: ShadowRoot | undefined;

const LABELS: Record<ButtonState, { glyph: IconName; text: string }> = {
  idle: { glyph: "logo", text: "Save to LabShelf" },
  saving: { glyph: "refresh", text: "Finding PDF…" },
  saved: { glyph: "check", text: "In LabShelf" },
  error: { glyph: "warning", text: "Try again" },
  confirm: { glyph: "warning", text: "No PDF found" },
};

function setState(m: ResultButton, state: ButtonState, title: string): void {
  m.box.dataset["state"] = state;
  const { glyph, text } = LABELS[state];
  m.main.innerHTML = `<span class="lsx-mark">${icon(glyph)}</span><span></span>`;
  m.main.querySelector("span:last-child")!.textContent = text;
  m.main.title = title;
  m.main.setAttribute("aria-label", title);
}

/** Shows the button as "In LabShelf"; a click then opens the paper. */
export function markSaved(m: ResultButton, ref: Pick<LibraryRef, "folder" | "id" | "hasPdf">, detail: string): void {
  m.saved = ref;
  const title = ref.hasPdf
    ? `In your LabShelf library${detail ? ` — ${detail}` : ""}. Click to open it.`
    : "In your LabShelf library, but without a PDF — LabShelf found none. Click to open it; the library's Find PDF can retry.";
  setState(m, "saved", title);
  m.box.dataset["pdf"] = ref.hasPdf ? "" : "none";
  // A saved paper without its PDF reads distinctly, not as a complete capture.
  if (!ref.hasPdf) m.main.querySelector("span:last-child")!.textContent = "In LabShelf · no PDF";
}

async function save(m: ResultButton, folder?: string, ifNoPdf: IfNoPdf = "ask", retryPdf = false): Promise<void> {
  const state = m.box.dataset["state"];
  if (state === "saving" || state === "confirm") return;
  setState(m, "saving", "Saving to LabShelf — looking for the PDF…");
  try {
    const r = await sendRuntime<SaveOutcome>({
      type: "searchHit.save", hit: m.hit,
      ...(folder ? { folder } : {}), ifNoPdf, ...(retryPdf ? { retryPdf } : {}),
    });
    if (r.status === "no-pdf") {
      // Nothing was written: ask before saving the reference without its PDF.
      setState(m, "confirm", "No PDF found — choose whether to save the reference without it.");
      const choice = await askNoPdf(m.hit.title, r.miss, overlayRoot());
      if (choice === "save" || choice === "open" || choice === "author") return save(m, folder, choice);
      if (choice === "retry") return save(m, folder, "ask", true);
      setState(m, "idle", "Not saved — no PDF was found. Click to try again.");
      return;
    }
    const detail = r.alreadyInLibrary ? "it was already there" : r.pdfSource ? `PDF via ${pdfSourceLabel(r.pdfSource)}` : "saved without a PDF";
    markSaved(m, { folder: r.folder, id: r.id, hasPdf: r.hasPdf }, detail);
  } catch (err) {
    setState(m, "error", `Could not save: ${errorMessage(err)}. Click to retry.`);
  }
}

function overlayRoot(): ShadowRoot {
  if (!overlay) {
    const host = document.createElement("div");
    host.setAttribute(MOUNTED_ATTR, "overlay");
    document.documentElement.append(host);
    overlay = kitShadow(host, "", "position: fixed; top: 0; left: 0; z-index: 2147483000;");
  }
  return overlay;
}

async function openFolderMenu(m: ResultButton): Promise<void> {
  let data: FoldersData;
  try {
    data = await sendRuntime<FoldersData>({ type: "library.folders" });
  } catch {
    return;
  }
  showMenu(m.caret, data.folders.map((f) => ({
    label: folderPathLabel(PAPERS_DIR, f.path, "/"),
    icon: f.depth === 0 ? ("library" as const) : ("folder" as const),
    ...(f.path === data.lastFolder ? { hint: "last used" } : {}),
    onSelect: () => { void save(m, f.path); },
  })), { root: overlayRoot() });
}

/**
 * Builds the button for `hit` inside `host`, which the page adapter has already placed;
 * `hostStyle` sets the host's own box against the page's stylesheet.
 */
export function mountResultButton(host: HTMLElement, hit: SearchHit, hostStyle: string): ResultButton {
  host.setAttribute(MOUNTED_ATTR, "button");
  const root = kitShadow(host, BUTTON_CSS, hostStyle);
  const box = document.createElement("div");
  box.className = "lsx";
  box.innerHTML =
    `<button class="lsx-main" type="button"></button>` +
    `<span class="lsx-sep" aria-hidden="true"></span>` +
    `<button class="lsx-caret" type="button" title="Save to a folder…" aria-label="Save to a folder" aria-haspopup="menu">${icon("chevron-down")}</button>`;
  root.append(box);

  const m: ResultButton = { hit, box, main: box.querySelector(".lsx-main")!, caret: box.querySelector(".lsx-caret")! };
  setState(m, "idle", "Save to LabShelf, into the folder used last");
  m.main.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (m.saved) void sendRuntime({ type: "library.open", folder: m.saved.folder, paperId: m.saved.id });
    else void save(m);
  });
  m.caret.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const state = box.dataset["state"];
    if (state !== "saving" && state !== "confirm") void openFolderMenu(m);
  });
  return m;
}
