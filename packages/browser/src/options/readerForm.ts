/** Builds the PDF reader section, the browser twin of VS Code's labshelf.reader.* settings. */
import type { CitationStyle, ReaderPrefs, ZoomPreset } from "@labshelf/core";
import {
  checkboxField, inlineCode, numberField, selectField, setRowDisabled, settingRow, settingsSection,
} from "@labshelf/core/dom";

const ZOOM_OPTIONS = [
  { value: "page-width", label: "Page width" },
  { value: "page-fit", label: "Whole page" },
  { value: "page-actual", label: "Actual size" },
  { value: "auto", label: "Automatic" },
];

const CITATION_OPTIONS = [
  { value: "pandoc", label: "Pandoc — > quote, then [@key, p. 12]" },
  { value: "latex", label: "LaTeX — ``quote'' \\cite[p.~12]{key}" },
  { value: "author-year", label: "Author-year — \"quote\" (Silva et al., 2021, p. 12)" },
  { value: "citekey", label: "Cite key — quote @key" },
];

export interface ReaderForm {
  section: HTMLElement;
  /** Every control, for listening to edits. */
  controls: HTMLElement[];
  read(): Partial<ReaderPrefs>;
  /** With `keepDelayEdit`, a hover delay the user is typing in is left alone. */
  fill(prefs: ReaderPrefs, keepDelayEdit?: boolean): void;
}

function createFields() {
  return {
    zoom: selectField({ id: "reader-default-zoom", options: ZOOM_OPTIONS, width: "md" }),
    restore: checkboxField({ id: "reader-restore-position", label: "Reopen each paper at the page, zoom and sidebar state where it was last read" }),
    autoHide: checkboxField({ id: "reader-toolbar-autohide", label: "Hide the reader toolbar while scrolling down" }),
    hover: checkboxField({ id: "reader-hover-previews", label: "Show a preview when hovering a citation, figure, equation, table or section link" }),
    delay: numberField({ id: "reader-hover-delay", min: 0, max: 2000, step: 50, width: "sm" }),
    style: selectField({ id: "reader-citation-style", options: CITATION_OPTIONS, width: "md" }),
    vim: checkboxField({ id: "reader-vim-keys", label: "Enable single-key vim navigation (j/k, d/u, gg/G, /, n/N, H/L, w, t)" }),
  };
}

type Fields = ReturnType<typeof createFields>;

function buildSection(f: Fields, delayRow: HTMLElement): HTMLElement {
  return settingsSection(
    {
      title: "PDF reader",
      description: [
        "The same reader as the VS Code extension, with the same settings (", inlineCode("labshelf.reader.*"),
        " there).",
      ],
    },
    settingRow({
      label: "Default zoom",
      labelFor: "reader-default-zoom",
      description: "Zoom applied when a paper is opened without a stored reading position, and by Reset Zoom.",
    }, f.zoom.element),
    settingRow({}, f.restore.element),
    settingRow({ description: "It returns on scroll up, when the pointer nears the top, or on keyboard focus." }, f.autoHide.element),
    settingRow({}, f.hover.element),
    delayRow,
    settingRow({ label: "Citation style", labelFor: "reader-citation-style", description: "Format used by Copy with Citation." }, f.style.element),
    settingRow({ description: "Conventional shortcuts stay active." }, f.vim.element),
  );
}

export function createReaderForm(): ReaderForm {
  const f = createFields();
  const delayRow = settingRow({
    label: "Hover preview delay",
    labelFor: "reader-hover-delay",
    description: "Delay before a hover preview opens, in milliseconds (0 to 2000).",
  }, f.delay.element);
  const dimDelay = (): void => setRowDisabled(delayRow, !f.hover.control.checked);
  f.hover.control.addEventListener("change", dimDelay);

  return {
    section: buildSection(f, delayRow),
    controls: [f.zoom.control, f.restore.control, f.autoHide.control, f.hover.control, f.delay.control, f.style.control, f.vim.control],
    read: () => ({
      defaultZoom: f.zoom.control.value as ZoomPreset,
      restorePosition: f.restore.control.checked,
      toolbarAutoHide: f.autoHide.control.checked,
      hoverPreviews: f.hover.control.checked,
      hoverDelayMs: Number(f.delay.control.value),
      citationStyle: f.style.control.value as CitationStyle,
      vimKeys: f.vim.control.checked,
    }),
    fill(prefs, keepDelayEdit = false) {
      f.zoom.control.value = prefs.defaultZoom;
      f.restore.control.checked = prefs.restorePosition;
      f.autoHide.control.checked = prefs.toolbarAutoHide;
      f.hover.control.checked = prefs.hoverPreviews;
      if (!(keepDelayEdit && document.activeElement === f.delay.control)) f.delay.control.value = String(prefs.hoverDelayMs);
      f.style.control.value = prefs.citationStyle;
      f.vim.control.checked = prefs.vimKeys;
      dimDelay();
    },
  };
}
